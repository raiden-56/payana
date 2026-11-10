import type { IsoDate, IsoDateTime, Money, PageQuery, Uuid } from './common.js';
import type { AccountRole, AdminRole, UserStatus } from './identity.js';
import type {
  DocumentRejectionReason,
  DocumentStatus,
  DocumentType,
  DriverProfile,
  ListingStatus,
  PartnerType,
  Vehicle,
  VerificationStatus,
} from './marketplace.js';
import type { BookingStatus, TripType } from './bookings.js';

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface AdminOverview {
  generatedAt: IsoDateTime;
  customers: { total: number; newLast7Days: number };
  drivers: { total: number; verified: number; pendingVerification: number; availableNow: number };
  requests: { openNow: number; last7Days: number; quotedShare: number | null };
  bookings: {
    activeNow: number;
    completedLast7Days: number;
    cancelledLast7Days: number;
    disputed: number;
  };
  revenue: { subscriptionsLast30Days: Money; activeSubscriptions: number };
  support: { openTickets: number; urgentTickets: number };
  documents: { expiringIn30Days: number };
  /** Daily counts for the last 14 days, oldest first. */
  trend: { date: IsoDate; requests: number; bookings: number }[];
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: Uuid;
  phone: string | null;
  email: string | null;
  displayName: string | null;
  roles: AccountRole[];
  status: UserStatus;
  createdAt: IsoDateTime;
  lastSeenAt: IsoDateTime | null;
}

export interface AdminUserQuery extends PageQuery {
  /** Matches phone, email or name. */
  q?: string;
  role?: AccountRole;
  status?: UserStatus;
}

export interface SuspendUserRequest {
  reason: string;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerificationQueueItem {
  driverProfileId: Uuid;
  displayName: string;
  phone: string | null;
  partnerType: PartnerType;
  verificationStatus: VerificationStatus;
  serviceAreas: string[];
  vehicles: number;
  documentsPending: number;
  submittedAt: IsoDateTime | null;
}

export interface VerificationQueueQuery extends PageQuery {
  status?: VerificationStatus;
  regionSlug?: string;
}

/** A document as an administrator sees it: full number and a time-limited file link. */
export interface AdminDocument {
  id: Uuid;
  type: DocumentType;
  vehicleId: Uuid | null;
  documentNumber: string | null;
  expiresOn: IsoDate | null;
  status: DocumentStatus;
  rejectionReason: DocumentRejectionReason | null;
  reviewerNote: string | null;
  /** Signed URL, valid for a few minutes. */
  fileUrl: string;
  contentType: string;
  submittedAt: IsoDateTime;
  reviewedAt: IsoDateTime | null;
  reviewedBy: string | null;
}

export interface VerificationCase {
  profile: DriverProfile;
  phone: string | null;
  vehicles: Vehicle[];
  documents: AdminDocument[];
  history: { at: IsoDateTime; actor: string; action: string; note: string | null }[];
}

export interface ReviewDocumentRequest {
  decision: 'approve' | 'reject';
  /** Required when rejecting. */
  rejectionReason?: DocumentRejectionReason;
  note?: string;
}

export interface DecideVerificationRequest {
  decision: 'approve' | 'request_changes' | 'reject' | 'suspend' | 'reinstate';
  /** Required for every decision except "approve". */
  note?: string;
}

export interface ModerateListingRequest {
  listingStatus: ListingStatus;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export interface AdminBookingRow {
  id: Uuid;
  code: string;
  status: BookingStatus;
  tripType: TripType;
  customerName: string;
  driverName: string;
  pickupLabel: string;
  dropLabel: string | null;
  scheduledAt: IsoDateTime;
  quoted: Money;
  createdAt: IsoDateTime;
}

export interface AdminBookingQuery extends PageQuery {
  status?: BookingStatus;
  q?: string;
  from?: IsoDate;
  to?: IsoDate;
}

export interface ResolveDisputeRequest {
  outcome: 'completed' | 'cancelled_by_admin';
  note: string;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: Uuid;
  at: IsoDateTime;
  actorId: Uuid | null;
  actorLabel: string;
  /** Dotted verb, e.g. "document.approved", "settings.updated", "auth.admin_login_failed". */
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** Non-sensitive context. Never contains secrets, OTPs or full document numbers. */
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
}

export interface AuditLogQuery extends PageQuery {
  action?: string;
  actorId?: Uuid;
  targetType?: string;
  from?: IsoDate;
  to?: IsoDate;
}

// ---------------------------------------------------------------------------
// Staff (super_admin only)
// ---------------------------------------------------------------------------

export interface StaffMember {
  id: Uuid;
  email: string;
  displayName: string;
  adminRole: AdminRole;
  status: UserStatus;
  mfaEnabled: boolean;
  lastLoginAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface CreateStaffRequest {
  email: string;
  displayName: string;
  adminRole: AdminRole;
  /** At least 12 characters. The member must change it and enrol MFA on first sign-in. */
  temporaryPassword: string;
}

export interface UpdateStaffRequest {
  adminRole?: AdminRole;
  status?: Extract<UserStatus, 'active' | 'suspended'>;
}

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
