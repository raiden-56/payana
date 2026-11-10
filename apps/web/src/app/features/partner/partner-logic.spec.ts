import {
  DocumentStatus,
  DocumentType,
  PartnerType,
  TripType,
  UPLOAD_ALLOWED_CONTENT_TYPES,
  type CategoryPricing,
  type DriverDocument,
  type DriverProfile,
  type FareEstimate,
} from '@payana/contracts';
import {
  IdempotencyKeys,
  PingThrottle,
  bandPosition,
  currentDocument,
  daysUntil,
  documentSlot,
  fareOutlier,
  formatRegistration,
  normalizeRegistration,
  onboardingSteps,
  parseFare,
  perKmProblem,
  requiredPersonDocuments,
  resolveOnboardingStep,
  toIndianE164,
  uploadProblem,
  validityOptions,
} from './partner-logic';

const inr = (amountMinor: number) => ({ amountMinor, currency: 'INR' as const });

const pricing: CategoryPricing = {
  baseFare: inr(3000),
  perKm: inr(1800),
  minPerKm: inr(1200),
  maxPerKm: inr(2200),
  perHourWaiting: inr(6000),
};

function profile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: 'p1',
    userId: 'u1',
    partnerType: PartnerType.OwnerDriver,
    displayName: 'Ganapati',
    bio: null,
    photoUrl: null,
    languages: ['Kannada'],
    yearsExperience: 4,
    serviceAreas: ['gokarna'],
    verificationStatus: 'incomplete',
    listingStatus: 'unlisted',
    availability: 'offline',
    operatingHours: null,
    activeVehicleId: null,
    onboarding: { profile: true, vehicle: false, personDocuments: false, vehicleDocuments: false, readyForReview: false },
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function doc(overrides: Partial<DriverDocument> = {}): DriverDocument {
  return {
    id: 'd1',
    type: DocumentType.Insurance,
    vehicleId: 'v1',
    numberMasked: '4821',
    expiresOn: '2027-06-30',
    status: DocumentStatus.Approved,
    rejectionReason: null,
    reviewerNote: null,
    submittedAt: '2026-11-01T10:00:00.000Z',
    reviewedAt: null,
    ...overrides,
  };
}

describe('registration numbers', () => {
  it('normalises spacing, hyphens and case', () => {
    expect(normalizeRegistration('ka 47-a 4821')).toBe('KA47A4821');
    expect(normalizeRegistration('KA47 4821')).toBe('KA474821');
    expect(normalizeRegistration(' ka-30-ab-0007 ')).toBe('KA30AB0007');
  });

  it('rejects anything that is not an Indian registration', () => {
    expect(normalizeRegistration('KA47A482')).toBeNull();
    expect(normalizeRegistration('1234')).toBeNull();
    expect(normalizeRegistration('KA47ABCD4821')).toBeNull();
    expect(normalizeRegistration('')).toBeNull();
  });

  it('formats for reading back', () => {
    expect(formatRegistration('KA47A4821')).toBe('KA 47 A 4821');
    expect(formatRegistration('KA474821')).toBe('KA 47 4821');
    expect(formatRegistration('not-a-plate')).toBe('not-a-plate');
  });
});

describe('onboarding steps', () => {
  it('gives a hired driver no vehicle steps', () => {
    expect(onboardingSteps(PartnerType.HiredDriver)).toEqual(['profile', 'person-documents', 'review']);
    expect(onboardingSteps(PartnerType.OwnerDriver)).toHaveLength(5);
    expect(onboardingSteps(null)).toHaveLength(5);
  });

  it('starts at the profile when there is none', () => {
    expect(resolveOnboardingStep(null)).toBe('profile');
  });

  it('resumes at the first unfinished step', () => {
    expect(resolveOnboardingStep(profile())).toBe('vehicle');
    expect(
      resolveOnboardingStep(
        profile({ onboarding: { profile: true, vehicle: true, personDocuments: false, vehicleDocuments: true, readyForReview: false } }),
      ),
    ).toBe('person-documents');
  });

  it('lands on review when everything is in, and stays there once submitted', () => {
    const ready = { profile: true, vehicle: true, personDocuments: true, vehicleDocuments: true, readyForReview: true };
    expect(resolveOnboardingStep(profile({ onboarding: ready }))).toBe('review');
    expect(resolveOnboardingStep(profile({ onboarding: ready, verificationStatus: 'pending' }))).toBe('review');
  });

  it('skips vehicle steps for a hired driver even when the checklist flags are false', () => {
    const hired = profile({
      partnerType: PartnerType.HiredDriver,
      onboarding: { profile: true, vehicle: false, personDocuments: true, vehicleDocuments: false, readyForReview: false },
    });
    expect(resolveOnboardingStep(hired)).toBe('review');
  });

  it('asks a fleet owner for identity only', () => {
    expect(requiredPersonDocuments(PartnerType.FleetOwner)).toEqual([DocumentType.Identity]);
    expect(requiredPersonDocuments(PartnerType.OwnerDriver)).toEqual([DocumentType.Identity, DocumentType.DrivingLicence]);
  });
});

describe('document slots', () => {
  const today = new Date(2026, 10, 10); // 10 Nov 2026, local

  it('counts whole days regardless of the time of day', () => {
    expect(daysUntil('2026-11-10', today)).toBe(0);
    expect(daysUntil('2026-11-11', new Date(2026, 10, 10, 23, 59))).toBe(1);
    expect(daysUntil('2026-11-09', today)).toBe(-1);
  });

  it('reports a missing document', () => {
    expect(documentSlot(undefined, today)).toEqual({ state: 'missing', daysLeft: null });
  });

  it('warns inside the 30-day window and not before it', () => {
    expect(documentSlot(doc({ expiresOn: '2026-12-10' }), today).state).toBe('expiring');
    expect(documentSlot(doc({ expiresOn: '2026-12-11' }), today).state).toBe('approved');
    expect(documentSlot(doc({ expiresOn: '2026-11-10' }), today)).toEqual({ state: 'expiring', daysLeft: 0 });
  });

  it('treats a past date as expired even if the status has not caught up', () => {
    expect(documentSlot(doc({ expiresOn: '2026-11-09' }), today).state).toBe('expired');
    expect(documentSlot(doc({ status: DocumentStatus.Expired }), today).state).toBe('expired');
  });

  it('puts rejection ahead of everything else', () => {
    expect(documentSlot(doc({ status: DocumentStatus.Rejected, expiresOn: '2026-11-01' }), today).state).toBe('rejected');
  });

  it('shows a pending document as in review, and one without an expiry as approved', () => {
    expect(documentSlot(doc({ status: DocumentStatus.Pending }), today).state).toBe('in_review');
    expect(documentSlot(doc({ expiresOn: null }), today)).toEqual({ state: 'approved', daysLeft: null });
  });

  it('picks the latest submission for the right slot', () => {
    const docs = [
      doc({ id: 'old', submittedAt: '2026-10-01T00:00:00.000Z' }),
      doc({ id: 'new', submittedAt: '2026-11-05T00:00:00.000Z', status: DocumentStatus.Pending }),
      doc({ id: 'other-vehicle', vehicleId: 'v2', submittedAt: '2026-11-09T00:00:00.000Z' }),
      doc({ id: 'person', type: DocumentType.Identity, vehicleId: null }),
    ];
    expect(currentDocument(docs, DocumentType.Insurance, 'v1')?.id).toBe('new');
    expect(currentDocument(docs, DocumentType.Identity, null)?.id).toBe('person');
    expect(currentDocument(docs, DocumentType.Permit, 'v1')).toBeUndefined();
  });
});

describe('uploads', () => {
  it('accepts the allowed types within the size limit', () => {
    expect(uploadProblem({ type: 'image/jpeg', size: 1000 }, UPLOAD_ALLOWED_CONTENT_TYPES)).toBeNull();
    expect(uploadProblem({ type: 'application/pdf', size: 8 * 1024 * 1024 }, UPLOAD_ALLOWED_CONTENT_TYPES)).toBeNull();
  });

  it('rejects other types, oversized and empty files', () => {
    expect(uploadProblem({ type: 'image/gif', size: 10 }, UPLOAD_ALLOWED_CONTENT_TYPES)).toContain('not accepted');
    expect(uploadProblem({ type: 'application/pdf', size: 10 }, ['image/jpeg', 'image/png'])).toContain('JPEG, PNG');
    expect(uploadProblem({ type: 'image/png', size: 8 * 1024 * 1024 + 1 }, UPLOAD_ALLOWED_CONTENT_TYPES)).toContain('8 MB');
    expect(uploadProblem({ type: 'image/png', size: 0 }, UPLOAD_ALLOWED_CONTENT_TYPES)).toContain('empty');
  });
});

describe('rates and fares', () => {
  it('keeps the per-km rate inside the category band, inclusive', () => {
    expect(perKmProblem(1200, pricing)).toBeNull();
    expect(perKmProblem(2200, pricing)).toBeNull();
    expect(perKmProblem(1199, pricing)).toContain('₹12 and ₹22');
    expect(perKmProblem(2300, pricing)).not.toBeNull();
    expect(perKmProblem(null, pricing)).not.toBeNull();
    expect(perKmProblem(0, pricing)).not.toBeNull();
  });

  it('places a rate on the gauge', () => {
    expect(bandPosition(1200, pricing)).toBe(0);
    expect(bandPosition(1700, pricing)).toBe(0.5);
    expect(bandPosition(9999, pricing)).toBe(1);
    expect(bandPosition(null, pricing)).toBe(0);
  });

  it('turns a typed fare into paise', () => {
    expect(parseFare('450')).toEqual({ minor: 45_000 });
    expect(parseFare('₹1,250')).toEqual({ minor: 125_000 });
    expect(parseFare(80)).toEqual({ minor: 8_000 });
  });

  it('refuses fares that cannot be right', () => {
    expect(parseFare('')).toHaveProperty('problem');
    expect(parseFare('abc')).toHaveProperty('problem');
    expect(parseFare('0')).toHaveProperty('problem');
    expect(parseFare('-5')).toHaveProperty('problem');
    expect(parseFare('99.50')).toHaveProperty('problem');
    expect(parseFare('9999999')).toHaveProperty('problem');
  });

  it('flags a fare far from the estimate but never one inside it', () => {
    const estimate: FareEstimate = { distanceKm: 8, durationMinutes: 20, low: inr(20_000), high: inr(30_000), basis: 'straight_line' };
    expect(fareOutlier(25_000, estimate)).toBeNull();
    expect(fareOutlier(75_100, estimate)).toBe('much_higher');
    expect(fareOutlier(9_900, estimate)).toBe('much_lower');
    expect(fareOutlier(900_000, null)).toBeNull();
  });

  it('offers only validity periods that fit before the request closes', () => {
    expect(validityOptions(TripType.Immediate, 9)).toEqual([5]);
    expect(validityOptions(TripType.Immediate, 10)).toEqual([5, 10]);
    expect(validityOptions(TripType.Scheduled, 130)).toEqual([15, 30, 60, 120]);
    expect(validityOptions(TripType.Outstation, 2)).toEqual([15]);
  });

  it('builds an E.164 number from what people type', () => {
    expect(toIndianE164('98765 43210')).toBe('+919876543210');
    expect(toIndianE164('+91 98765-43210')).toBe('+919876543210');
    expect(toIndianE164('09876543210')).toBe('+919876543210');
    expect(toIndianE164('12345 67890')).toBeNull();
    expect(toIndianE164('98765')).toBeNull();
  });
});

describe('PingThrottle', () => {
  it('lets the first fix through and then at most one per interval', () => {
    const throttle = new PingThrottle(20_000);
    expect(throttle.tryAcquire(1_000)).toBe(true);
    expect(throttle.tryAcquire(5_000)).toBe(false);
    expect(throttle.tryAcquire(20_999)).toBe(false);
    expect(throttle.tryAcquire(21_000)).toBe(true);
    expect(throttle.tryAcquire(40_999)).toBe(false);
  });

  it('sends straight away again after a reset', () => {
    const throttle = new PingThrottle(20_000);
    throttle.tryAcquire(0);
    throttle.reset();
    expect(throttle.tryAcquire(100)).toBe(true);
  });
});

describe('IdempotencyKeys', () => {
  it('reuses the key for an identical body and issues a new one when the body changes', () => {
    let n = 0;
    const keys = new IdempotencyKeys(() => `key-${++n}`);
    const first = keys.keyFor({ fareMinor: 45_000 });
    expect(keys.keyFor({ fareMinor: 45_000 })).toBe(first);
    const second = keys.keyFor({ fareMinor: 50_000 });
    expect(second).not.toBe(first);
    expect(keys.keyFor({ fareMinor: 50_000 })).toBe(second);
  });
});
