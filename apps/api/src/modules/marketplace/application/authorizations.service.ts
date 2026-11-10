import { Injectable } from '@nestjs/common';
import { AuthorizationStatus, type CreateAuthorizationRequest, type VehicleAuthorization } from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { maskPhone } from '../../../common/crypto.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { dateOnly, isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { todayInIndia, type AuthorizationRow } from '../infrastructure/rows.js';
import { PartnerService } from './partner.service.js';

export const AUTHORIZATION_INVITED_EVENT = 'authorization.invited';
export interface AuthorizationInvitedEvent {
  authorizationId: string;
  driverUserId: string | null;
  ownerName: string;
  vehicleLabel: string;
}

interface AuthorizationView extends AuthorizationRow {
  vehicle_label: string;
  owner_name: string;
  driver_name: string | null;
}

const SELECT = `
  SELECT a.*, v.make || ' ' || v.model AS vehicle_label, o.display_name AS owner_name, d.display_name AS driver_name
    FROM vehicle_authorizations a
    JOIN vehicles v ON v.id = a.vehicle_id
    JOIN driver_profiles o ON o.id = a.owner_profile_id
    LEFT JOIN driver_profiles d ON d.id = a.driver_profile_id`;

/**
 * Owner-to-driver authorisations: the record that lets someone who is not the
 * registered owner operate a vehicle on the marketplace.
 */
@Injectable()
export class AuthorizationsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly partners: PartnerService,
    private readonly outbox: OutboxService,
  ) {}

  /** Authorisations the caller granted (as owner) or received (as driver, including open invitations). */
  async list(user: AuthUser): Promise<VehicleAuthorization[]> {
    const profile = await this.partners.requireProfile(user);
    const rows = await this.db.query<AuthorizationView>(
      `${SELECT}
        WHERE a.owner_profile_id = $1 OR a.driver_profile_id = $1
           OR (a.driver_phone = $2 AND a.status = 'invited')
        ORDER BY a.created_at DESC`,
      [profile.id, user.phone],
    );
    return rows.map(toDto);
  }

  async create(user: AuthUser, input: CreateAuthorizationRequest): Promise<VehicleAuthorization> {
    const owner = await this.partners.requireProfile(user);
    if (input.driverPhone === user.phone) {
      throw AppError.invalid('driverPhone', 'You already own this vehicle - authorise the person who will drive it.');
    }
    if (input.validUntil && input.validUntil < todayInIndia()) {
      throw AppError.invalid('validUntil', 'The end date must be today or later.');
    }
    const created = await this.db.tx(async () => {
      const vehicle = await this.db.one<{ id: string; owner_profile_id: string; make: string; model: string }>(
        `SELECT id, owner_profile_id, make, model FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
        [input.vehicleId],
      );
      if (!vehicle || vehicle.owner_profile_id !== owner.id) throw AppError.notFound('Vehicle');
      const open = await this.db.one(
        `SELECT 1 FROM vehicle_authorizations WHERE vehicle_id = $1 AND driver_phone = $2 AND status IN ('invited','active')`,
        [vehicle.id, input.driverPhone],
      );
      if (open) throw AppError.conflict('This driver already has an open authorisation for this vehicle.');
      // Resolve the invitee if they already have a partner profile; otherwise they claim it on sign-up.
      const invitee = await this.db.one<{ profile_id: string | null; user_id: string }>(
        `SELECT dp.id AS profile_id, u.id AS user_id FROM users u LEFT JOIN driver_profiles dp ON dp.user_id = u.id
          WHERE u.phone = $1 AND u.status = 'active'`,
        [input.driverPhone],
      );
      const row = await this.db.insert<AuthorizationRow>('vehicle_authorizations', {
        vehicle_id: vehicle.id,
        owner_profile_id: owner.id,
        driver_profile_id: invitee?.profile_id ?? null,
        driver_phone: input.driverPhone,
        valid_until: input.validUntil ?? null,
      });
      await this.audit.record({
        actor: user,
        action: 'authorization.created',
        targetType: 'vehicle_authorization',
        targetId: row.id,
        metadata: { vehicleId: vehicle.id, driver: maskPhone(input.driverPhone) },
      });
      await this.outbox.publish(AUTHORIZATION_INVITED_EVENT, {
        authorizationId: row.id,
        driverUserId: invitee?.user_id ?? null,
        ownerName: owner.display_name,
        vehicleLabel: `${vehicle.make} ${vehicle.model}`,
      } satisfies AuthorizationInvitedEvent);
      return row;
    });
    return this.one(created.id);
  }

  async accept(user: AuthUser, authorizationId: string): Promise<VehicleAuthorization> {
    const profile = await this.partners.requireProfile(user);
    await this.db.tx(async () => {
      const row = await this.db.one<AuthorizationRow>(`SELECT * FROM vehicle_authorizations WHERE id = $1 FOR UPDATE`, [
        authorizationId,
      ]);
      // Only the person the owner named - identified by their verified phone number - may accept.
      if (!row || row.driver_phone !== user.phone) throw AppError.notFound('Authorisation');
      if (row.status !== AuthorizationStatus.Invited) throw AppError.conflict('This invitation is no longer open.');
      const until = dateOnly(row.valid_until);
      if (until && until < todayInIndia()) {
        await this.db.exec(`UPDATE vehicle_authorizations SET status = 'expired', updated_at = now() WHERE id = $1`, [row.id]);
        throw AppError.conflict('This invitation has expired. Ask the owner for a new one.');
      }
      await this.db.exec(
        `UPDATE vehicle_authorizations SET status = 'active', driver_profile_id = $2, updated_at = now() WHERE id = $1`,
        [row.id, profile.id],
      );
      await this.audit.record({ actor: user, action: 'authorization.accepted', targetType: 'vehicle_authorization', targetId: row.id });
    });
    return this.one(authorizationId);
  }

  async revoke(user: AuthUser, authorizationId: string): Promise<VehicleAuthorization> {
    const profile = await this.partners.requireProfile(user);
    await this.db.tx(async () => {
      const row = await this.db.one<AuthorizationRow>(`SELECT * FROM vehicle_authorizations WHERE id = $1 FOR UPDATE`, [
        authorizationId,
      ]);
      const isOwner = row?.owner_profile_id === profile.id;
      const isDriver = row?.driver_profile_id === profile.id || row?.driver_phone === user.phone;
      if (!row || (!isOwner && !isDriver)) throw AppError.notFound('Authorisation');
      if (row.status !== AuthorizationStatus.Invited && row.status !== AuthorizationStatus.Active) {
        throw AppError.conflict('This authorisation has already ended.');
      }
      await this.db.exec(`UPDATE vehicle_authorizations SET status = 'revoked', updated_at = now() WHERE id = $1`, [row.id]);
      // The driver can no longer operate the vehicle: take them offline at once.
      if (row.driver_profile_id) {
        await this.db.exec(
          `UPDATE driver_profiles SET availability = 'offline', active_vehicle_id = NULL, updated_at = now()
            WHERE id = $1 AND active_vehicle_id = $2`,
          [row.driver_profile_id, row.vehicle_id],
        );
      }
      await this.audit.record({
        actor: user,
        action: 'authorization.revoked',
        targetType: 'vehicle_authorization',
        targetId: row.id,
        metadata: { by: isOwner ? 'owner' : 'driver' },
      });
    });
    return this.one(authorizationId);
  }

  /** Marks authorisations past their end date as expired and takes their drivers offline. */
  async expireDue(): Promise<number> {
    const rows = await this.db.query<AuthorizationRow>(
      `UPDATE vehicle_authorizations SET status = 'expired', updated_at = now()
        WHERE status IN ('invited','active') AND valid_until < CURRENT_DATE
        RETURNING *`,
    );
    for (const row of rows) {
      if (!row.driver_profile_id) continue;
      await this.db.exec(
        `UPDATE driver_profiles SET availability = 'offline', active_vehicle_id = NULL, updated_at = now()
          WHERE id = $1 AND active_vehicle_id = $2`,
        [row.driver_profile_id, row.vehicle_id],
      );
    }
    return rows.length;
  }

  private async one(id: string): Promise<VehicleAuthorization> {
    const row = await this.db.one<AuthorizationView>(`${SELECT} WHERE a.id = $1`, [id]);
    if (!row) throw AppError.notFound('Authorisation');
    return toDto(row);
  }
}

function toDto(a: AuthorizationView): VehicleAuthorization {
  return {
    id: a.id,
    vehicleId: a.vehicle_id,
    vehicleLabel: a.vehicle_label,
    ownerProfileId: a.owner_profile_id,
    ownerName: a.owner_name,
    driverProfileId: a.driver_profile_id,
    driverPhoneMasked: maskPhone(a.driver_phone),
    driverName: a.driver_name,
    status: a.status,
    validUntil: dateOnly(a.valid_until),
    createdAt: isoReq(a.created_at),
  };
}
