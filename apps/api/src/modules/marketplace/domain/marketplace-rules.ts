import {
  DocumentStatus,
  DocumentType,
  INDIAN_VEHICLE_REGISTRATION,
  PERSON_DOCUMENT_TYPES,
  PartnerType,
  REQUIRED_VEHICLE_DOCUMENT_TYPES,
  VerificationStatus,
  type FieldError,
  type OnboardingChecklist,
} from '@payana/contracts';

/** Pure marketplace rules - no I/O. */

/** "ka 47-a 4821" -> "KA47A4821". Returns null when it is not an Indian registration number. */
export function normalizeRegistration(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  return INDIAN_VEHICLE_REGISTRATION.test(compact) ? compact : null;
}

/** Documents about the person that a partner of this type must hold. */
export function requiredPersonDocuments(partnerType: PartnerType): DocumentType[] {
  // A fleet owner who does not drive needs proof of identity but no driving licence.
  return partnerType === PartnerType.FleetOwner ? [DocumentType.Identity] : [...PERSON_DOCUMENT_TYPES];
}

export function isPersonDocument(type: DocumentType): boolean {
  return PERSON_DOCUMENT_TYPES.includes(type) || type === DocumentType.OwnerAuthorisation;
}

export interface DocumentFacts {
  type: DocumentType;
  vehicleId: string | null;
  status: DocumentStatus;
  /** "YYYY-MM-DD" or null. */
  expiresOn: string | null;
}

const submitted = (d: DocumentFacts) => d.status === DocumentStatus.Pending || d.status === DocumentStatus.Approved;

export function isUnexpired(expiresOn: string | null, today: string): boolean {
  return expiresOn === null || expiresOn >= today;
}

const usable = (d: DocumentFacts, today: string) => d.status === DocumentStatus.Approved && isUnexpired(d.expiresOn, today);

/**
 * What a partner still has to do before asking for review. Hired drivers do
 * not need a vehicle of their own - they operate under an owner's authorisation.
 */
export function onboardingChecklist(input: {
  hasProfile: boolean;
  partnerType: PartnerType;
  vehicleIds: string[];
  /** Current (non-superseded) documents only. */
  documents: DocumentFacts[];
}): OnboardingChecklist {
  const needsVehicle = input.partnerType !== PartnerType.HiredDriver;
  const vehicle = !needsVehicle || input.vehicleIds.length > 0;

  const personDocuments = requiredPersonDocuments(input.partnerType).every((type) =>
    input.documents.some((d) => d.vehicleId === null && d.type === type && submitted(d)),
  );

  const vehicleDocuments =
    !needsVehicle ||
    (input.vehicleIds.length > 0 &&
      input.vehicleIds.every((vehicleId) =>
        REQUIRED_VEHICLE_DOCUMENT_TYPES.every((type) =>
          input.documents.some((d) => d.vehicleId === vehicleId && d.type === type && submitted(d)),
        ),
      ));

  const profile = input.hasProfile;
  return { profile, vehicle, personDocuments, vehicleDocuments, readyForReview: profile && vehicle && personDocuments && vehicleDocuments };
}

/** Every required person document is approved and unexpired. */
export function personDocumentsApproved(partnerType: PartnerType, documents: DocumentFacts[], today: string): boolean {
  return requiredPersonDocuments(partnerType).every((type) =>
    documents.some((d) => d.vehicleId === null && d.type === type && usable(d, today)),
  );
}

/** Every required vehicle document is approved and unexpired. */
export function vehicleDocumentsApproved(vehicleId: string, documents: DocumentFacts[], today: string): boolean {
  return REQUIRED_VEHICLE_DOCUMENT_TYPES.every((type) =>
    documents.some((d) => d.vehicleId === vehicleId && d.type === type && usable(d, today)),
  );
}

export function vehicleHasRejectedDocument(vehicleId: string, documents: DocumentFacts[]): boolean {
  return documents.some((d) => d.vehicleId === vehicleId && d.status === DocumentStatus.Rejected);
}

export interface RateBounds {
  minPerKmMinor: number;
  maxPerKmMinor: number;
  baseFareMinor: number;
  perHourWaitingMinor: number;
}

export interface RateInput {
  baseFareMinor: number;
  perKmMinor: number;
  perHourWaitingMinor: number;
  fullDayMinor?: number | null;
}

/** Platform pricing rules for a driver's published rates. Returns the violations, empty when valid. */
export function validateRates(rates: RateInput, bounds: RateBounds): FieldError[] {
  const errors: FieldError[] = [];
  const rupees = (minor: number) => `Rs ${(minor / 100).toFixed(0)}`;
  if (rates.perKmMinor < bounds.minPerKmMinor || rates.perKmMinor > bounds.maxPerKmMinor) {
    errors.push({
      field: 'perKmMinor',
      message: `Per-km rate for this category must be between ${rupees(bounds.minPerKmMinor)} and ${rupees(bounds.maxPerKmMinor)}.`,
    });
  }
  // Base fare and waiting charge may vary, but not beyond three times the category standard.
  if (rates.baseFareMinor > bounds.baseFareMinor * 3) {
    errors.push({ field: 'baseFareMinor', message: `Base fare can be at most ${rupees(bounds.baseFareMinor * 3)} for this category.` });
  }
  if (rates.perHourWaitingMinor > bounds.perHourWaitingMinor * 3) {
    errors.push({
      field: 'perHourWaitingMinor',
      message: `Waiting charge can be at most ${rupees(bounds.perHourWaitingMinor * 3)} an hour for this category.`,
    });
  }
  if (rates.fullDayMinor !== null && rates.fullDayMinor !== undefined) {
    // A full day is 8 h / 80 km: it cannot cost more than 80 km at the maximum rate plus the base fare, doubled.
    const ceiling = (bounds.baseFareMinor + bounds.maxPerKmMinor * 80) * 2;
    if (rates.fullDayMinor > ceiling) {
      errors.push({ field: 'fullDayMinor', message: `Full-day rate can be at most ${rupees(ceiling)} for this category.` });
    }
  }
  return errors;
}

/** Verification statuses in which a partner may edit and (re)submit for review. */
export const EDITABLE_STATUSES: readonly VerificationStatus[] = [
  VerificationStatus.Incomplete,
  VerificationStatus.ChangesRequested,
  VerificationStatus.Rejected,
];

export type VerificationDecision = 'approve' | 'request_changes' | 'reject' | 'suspend' | 'reinstate';

/** The status a decision leads to, or null when the decision is not allowed from `current`. */
export function nextVerificationStatus(
  current: VerificationStatus,
  decision: VerificationDecision,
): VerificationStatus | null {
  switch (decision) {
    case 'approve':
      return current === VerificationStatus.Pending || current === VerificationStatus.ChangesRequested
        ? VerificationStatus.Approved
        : null;
    case 'request_changes':
      return current === VerificationStatus.Pending ? VerificationStatus.ChangesRequested : null;
    case 'reject':
      return current === VerificationStatus.Pending || current === VerificationStatus.ChangesRequested
        ? VerificationStatus.Rejected
        : null;
    case 'suspend':
      return current === VerificationStatus.Approved ? VerificationStatus.Suspended : null;
    case 'reinstate':
      return current === VerificationStatus.Suspended ? VerificationStatus.Approved : null;
  }
}
