import {
  DocumentRejectionReason,
  DocumentType,
  PartnerType,
  VerificationStatus,
  type DecideVerificationRequest,
} from '@payana/contracts';

export const DOCUMENT_LABEL: Record<DocumentType, string> = {
  [DocumentType.Identity]: 'Identity proof',
  [DocumentType.DrivingLicence]: 'Driving licence',
  [DocumentType.VehicleRegistration]: 'Registration certificate (RC)',
  [DocumentType.Insurance]: 'Insurance policy',
  [DocumentType.Permit]: 'Permit',
  [DocumentType.Fitness]: 'Fitness certificate',
  [DocumentType.PollutionCertificate]: 'Pollution certificate (PUC)',
  [DocumentType.OwnerAuthorisation]: "Owner's authorisation letter",
};

export const REJECTION_LABEL: Record<DocumentRejectionReason, string> = {
  [DocumentRejectionReason.Unreadable]: 'Unreadable or cropped',
  [DocumentRejectionReason.Expired]: 'Already expired',
  [DocumentRejectionReason.NameMismatch]: 'Name does not match the profile',
  [DocumentRejectionReason.NumberMismatch]: 'Number does not match what was entered',
  [DocumentRejectionReason.WrongDocument]: 'Not the document asked for',
  [DocumentRejectionReason.SuspectedForgery]: 'Suspected forgery',
  [DocumentRejectionReason.Other]: 'Other (explain in the note)',
};

export const PARTNER_LABEL: Record<PartnerType, string> = {
  [PartnerType.OwnerDriver]: 'Owner-driver',
  [PartnerType.FleetOwner]: 'Fleet owner',
  [PartnerType.HiredDriver]: 'Hired driver',
};

export type Decision = DecideVerificationRequest['decision'];

export interface DecisionOption {
  value: Decision;
  label: string;
  /** What happens, in plain words. */
  effect: string;
  danger?: boolean;
}

const OPTION: Record<Decision, DecisionOption> = {
  approve: {
    value: 'approve',
    label: 'Approve',
    effect: 'The partner becomes verified and their listed vehicles can appear in search.',
  },
  request_changes: {
    value: 'request_changes',
    label: 'Ask for changes',
    effect: 'The partner is told what to fix and resubmits. They stay out of search meanwhile.',
  },
  reject: {
    value: 'reject',
    label: 'Reject',
    effect: 'The application is closed. The partner cannot take requests.',
    danger: true,
  },
  suspend: {
    value: 'suspend',
    label: 'Suspend',
    effect: 'The partner is removed from search and cannot quote until reinstated.',
    danger: true,
  },
  reinstate: {
    value: 'reinstate',
    label: 'Reinstate',
    effect: 'The suspension is lifted and the partner returns to their verified state.',
  },
};

/** Which decisions make sense from each status. The API has the final say. */
const AVAILABLE: Record<VerificationStatus, Decision[]> = {
  [VerificationStatus.Incomplete]: ['request_changes', 'reject'],
  [VerificationStatus.Pending]: ['approve', 'request_changes', 'reject'],
  [VerificationStatus.ChangesRequested]: ['approve', 'reject'],
  [VerificationStatus.Approved]: ['suspend', 'request_changes'],
  [VerificationStatus.Rejected]: ['request_changes'],
  [VerificationStatus.Suspended]: ['reinstate'],
};

export function decisionsFor(status: VerificationStatus): DecisionOption[] {
  return (AVAILABLE[status] ?? []).map((d) => OPTION[d]);
}

/** Every decision except "approve" must carry a note for the partner and the audit log. */
export function decisionNeedsNote(decision: Decision): boolean {
  return decision !== 'approve';
}
