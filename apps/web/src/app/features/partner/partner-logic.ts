import {
  DocumentStatus,
  DocumentType,
  INDIAN_VEHICLE_REGISTRATION,
  PERSON_DOCUMENT_TYPES,
  PartnerType,
  TripType,
  UPLOAD_MAX_BYTES,
  type CategoryPricing,
  type DriverDocument,
  type DriverProfile,
  type FareEstimate,
} from '@payana/contracts';

/**
 * Pure rules for the partner area - no Angular, no I/O, so they are cheap to
 * test. Everything here is a courtesy to the person filling in a form; the
 * API applies the authoritative version of each rule.
 */

// ---------------------------------------------------------------------------
// Registration numbers
// ---------------------------------------------------------------------------

/** "ka 47-a 4821" -> "KA47A4821". Null when it is not an Indian registration number. */
export function normalizeRegistration(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  return INDIAN_VEHICLE_REGISTRATION.test(compact) ? compact : null;
}

/** "KA47A4821" -> "KA 47 A 4821", for reading back. Unknown shapes are returned unchanged. */
export function formatRegistration(registration: string): string {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/.exec(registration);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : registration;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export type OnboardingStepId = 'profile' | 'vehicle' | 'person-documents' | 'vehicle-documents' | 'review';

/**
 * The steps a partner of this type walks through. A hired driver has no
 * vehicle of their own - they drive under an owner's authorisation - so the
 * two vehicle steps do not apply to them.
 */
export function onboardingSteps(partnerType: PartnerType | null): OnboardingStepId[] {
  if (partnerType === PartnerType.HiredDriver) return ['profile', 'person-documents', 'review'];
  return ['profile', 'vehicle', 'person-documents', 'vehicle-documents', 'review'];
}

/** Whether the server-side checklist counts this step as done. */
export function isStepDone(profile: DriverProfile | null, step: OnboardingStepId): boolean {
  if (!profile) return false;
  const c = profile.onboarding;
  switch (step) {
    case 'profile':
      return c.profile;
    case 'vehicle':
      return c.vehicle;
    case 'person-documents':
      return c.personDocuments;
    case 'vehicle-documents':
      return c.vehicleDocuments;
    case 'review':
      // "Done" once it has been handed to the verification team.
      return profile.verificationStatus === 'pending' || profile.verificationStatus === 'approved';
  }
}

/** Where to drop someone who comes back to onboarding: the first step still to do. */
export function resolveOnboardingStep(profile: DriverProfile | null): OnboardingStepId {
  const steps = onboardingSteps(profile?.partnerType ?? null);
  return steps.find((step) => !isStepDone(profile, step)) ?? 'review';
}

/** Documents about the person that this kind of partner must hold. */
export function requiredPersonDocuments(partnerType: PartnerType): DocumentType[] {
  // A fleet owner who does not drive needs proof of identity but no driving licence.
  return partnerType === PartnerType.FleetOwner ? [DocumentType.Identity] : [...PERSON_DOCUMENT_TYPES];
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Document types that carry an expiry date the API insists on. */
export const EXPIRY_REQUIRED: readonly DocumentType[] = [
  DocumentType.DrivingLicence,
  DocumentType.Insurance,
  DocumentType.Permit,
  DocumentType.Fitness,
  DocumentType.PollutionCertificate,
];

export const EXPIRY_WARNING_DAYS = 30;

export type DocumentSlotState = 'missing' | 'in_review' | 'approved' | 'expiring' | 'expired' | 'rejected';

export interface DocumentSlot {
  state: DocumentSlotState;
  /** Whole days until expiry (negative once past). Null when the document has no expiry date. */
  daysLeft: number | null;
}

/** "2027-03-31" for a local date. */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from `today` to an ISO date; 0 means it expires today. */
export function daysUntil(isoDate: string, today: Date): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - from) / 86_400_000);
}

/** What to tell a partner about one required document. */
export function documentSlot(document: DriverDocument | undefined, today: Date): DocumentSlot {
  if (!document) return { state: 'missing', daysLeft: null };
  const daysLeft = document.expiresOn ? daysUntil(document.expiresOn, today) : null;

  if (document.status === DocumentStatus.Rejected) return { state: 'rejected', daysLeft };
  if (document.status === DocumentStatus.Expired || (daysLeft !== null && daysLeft < 0)) {
    return { state: 'expired', daysLeft };
  }
  if (document.status === DocumentStatus.Pending) return { state: 'in_review', daysLeft };
  if (daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS) return { state: 'expiring', daysLeft };
  return { state: 'approved', daysLeft };
}

/**
 * The document that currently fills a slot. The API returns only current
 * documents, but an approved one stays in force while its replacement is in
 * review - so prefer whichever was submitted last.
 */
export function currentDocument(
  documents: readonly DriverDocument[],
  type: DocumentType,
  vehicleId: string | null,
): DriverDocument | undefined {
  return documents
    .filter((d) => d.type === type && (d.vehicleId ?? null) === vehicleId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
}

/** Null when the file may be uploaded, otherwise the sentence to show. */
export function uploadProblem(
  file: { type: string; size: number },
  allowedTypes: readonly string[],
  maxBytes: number = UPLOAD_MAX_BYTES,
): string | null {
  if (!allowedTypes.includes(file.type)) {
    const kinds = allowedTypes.map((t) => (t === 'application/pdf' ? 'PDF' : t.replace('image/', '').toUpperCase()));
    return `That file type is not accepted. Use ${kinds.join(', ')}.`;
  }
  if (file.size > maxBytes) {
    return `That file is too large. The limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

// ---------------------------------------------------------------------------
// Rates and fares
// ---------------------------------------------------------------------------

/** Null when the per-km rate sits inside the category band, otherwise the sentence to show. */
export function perKmProblem(perKmMinor: number | null, pricing: CategoryPricing): string | null {
  if (perKmMinor === null || !Number.isFinite(perKmMinor) || perKmMinor <= 0) return 'Enter your rate per kilometre.';
  const min = pricing.minPerKm.amountMinor;
  const max = pricing.maxPerKm.amountMinor;
  if (perKmMinor < min || perKmMinor > max) {
    return `For this category the rate must be between ₹${min / 100} and ₹${max / 100} per km.`;
  }
  return null;
}

/** Where a per-km rate sits in the category band, 0 - 1 (clamped), for the gauge. */
export function bandPosition(perKmMinor: number | null, pricing: CategoryPricing): number {
  const min = pricing.minPerKm.amountMinor;
  const max = pricing.maxPerKm.amountMinor;
  if (perKmMinor === null || max <= min) return 0;
  return Math.min(1, Math.max(0, (perKmMinor - min) / (max - min)));
}

/** A fare typed in rupees -> paise, or the reason it cannot be used. Fares are whole rupees. */
export function parseFare(value: string | number | null | undefined): { minor: number } | { problem: string } {
  if (value === null || value === undefined || value === '') return { problem: 'Enter the fare for this trip.' };
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(n)) return { problem: 'Enter the fare as a number, for example 450.' };
  if (n <= 0) return { problem: 'The fare has to be more than zero.' };
  if (!Number.isInteger(n)) return { problem: 'Use whole rupees, without paise.' };
  if (n > 500_000) return { problem: 'That fare looks too high. Check the amount.' };
  return { minor: n * 100 };
}

/**
 * Flags a quote that is far from the estimate the customer was shown, so a
 * slip of the finger (4500 for 450) is caught before it is sent. A warning,
 * never a block: the driver decides the fare.
 */
export function fareOutlier(fareMinor: number, estimate: FareEstimate | null): 'much_lower' | 'much_higher' | null {
  if (!estimate) return null;
  if (fareMinor > estimate.high.amountMinor * 2.5) return 'much_higher';
  if (fareMinor < estimate.low.amountMinor * 0.5) return 'much_lower';
  return null;
}

/** Minutes a quote may stay valid: the choices that still fit before the request closes. */
export function validityOptions(tripType: TripType, minutesUntilRequestExpires: number): number[] {
  const all = tripType === TripType.Immediate ? [5, 10] : [15, 30, 60, 120, 360, 720, 1440];
  const fitting = all.filter((m) => m <= Math.max(5, Math.floor(minutesUntilRequestExpires)));
  // Always offer at least the shortest choice; the API caps it at the request's expiry.
  return fitting.length ? fitting : [all[0]!];
}

export function validityLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** Ten digits typed by a person -> "+91XXXXXXXXXX", or null when it is not an Indian mobile number. */
export function toIndianE164(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

// ---------------------------------------------------------------------------
// Location sharing
// ---------------------------------------------------------------------------

/**
 * Lets one position through at most every `minIntervalMs`. The device reports
 * fixes far more often than the server needs them; this keeps data use and
 * battery drain down on a driver's phone.
 */
export class PingThrottle {
  private lastSentAt: number | null = null;

  constructor(private readonly minIntervalMs: number) {}

  /** True when a ping may go out now; calling it records that one did. */
  tryAcquire(nowMs: number): boolean {
    if (this.lastSentAt !== null && nowMs - this.lastSentAt < this.minIntervalMs) return false;
    this.lastSentAt = nowMs;
    return true;
  }

  /** Forget the last send, so the next fix goes out straight away. */
  reset(): void {
    this.lastSentAt = null;
  }
}

/** One idempotency key per distinct request body: a retry reuses it, an edited form gets a new one. */
export class IdempotencyKeys {
  private lastBody: string | null = null;
  private lastKey: string | null = null;

  constructor(private readonly newKey: () => string) {}

  keyFor(body: unknown): string {
    const serialised = JSON.stringify(body);
    if (serialised !== this.lastBody || !this.lastKey) {
      this.lastBody = serialised;
      this.lastKey = this.newKey();
    }
    return this.lastKey;
  }
}
