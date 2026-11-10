import type { IsoDateTime, LatLng, Uuid } from './common.js';
import type { VerificationStatus } from './marketplace.js';

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

/** The three primary account roles. One account may hold several. */
export const AccountRole = {
  Customer: 'customer',
  /** Driver, vehicle owner or fleet owner - see PartnerType. */
  Driver: 'driver',
  Admin: 'admin',
} as const;
export type AccountRole = (typeof AccountRole)[keyof typeof AccountRole];

/**
 * Roles inside the administrative hierarchy. `super_admin` is the separate
 * privileged role: it alone manages staff, settings and feature flags, and it
 * always requires MFA.
 */
export const AdminRole = {
  SuperAdmin: 'super_admin',
  VerificationOfficer: 'verification_officer',
  SupportAgent: 'support_agent',
  FinanceManager: 'finance_manager',
  MarketingManager: 'marketing_manager',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const Permission = {
  OverviewRead: 'overview.read',
  UsersRead: 'users.read',
  UsersSuspend: 'users.suspend',
  VerificationRead: 'verification.read',
  VerificationReview: 'verification.review',
  ListingsModerate: 'listings.moderate',
  BookingsRead: 'bookings.read',
  BookingsResolve: 'bookings.resolve',
  RefundsProcess: 'refunds.process',
  PlansManage: 'plans.manage',
  PaymentsReconcile: 'payments.reconcile',
  AdsManage: 'ads.manage',
  CatalogManage: 'catalog.manage',
  PackagesManage: 'packages.manage',
  SupportManage: 'support.manage',
  ReviewsModerate: 'reviews.moderate',
  ReportsFinancial: 'reports.financial',
  NotificationsManage: 'notifications.manage',
  AuditRead: 'audit.read',
  SettingsRead: 'settings.read',
  SettingsManage: 'settings.manage',
  StaffManage: 'staff.manage',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const P = Permission;

/**
 * The single source of truth for which admin role may do what.
 * The API enforces it on every admin endpoint; the web client reads it only
 * to decide which navigation items to show.
 */
export const ADMIN_ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly Permission[]>> = {
  [AdminRole.SuperAdmin]: Object.values(Permission),
  [AdminRole.VerificationOfficer]: [
    P.OverviewRead,
    P.UsersRead,
    P.VerificationRead,
    P.VerificationReview,
    P.ListingsModerate,
  ],
  [AdminRole.SupportAgent]: [
    P.OverviewRead,
    P.UsersRead,
    P.UsersSuspend,
    P.VerificationRead,
    P.BookingsRead,
    P.BookingsResolve,
    P.SupportManage,
    P.ReviewsModerate,
  ],
  [AdminRole.FinanceManager]: [
    P.OverviewRead,
    P.BookingsRead,
    P.RefundsProcess,
    P.PlansManage,
    P.PaymentsReconcile,
    P.ReportsFinancial,
  ],
  [AdminRole.MarketingManager]: [
    P.OverviewRead,
    P.AdsManage,
    P.PackagesManage,
    P.NotificationsManage,
    P.SettingsRead,
  ],
};

export const UserStatus = {
  Active: 'active',
  Suspended: 'suspended',
  DeletionRequested: 'deletion_requested',
  Deleted: 'deleted',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// ---------------------------------------------------------------------------
// Phone OTP sign-in (customers and drivers)
// ---------------------------------------------------------------------------

/** Which side of the marketplace the person is signing in to. */
export type SignInIntent = 'customer' | 'driver';

export interface OtpRequest {
  /** E.164, +91XXXXXXXXXX. */
  phone: string;
  intent?: SignInIntent;
}

export interface OtpChallenge {
  challengeId: Uuid;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /**
   * The code itself. Only ever present when the API runs with the development
   * SMS adapter (never in production) so the flow can be exercised without an
   * SMS gateway.
   */
  devCode?: string;
}

export interface OtpVerifyRequest {
  challengeId: Uuid;
  /** 6 digits. */
  code: string;
  intent?: SignInIntent;
  /** Shown in the session list, e.g. "Chrome on Android". */
  deviceLabel?: string;
}

export const OTP_LENGTH = 6;

/**
 * Returned by every successful sign-in and refresh.
 *
 * The refresh token is NOT in this body for browsers: it is set as an
 * HttpOnly, Secure, SameSite=Strict cookie scoped to /api/v1/auth.
 * Native clients send `X-Client-Platform: native` and receive `refreshToken`
 * here, to be kept in the platform secure store.
 */
export interface AuthSession {
  accessToken: string;
  accessTokenExpiresAt: IsoDateTime;
  refreshToken?: string;
  me: Me;
}

export const CLIENT_PLATFORM_HEADER = 'X-Client-Platform';

export interface RefreshRequest {
  /** Native clients only. Browsers rely on the cookie. */
  refreshToken?: string;
}

export interface SessionInfo {
  id: Uuid;
  deviceLabel: string | null;
  createdAt: IsoDateTime;
  lastUsedAt: IsoDateTime;
  current: boolean;
}

// ---------------------------------------------------------------------------
// Administrator sign-in (email + password + TOTP)
// ---------------------------------------------------------------------------

export interface AdminLoginRequest {
  email: string;
  password: string;
}

export type AdminLoginResponse =
  | { status: 'authenticated'; session: AuthSession }
  | { status: 'mfa_required'; mfaToken: string }
  | {
      /** First sign-in of a role that must use MFA: enrol before continuing. */
      status: 'mfa_enrollment_required';
      mfaToken: string;
      otpauthUrl: string;
      secret: string;
    };

export interface AdminMfaVerifyRequest {
  mfaToken: string;
  /** 6-digit TOTP code. */
  code: string;
}

// ---------------------------------------------------------------------------
// Current account
// ---------------------------------------------------------------------------

export interface Me {
  id: Uuid;
  /** E.164. Null for administrator accounts that sign in by email. */
  phone: string | null;
  email: string | null;
  displayName: string | null;
  roles: AccountRole[];
  status: UserStatus;
  locale: Locale;
  createdAt: IsoDateTime;
  /** Present when the account holds the driver role. */
  driver?: {
    profileId: Uuid | null;
    onboardingComplete: boolean;
    verificationStatus: VerificationStatus;
  };
  /** Present when the account holds the admin role. */
  admin?: {
    adminRole: AdminRole;
    permissions: Permission[];
    mfaEnabled: boolean;
  };
}

export const Locale = { En: 'en', Kn: 'kn', Hi: 'hi' } as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

export interface UpdateMeRequest {
  displayName?: string;
  email?: string | null;
  locale?: Locale;
}

export interface EmergencyContact {
  name: string;
  /** E.164. */
  phone: string;
  relationship?: string;
}

export interface SavedPlace {
  id: Uuid;
  label: string;
  address?: string;
  location: LatLng;
  kind: 'home' | 'stay' | 'work' | 'other';
}
export type SavedPlaceInput = Omit<SavedPlace, 'id'>;
export const MAX_SAVED_PLACES = 10;

/**
 * Consent the account holder has given. Every flag defaults to false.
 * Essential processing (running a booking) does not depend on any of them.
 */
export interface ConsentPreferences {
  /** Usage measurement (Google Analytics). */
  analytics: boolean;
  /** Advertising measurement and personalisation (Google Ads). */
  advertising: boolean;
  /** Offers and news by SMS / WhatsApp / email. */
  marketingMessages: boolean;
  updatedAt: IsoDateTime | null;
}
export type ConsentPreferencesInput = Omit<ConsentPreferences, 'updatedAt'>;

export interface DeletionRequestStatus {
  requested: boolean;
  requestedAt: IsoDateTime | null;
  /** After this moment the account is erased and cannot be recovered. */
  scheduledFor: IsoDateTime | null;
}
export interface DeletionRequestInput {
  reason?: string;
}
/** Days between a deletion request and erasure, during which it can be cancelled. */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;
