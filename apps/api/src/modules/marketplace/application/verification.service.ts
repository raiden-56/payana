import { Inject, Injectable } from '@nestjs/common';
import {
  DocumentStatus,
  ListingStatus,
  PartnerType,
  VerificationStatus,
  type AdminDocument,
  type DecideVerificationRequest,
  type ModerateListingRequest,
  type Paginated,
  type ReviewDocumentRequest,
  type Vehicle,
  type VerificationCase,
  type VerificationQueueItem,
  type VerificationQueueQuery,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { decrypt } from '../../../common/crypto.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { dateOnly, iso, isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { UploadsService } from '../../storage/application/uploads.service.js';
import {
  nextVerificationStatus,
  personDocumentsApproved,
  vehicleDocumentsApproved,
  vehicleHasRejectedDocument,
} from '../domain/marketplace-rules.js';
import { toFacts, todayInIndia, type DocumentRow, type DriverProfileRow, type VehicleRow } from '../infrastructure/rows.js';
import { PartnerService } from './partner.service.js';

export const DOCUMENT_REVIEWED_EVENT = 'document.reviewed';
export interface DocumentReviewedEvent {
  userId: string;
  documentType: string;
  approved: boolean;
}
export const VERIFICATION_DECIDED_EVENT = 'verification.decided';
export interface VerificationDecidedEvent {
  userId: string;
  driverProfileId: string;
  status: VerificationStatus;
  note: string | null;
}

interface QueueRow extends DriverProfileRow {
  phone: string | null;
  vehicles: number;
  documents_pending: number;
}

/** Administrator verification of partners, their vehicles and their documents. */
@Injectable()
export class VerificationService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly partners: PartnerService,
    private readonly uploads: UploadsService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Without a status filter the queue is "everything that needs an officer":
   * profiles waiting for review plus approved profiles with a document waiting.
   */
  async queue(q: VerificationQueueQuery): Promise<Paginated<VerificationQueueItem>> {
    const w = pageWindow(q);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`dp.verification_status = $${params.length}`);
    } else {
      where.push(`(dp.verification_status = 'pending' OR pending.n > 0)`);
    }
    if (q.regionSlug) {
      params.push(q.regionSlug);
      where.push(`$${params.length} = ANY(dp.service_areas)`);
    }
    const from = `
      FROM driver_profiles dp
      JOIN users u ON u.id = dp.user_id
      LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM vehicles v WHERE v.owner_profile_id = dp.id AND v.deleted_at IS NULL) veh ON true
      LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM driver_documents d
                          WHERE d.driver_profile_id = dp.id AND d.is_current AND d.status = 'pending') pending ON true
      WHERE ${where.join(' AND ')}`;
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n ${from}`, params);
    const rows = await this.db.query<QueueRow>(
      `SELECT dp.*, u.phone, veh.n AS vehicles, pending.n AS documents_pending ${from}
        ORDER BY dp.submitted_at ASC NULLS LAST, dp.created_at ASC
        LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );
    return paginated(
      rows.map((r) => ({
        driverProfileId: r.id,
        displayName: r.display_name,
        phone: r.phone,
        partnerType: r.partner_type,
        verificationStatus: r.verification_status,
        serviceAreas: r.service_areas,
        vehicles: r.vehicles,
        documentsPending: r.documents_pending,
        submittedAt: iso(r.submitted_at),
      })),
      total?.n ?? 0,
      w,
    );
  }

  async getCase(driverProfileId: string, actor: AuthUser): Promise<VerificationCase> {
    const profile = await this.db.one<DriverProfileRow & { phone: string | null }>(
      `SELECT dp.*, u.phone FROM driver_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.id = $1`,
      [driverProfileId],
    );
    if (!profile) throw AppError.notFound('Driver profile');
    const vehicles = await this.db.query<VehicleRow>(
      `SELECT * FROM vehicles WHERE owner_profile_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [driverProfileId],
    );
    const documents = await this.db.query<DocumentRow>(
      `SELECT * FROM driver_documents WHERE driver_profile_id = $1 AND is_current ORDER BY vehicle_id NULLS FIRST, type`,
      [driverProfileId],
    );
    const history = await this.db.query<{ at: Date; actor_label: string; action: string; note: string | null }>(
      `SELECT at, actor_label, action, note FROM verification_events WHERE driver_profile_id = $1 ORDER BY at DESC LIMIT 100`,
      [driverProfileId],
    );
    // Opening a case exposes full document numbers and files: that access is itself recorded.
    await this.audit.record({ actor, action: 'verification.case_viewed', targetType: 'driver_profile', targetId: driverProfileId });
    return {
      profile: await this.partners.toProfile(profile),
      phone: profile.phone,
      vehicles: await Promise.all(vehicles.map((v) => this.partners.vehicleDto(v))),
      documents: await Promise.all(documents.map((d) => this.toAdminDocument(d))),
      history: history.map((h) => ({ at: isoReq(h.at), actor: h.actor_label, action: h.action, note: h.note })),
    };
  }

  async reviewDocument(documentId: string, input: ReviewDocumentRequest, actor: AuthUser): Promise<AdminDocument> {
    if (input.decision === 'reject' && !input.rejectionReason) {
      throw AppError.invalid('rejectionReason', 'Choose a reason when rejecting a document.');
    }
    const updated = await this.db.tx(async () => {
      const doc = await this.db.one<DocumentRow>(`SELECT * FROM driver_documents WHERE id = $1 FOR UPDATE`, [documentId]);
      if (!doc) throw AppError.notFound('Document');
      if (doc.status !== DocumentStatus.Pending || !doc.is_current) {
        throw AppError.conflict('This document has already been reviewed or replaced.');
      }
      const approved = input.decision === 'approve';
      if (approved) {
        const expires = dateOnly(doc.expires_on);
        if (expires && expires < todayInIndia()) {
          throw AppError.conflict('This document has expired and cannot be approved. Reject it as expired.');
        }
        // The approved document it replaces (a renewal) is now history.
        await this.db.exec(
          `UPDATE driver_documents SET is_current = false
            WHERE driver_profile_id = $1 AND type = $2 AND vehicle_id IS NOT DISTINCT FROM $3
              AND is_current AND id <> $4`,
          [doc.driver_profile_id, doc.type, doc.vehicle_id, doc.id],
        );
      }
      const row = await this.db.update<DocumentRow>(
        'driver_documents',
        { id: doc.id },
        {
          status: approved ? DocumentStatus.Approved : DocumentStatus.Rejected,
          rejection_reason: approved ? null : input.rejectionReason,
          reviewer_note: input.note?.trim() || null,
          reviewed_at: new Date(),
          reviewed_by: actor.id,
          reviewed_by_label: actor.email ?? actor.displayName ?? 'administrator',
          expiry_notice_days: null,
        },
      );
      const profile = await this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE id = $1`, [doc.driver_profile_id]);
      if (doc.vehicle_id && profile) await this.recomputeVehicle(doc.vehicle_id, profile);

      await this.db.insert('verification_events', {
        driver_profile_id: doc.driver_profile_id,
        actor_label: actor.email ?? 'administrator',
        action: approved ? `document_approved:${doc.type}` : `document_rejected:${doc.type}`,
        note: approved ? (input.note ?? null) : [input.rejectionReason, input.note].filter(Boolean).join(' - '),
      });
      await this.audit.record({
        actor,
        action: approved ? 'document.approved' : 'document.rejected',
        targetType: 'driver_document',
        targetId: doc.id,
        metadata: { type: doc.type, driverProfileId: doc.driver_profile_id, vehicleId: doc.vehicle_id, rejectionReason: input.rejectionReason },
      });
      if (profile) {
        await this.outbox.publish(DOCUMENT_REVIEWED_EVENT, {
          userId: profile.user_id,
          documentType: doc.type,
          approved,
        } satisfies DocumentReviewedEvent);
      }
      return row!;
    });
    return this.toAdminDocument(updated);
  }

  async decide(driverProfileId: string, input: DecideVerificationRequest, actor: AuthUser): Promise<VerificationCase> {
    if (input.decision !== 'approve' && !input.note?.trim()) {
      throw AppError.invalid('note', 'Explain this decision - the partner will see the note.');
    }
    await this.db.tx(async () => {
      const profile = await this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE id = $1 FOR UPDATE`, [
        driverProfileId,
      ]);
      if (!profile) throw AppError.notFound('Driver profile');
      const next = nextVerificationStatus(profile.verification_status, input.decision);
      if (!next) {
        throw AppError.conflict(`A profile that is "${profile.verification_status}" cannot be changed with "${input.decision}".`);
      }
      const vehicles = await this.db.query<VehicleRow>(
        `SELECT * FROM vehicles WHERE owner_profile_id = $1 AND deleted_at IS NULL`,
        [driverProfileId],
      );
      const docs = (
        await this.db.query<DocumentRow>(`SELECT * FROM driver_documents WHERE driver_profile_id = $1 AND is_current`, [driverProfileId])
      ).map(toFacts);
      const today = todayInIndia();

      if (input.decision === 'approve' || input.decision === 'reinstate') {
        if (!personDocumentsApproved(profile.partner_type, docs, today)) {
          throw AppError.conflict('Approve the identity and driving-licence documents before approving the partner.');
        }
        if (
          profile.partner_type !== PartnerType.HiredDriver &&
          !vehicles.some((v) => vehicleDocumentsApproved(v.id, docs, today))
        ) {
          throw AppError.conflict('At least one vehicle needs all of its required documents approved first.');
        }
      }

      const live = next === VerificationStatus.Approved;
      await this.db.exec(
        `UPDATE driver_profiles
            SET verification_status = $2, listing_status = $3,
                availability = CASE WHEN $4 THEN availability ELSE 'offline' END, updated_at = now()
          WHERE id = $1`,
        [
          driverProfileId,
          next,
          live ? ListingStatus.Published : next === VerificationStatus.Suspended ? ListingStatus.Suspended : ListingStatus.Unlisted,
          live,
        ],
      );
      if (live) {
        for (const v of vehicles) await this.recomputeVehicle(v.id, { ...profile, verification_status: next });
      } else if (next === VerificationStatus.ChangesRequested || next === VerificationStatus.Rejected) {
        await this.db.exec(
          `UPDATE vehicles SET verification_status = $2, listing_status = 'unlisted', updated_at = now()
            WHERE owner_profile_id = $1 AND deleted_at IS NULL AND verification_status = 'pending'`,
          [driverProfileId, next],
        );
      }
      await this.db.insert('verification_events', {
        driver_profile_id: driverProfileId,
        actor_label: actor.email ?? 'administrator',
        action: `decision:${input.decision}`,
        note: input.note?.trim() || null,
      });
      await this.audit.record({
        actor,
        action: `verification.${input.decision}`,
        targetType: 'driver_profile',
        targetId: driverProfileId,
        metadata: { from: profile.verification_status, to: next },
      });
      await this.outbox.publish(VERIFICATION_DECIDED_EVENT, {
        userId: profile.user_id,
        driverProfileId,
        status: next,
        note: input.note?.trim() || null,
      } satisfies VerificationDecidedEvent);
    });
    return this.getCase(driverProfileId, actor);
  }

  async moderateListing(vehicleId: string, input: ModerateListingRequest, actor: AuthUser): Promise<Vehicle> {
    if (input.listingStatus !== ListingStatus.Published && !input.reason?.trim()) {
      throw AppError.invalid('reason', 'Give a reason for taking a listing down.');
    }
    const row = await this.db.tx(async () => {
      const vehicle = await this.db.one<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [vehicleId]);
      if (!vehicle) throw AppError.notFound('Vehicle');
      if (input.listingStatus === ListingStatus.Published) {
        const docs = (
          await this.db.query<DocumentRow>(`SELECT * FROM driver_documents WHERE vehicle_id = $1 AND is_current`, [vehicleId])
        ).map(toFacts);
        if (vehicle.verification_status !== VerificationStatus.Approved || !vehicleDocumentsApproved(vehicleId, docs, todayInIndia())) {
          throw AppError.conflict('Only an approved vehicle with valid documents can be published.');
        }
      }
      const updated = await this.db.update<VehicleRow>('vehicles', { id: vehicleId }, { listing_status: input.listingStatus, updated_at: new Date() });
      if (input.listingStatus !== ListingStatus.Published) {
        await this.db.exec(
          `UPDATE driver_profiles SET availability = 'offline', active_vehicle_id = NULL, updated_at = now() WHERE active_vehicle_id = $1`,
          [vehicleId],
        );
      }
      await this.db.insert('verification_events', {
        driver_profile_id: vehicle.owner_profile_id,
        actor_label: actor.email ?? 'administrator',
        action: `listing_${input.listingStatus}:${vehicle.registration_number.slice(-4)}`,
        note: input.reason?.trim() || null,
      });
      await this.audit.record({
        actor,
        action: 'listing.moderated',
        targetType: 'vehicle',
        targetId: vehicleId,
        metadata: { from: vehicle.listing_status, to: input.listingStatus, reason: input.reason ?? null },
      });
      return updated!;
    });
    return this.partners.vehicleDto(row);
  }

  /**
   * Brings a vehicle's status in line with its documents: approved and listed
   * once every required document is approved (and its owner is approved);
   * sent back for changes when a submitted document was rejected.
   */
  private async recomputeVehicle(vehicleId: string, owner: Pick<DriverProfileRow, 'verification_status'>): Promise<void> {
    const vehicle = await this.db.one<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [vehicleId]);
    if (!vehicle || vehicle.listing_status === ListingStatus.Suspended) return;
    const docs = (
      await this.db.query<DocumentRow>(`SELECT * FROM driver_documents WHERE vehicle_id = $1 AND is_current`, [vehicleId])
    ).map(toFacts);
    const ok = vehicleDocumentsApproved(vehicleId, docs, todayInIndia());
    if (ok && owner.verification_status === VerificationStatus.Approved) {
      if (vehicle.verification_status !== VerificationStatus.Approved || vehicle.listing_status !== ListingStatus.Published) {
        await this.db.exec(
          `UPDATE vehicles SET verification_status = 'approved', listing_status = 'published', updated_at = now() WHERE id = $1`,
          [vehicleId],
        );
      }
    } else if (!ok && vehicle.verification_status === VerificationStatus.Pending && vehicleHasRejectedDocument(vehicleId, docs)) {
      await this.db.exec(
        `UPDATE vehicles SET verification_status = 'changes_requested', updated_at = now() WHERE id = $1`,
        [vehicleId],
      );
    }
  }

  private async toAdminDocument(d: DocumentRow): Promise<AdminDocument> {
    return {
      id: d.id,
      type: d.type,
      vehicleId: d.vehicle_id,
      documentNumber: d.document_number_enc ? decrypt(d.document_number_enc, this.config.auth.dataEncryptionKey) : null,
      expiresOn: dateOnly(d.expires_on),
      status: d.status,
      rejectionReason: d.rejection_reason,
      reviewerNote: d.reviewer_note,
      fileUrl: await this.uploads.privateUrl(d.file_key, d.content_type),
      contentType: d.content_type,
      submittedAt: isoReq(d.submitted_at),
      reviewedAt: iso(d.reviewed_at),
      reviewedBy: d.reviewed_by_label,
    };
  }
}
