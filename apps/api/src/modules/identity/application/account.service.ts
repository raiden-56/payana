import { Injectable } from '@nestjs/common';
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  ACTIVE_BOOKING_STATUSES,
  ADMIN_ROLE_PERMISSIONS,
  AccountRole,
  MAX_SAVED_PLACES,
  UserStatus,
  VerificationStatus,
  type AdminRole,
  type ConsentPreferences,
  type ConsentPreferencesInput,
  type DeletionRequestStatus,
  type EmergencyContact,
  type Locale,
  type Me,
  type SavedPlace,
  type SavedPlaceInput,
  type UpdateMeRequest,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { iso, isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { SessionService } from './session.service.js';

export interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  display_name: string | null;
  roles: AccountRole[];
  status: UserStatus;
  locale: Locale;
  admin_role: AdminRole | null;
  password_hash: string | null;
  mfa_secret_enc: string | null;
  mfa_enabled: boolean;
  mfa_last_step: string | null;
  failed_login_count: number;
  locked_until: Date | null;
  suspended_reason: string | null;
  deletion_requested_at: Date | null;
  deletion_scheduled_for: Date | null;
  last_seen_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

interface MeRow extends UserRow {
  driver_profile_id: string | null;
  driver_verification_status: VerificationStatus | null;
}

interface SavedPlaceRow {
  id: string;
  label: string;
  address: string | null;
  lat: number;
  lng: number;
  kind: SavedPlace['kind'];
}

export const ACCOUNT_ERASED_EVENT = 'account.erased';
export interface AccountErasedEvent {
  userId: string;
}

/** The signed-in account's own data: profile, safety contact, places, consent, deletion. */
@Injectable()
export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxService,
  ) {}

  async getMe(userId: string): Promise<Me> {
    const row = await this.db.one<MeRow>(
      `SELECT u.*, dp.id AS driver_profile_id, dp.verification_status AS driver_verification_status
         FROM users u LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    if (!row) throw AppError.notFound('Account');
    return toMe(row);
  }

  async update(user: AuthUser, input: UpdateMeRequest): Promise<Me> {
    if (input.email) {
      const taken = await this.db.one(`SELECT 1 FROM users WHERE email = $1 AND id <> $2`, [input.email, user.id]);
      if (taken) throw AppError.conflict('That email address is already linked to another account.');
    }
    await this.db.update(
      'users',
      { id: user.id },
      {
        display_name: input.displayName?.trim(),
        email: input.email === undefined ? undefined : input.email ? input.email.trim().toLowerCase() : null,
        locale: input.locale,
        updated_at: new Date(),
      },
    );
    return this.getMe(user.id);
  }

  // --- emergency contact -------------------------------------------------------

  async getEmergencyContact(userId: string): Promise<EmergencyContact | null> {
    const row = await this.db.one<{ name: string; phone: string; relationship: string | null }>(
      `SELECT name, phone, relationship FROM emergency_contacts WHERE user_id = $1`,
      [userId],
    );
    return row ? { name: row.name, phone: row.phone, relationship: row.relationship ?? undefined } : null;
  }

  async putEmergencyContact(userId: string, input: EmergencyContact): Promise<EmergencyContact> {
    await this.db.exec(
      `INSERT INTO emergency_contacts (user_id, name, phone, relationship) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET name = EXCLUDED.name, phone = EXCLUDED.phone, relationship = EXCLUDED.relationship, updated_at = now()`,
      [userId, input.name.trim(), input.phone, input.relationship?.trim() || null],
    );
    return (await this.getEmergencyContact(userId))!;
  }

  async deleteEmergencyContact(userId: string): Promise<void> {
    await this.db.exec(`DELETE FROM emergency_contacts WHERE user_id = $1`, [userId]);
  }

  // --- saved places --------------------------------------------------------------

  async listSavedPlaces(userId: string): Promise<SavedPlace[]> {
    const rows = await this.db.query<SavedPlaceRow>(
      `SELECT id, label, address, lat, lng, kind FROM saved_places WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows.map(toSavedPlace);
  }

  async addSavedPlace(userId: string, input: SavedPlaceInput): Promise<SavedPlace> {
    const count = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM saved_places WHERE user_id = $1`, [
      userId,
    ]);
    if ((count?.n ?? 0) >= MAX_SAVED_PLACES) {
      throw AppError.conflict(`You can save up to ${MAX_SAVED_PLACES} places. Remove one to add another.`);
    }
    const row = await this.db.insert<SavedPlaceRow>('saved_places', {
      user_id: userId,
      label: input.label.trim(),
      address: input.address?.trim() || null,
      lat: input.location.lat,
      lng: input.location.lng,
      kind: input.kind,
    });
    return toSavedPlace(row);
  }

  async updateSavedPlace(userId: string, placeId: string, input: SavedPlaceInput): Promise<SavedPlace> {
    const row = await this.db.update<SavedPlaceRow>(
      'saved_places',
      { id: placeId, user_id: userId },
      {
        label: input.label.trim(),
        address: input.address?.trim() || null,
        lat: input.location.lat,
        lng: input.location.lng,
        kind: input.kind,
      },
    );
    if (!row) throw AppError.notFound('Saved place');
    return toSavedPlace(row);
  }

  async deleteSavedPlace(userId: string, placeId: string): Promise<void> {
    const n = await this.db.exec(`DELETE FROM saved_places WHERE id = $1 AND user_id = $2`, [placeId, userId]);
    if (n === 0) throw AppError.notFound('Saved place');
  }

  // --- consent ---------------------------------------------------------------------

  async getConsents(userId: string): Promise<ConsentPreferences> {
    const row = await this.db.one<{
      analytics: boolean;
      advertising: boolean;
      marketing_messages: boolean;
      updated_at: Date;
    }>(`SELECT analytics, advertising, marketing_messages, updated_at FROM user_consents WHERE user_id = $1`, [userId]);
    if (!row) return { analytics: false, advertising: false, marketingMessages: false, updatedAt: null };
    return {
      analytics: row.analytics,
      advertising: row.advertising,
      marketingMessages: row.marketing_messages,
      updatedAt: isoReq(row.updated_at),
    };
  }

  async putConsents(user: AuthUser, input: ConsentPreferencesInput): Promise<ConsentPreferences> {
    await this.db.tx(async () => {
      await this.db.exec(
        `INSERT INTO user_consents (user_id, analytics, advertising, marketing_messages) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET analytics = EXCLUDED.analytics, advertising = EXCLUDED.advertising,
               marketing_messages = EXCLUDED.marketing_messages, updated_at = now()`,
        [user.id, input.analytics, input.advertising, input.marketingMessages],
      );
      // Consent changes are evidence under the DPDP Act: keep the trail.
      await this.audit.record({
        actor: user,
        action: 'consent.updated',
        targetType: 'user',
        targetId: user.id,
        metadata: { ...input },
      });
    });
    return this.getConsents(user.id);
  }

  // --- deletion ----------------------------------------------------------------------

  async getDeletionStatus(userId: string): Promise<DeletionRequestStatus> {
    const row = await this.db.one<UserRow>(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (!row) throw AppError.notFound('Account');
    return {
      requested: row.status === UserStatus.DeletionRequested,
      requestedAt: row.status === UserStatus.DeletionRequested ? iso(row.deletion_requested_at) : null,
      scheduledFor: row.status === UserStatus.DeletionRequested ? iso(row.deletion_scheduled_for) : null,
    };
  }

  async requestDeletion(user: AuthUser, reason: string | undefined): Promise<DeletionRequestStatus> {
    if (user.adminRole) {
      throw AppError.forbidden('Staff accounts are removed by a super administrator, not self-service.');
    }
    const active = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM bookings b
        WHERE b.status = ANY($2) AND (b.customer_id = $1
           OR b.driver_profile_id IN (SELECT id FROM driver_profiles WHERE user_id = $1))`,
      [user.id, [...ACTIVE_BOOKING_STATUSES]],
    );
    if ((active?.n ?? 0) > 0) {
      throw AppError.conflict('Finish or cancel your active bookings before deleting the account.');
    }
    const scheduled = new Date(Date.now() + ACCOUNT_DELETION_GRACE_DAYS * 86_400_000);
    await this.db.tx(async () => {
      await this.db.exec(
        `UPDATE users SET status = 'deletion_requested', deletion_requested_at = now(),
                deletion_scheduled_for = $2, deletion_reason = $3, updated_at = now()
          WHERE id = $1 AND status IN ('active','deletion_requested')`,
        [user.id, scheduled, reason?.slice(0, 500) ?? null],
      );
      await this.audit.record({ actor: user, action: 'account.deletion_requested', targetType: 'user', targetId: user.id });
    });
    return this.getDeletionStatus(user.id);
  }

  async cancelDeletion(user: AuthUser): Promise<DeletionRequestStatus> {
    await this.db.tx(async () => {
      const n = await this.db.exec(
        `UPDATE users SET status = 'active', deletion_requested_at = NULL, deletion_scheduled_for = NULL,
                deletion_reason = NULL, updated_at = now()
          WHERE id = $1 AND status = 'deletion_requested'`,
        [user.id],
      );
      if (n > 0) {
        await this.audit.record({ actor: user, action: 'account.deletion_cancelled', targetType: 'user', targetId: user.id });
      }
    });
    return this.getDeletionStatus(user.id);
  }

  /**
   * Erases accounts whose grace period has ended. Personal data is removed or
   * replaced; booking and invoice records stay, pointing at an anonymous
   * account, because they are business records other parties rely on.
   */
  async eraseDueAccounts(now = new Date()): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'deletion_requested' AND deletion_scheduled_for <= $1 LIMIT 100`,
      [now],
    );
    for (const { id } of due) {
      await this.db.tx(async () => {
        await this.db.exec(
          `UPDATE users SET phone = NULL, email = NULL, display_name = NULL, roles = '{}', status = 'deleted',
                  admin_role = NULL, password_hash = NULL, mfa_secret_enc = NULL, mfa_enabled = false,
                  deletion_reason = NULL, deleted_at = now(), updated_at = now()
            WHERE id = $1`,
          [id],
        );
        await this.db.exec(`DELETE FROM emergency_contacts WHERE user_id = $1`, [id]);
        await this.db.exec(`DELETE FROM saved_places WHERE user_id = $1`, [id]);
        await this.db.exec(`DELETE FROM user_consents WHERE user_id = $1`, [id]);
        await this.sessions.revokeAllForUser(id, 'account_erased');
        await this.audit.record({ actor: 'system', action: 'account.erased', targetType: 'user', targetId: id });
        // Other modules scrub their own tables when they hear this.
        await this.outbox.publish(ACCOUNT_ERASED_EVENT, { userId: id } satisfies AccountErasedEvent);
      });
    }
    return due.length;
  }
}

export function toMe(row: MeRow): Me {
  const me: Me = {
    id: row.id,
    phone: row.phone,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles,
    status: row.status,
    locale: row.locale,
    createdAt: isoReq(row.created_at),
  };
  if (row.roles.includes(AccountRole.Driver)) {
    const status = row.driver_verification_status ?? VerificationStatus.Incomplete;
    me.driver = {
      profileId: row.driver_profile_id,
      onboardingComplete: row.driver_profile_id !== null && status !== VerificationStatus.Incomplete,
      verificationStatus: status,
    };
  }
  if (row.roles.includes(AccountRole.Admin) && row.admin_role) {
    me.admin = {
      adminRole: row.admin_role,
      permissions: [...ADMIN_ROLE_PERMISSIONS[row.admin_role]],
      mfaEnabled: row.mfa_enabled,
    };
  }
  return me;
}

function toSavedPlace(r: SavedPlaceRow): SavedPlace {
  return {
    id: r.id,
    label: r.label,
    address: r.address ?? undefined,
    location: { lat: r.lat, lng: r.lng },
    kind: r.kind,
  };
}
