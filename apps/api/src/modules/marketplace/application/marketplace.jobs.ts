import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import type { DocumentType } from '@payana/contracts';
import { Db } from '../../../common/db/db.service.js';
import { dateOnly } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { JobLock } from '../../../common/redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { ACCOUNT_ERASED_EVENT, type AccountErasedEvent } from '../../identity/application/account.service.js';
import { USER_SUSPENDED_EVENT, type UserSuspendedEvent } from '../../identity/application/users-admin.service.js';
import { UploadsService } from '../../storage/application/uploads.service.js';
import { AuthorizationsService } from './authorizations.service.js';

export const DOCUMENT_EXPIRING_EVENT = 'document.expiring';
export interface DocumentExpiringEvent {
  userId: string;
  documentType: DocumentType;
  expiresOn: string;
  /** Days until expiry; 0 or negative means it has expired. */
  daysLeft: number;
}

interface ExpiryRow {
  id: string;
  type: DocumentType;
  vehicle_id: string | null;
  expires_on: Date | string;
  user_id: string;
  days_left: number;
}

/** Scheduled upkeep of marketplace data, and reactions to account events. */
@Injectable()
export class MarketplaceJobs {
  private readonly logger = new Logger('MarketplaceJobs');

  constructor(
    private readonly db: Db,
    private readonly outbox: OutboxService,
    private readonly authorizations: AuthorizationsService,
    private readonly uploads: UploadsService,
    private readonly lock: JobLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    await this.lock.runExclusive('marketplace-upkeep', 600, async () => {
      const expired = await this.expireDocuments();
      const notified = await this.sendExpiryNotices();
      const auths = await this.authorizations.expireDue();
      if (expired || notified || auths) {
        this.logger.log({ expired, notified, authorizationsExpired: auths }, 'Marketplace upkeep');
      }
    });
  }

  /**
   * DEVELOPMENT ONLY (DEMO_POSITION_HEARTBEAT=true, never in production).
   * The demo seed places drivers with live and recent positions; without real
   * devices reporting, all of them would read as stale fifteen minutes later.
   * This re-stamps only the rows the seed registered under 'demo_positions'.
   */
  @Interval(60_000)
  async demoHeartbeat(): Promise<void> {
    if (!this.config.demoPositionHeartbeat) return;
    await this.db
      .exec(
        `UPDATE driver_profiles dp
            SET location_updated_at = now() - CASE WHEN e->>'freshness' = 'live' THEN interval '20 seconds' ELSE interval '6 minutes' END
           FROM platform_settings ps, jsonb_array_elements(ps.value) e
          WHERE ps.key = 'demo_positions' AND dp.id = (e->>'profileId')::uuid`,
      )
      .catch(() => undefined);
  }

  /**
   * Approved documents past their expiry date become "expired". Search and
   * availability already ignore them by date; this keeps the stored status
   * honest, takes affected drivers offline and tells the partner.
   */
  async expireDocuments(): Promise<number> {
    return this.db.tx(async () => {
      const rows = await this.db.query<ExpiryRow>(
        `UPDATE driver_documents d SET status = 'expired'
           FROM driver_profiles dp
          WHERE dp.id = d.driver_profile_id AND d.is_current AND d.status = 'approved' AND d.expires_on < CURRENT_DATE
        RETURNING d.id, d.type, d.vehicle_id, d.expires_on, dp.user_id, 0 AS days_left`,
      );
      for (const row of rows) {
        if (row.vehicle_id) {
          await this.db.exec(
            `UPDATE driver_profiles SET availability = 'offline', active_vehicle_id = NULL, updated_at = now()
              WHERE active_vehicle_id = $1`,
            [row.vehicle_id],
          );
        } else {
          await this.db.exec(
            `UPDATE driver_profiles SET availability = 'offline', updated_at = now() WHERE user_id = $1`,
            [row.user_id],
          );
        }
        await this.outbox.publish(DOCUMENT_EXPIRING_EVENT, {
          userId: row.user_id,
          documentType: row.type,
          expiresOn: dateOnly(row.expires_on)!,
          daysLeft: 0,
        } satisfies DocumentExpiringEvent);
      }
      return rows.length;
    });
  }

  /** One reminder at 30 days and one at 7 days before an approved document expires. */
  async sendExpiryNotices(): Promise<number> {
    return this.db.tx(async () => {
      const rows = await this.db.query<ExpiryRow>(
        `SELECT d.id, d.type, d.vehicle_id, d.expires_on, dp.user_id, (d.expires_on - CURRENT_DATE)::int AS days_left
           FROM driver_documents d JOIN driver_profiles dp ON dp.id = d.driver_profile_id
          WHERE d.is_current AND d.status = 'approved'
            AND d.expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
            AND (d.expiry_notice_days IS NULL OR (d.expiry_notice_days > 7 AND d.expires_on <= CURRENT_DATE + 7))
          FOR UPDATE OF d SKIP LOCKED`,
      );
      for (const row of rows) {
        await this.db.exec(`UPDATE driver_documents SET expiry_notice_days = $2 WHERE id = $1`, [
          row.id,
          row.days_left <= 7 ? 7 : 30,
        ]);
        await this.outbox.publish(DOCUMENT_EXPIRING_EVENT, {
          userId: row.user_id,
          documentType: row.type,
          expiresOn: dateOnly(row.expires_on)!,
          daysLeft: row.days_left,
        } satisfies DocumentExpiringEvent);
      }
      return rows.length;
    });
  }

  @OnEvent(USER_SUSPENDED_EVENT, { suppressErrors: false })
  async onUserSuspended(event: UserSuspendedEvent): Promise<void> {
    await this.db.exec(`UPDATE driver_profiles SET availability = 'offline', updated_at = now() WHERE user_id = $1`, [
      event.userId,
    ]);
  }

  /** An erased account's partner data is removed or anonymised; trip history keeps an anonymous party. */
  @OnEvent(ACCOUNT_ERASED_EVENT, { suppressErrors: false })
  async onAccountErased(event: AccountErasedEvent): Promise<void> {
    const profile = await this.db.one<{ id: string; photo_key: string | null }>(
      `SELECT id, photo_key FROM driver_profiles WHERE user_id = $1`,
      [event.userId],
    );
    if (!profile) return;
    const documents = await this.db.query<{ file_key: string }>(
      `SELECT file_key FROM driver_documents WHERE driver_profile_id = $1`,
      [profile.id],
    );
    const vehicles = await this.db.query<{ photo_keys: string[] }>(`SELECT photo_keys FROM vehicles WHERE owner_profile_id = $1`, [
      profile.id,
    ]);
    await this.db.exec(
      `UPDATE driver_profiles
          SET display_name = 'Former partner', bio = NULL, photo_key = NULL, languages = '{}', operating_hours = NULL,
              listing_status = 'unlisted', availability = 'offline', active_vehicle_id = NULL,
              last_lat = NULL, last_lng = NULL, location_updated_at = NULL, updated_at = now()
        WHERE id = $1`,
      [profile.id],
    );
    await this.db.exec(
      `UPDATE vehicles SET deleted_at = COALESCE(deleted_at, now()), listing_status = 'unlisted', photo_keys = '{}' WHERE owner_profile_id = $1`,
      [profile.id],
    );
    await this.db.exec(
      `UPDATE vehicle_authorizations SET status = 'revoked', updated_at = now()
        WHERE (owner_profile_id = $1 OR driver_profile_id = $1) AND status IN ('invited','active')`,
      [profile.id],
    );
    await this.db.exec(`DELETE FROM driver_documents WHERE driver_profile_id = $1`, [profile.id]);
    const keys = [profile.photo_key, ...documents.map((d) => d.file_key), ...vehicles.flatMap((v) => v.photo_keys)].filter(
      (k): k is string => !!k,
    );
    for (const key of keys) await this.uploads.remove(key);
  }
}
