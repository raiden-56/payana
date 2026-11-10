import { Inject, Injectable } from '@nestjs/common';
import {
  AvailabilityStatus,
  DocumentStatus,
  DocumentType,
  ErrorCode,
  FeatureFlag,
  ListingStatus,
  PartnerType,
  REQUIRED_VEHICLE_DOCUMENT_TYPES,
  UploadPurpose,
  VerificationStatus,
  type DriverDocument,
  type DriverProfile,
  type LocationPing,
  type SubmitDocumentRequest,
  type UpdateAvailabilityRequest,
  type UpdateRatesRequest,
  type UpsertDriverProfileRequest,
  type UpsertVehicleRequest,
  type Vehicle,
} from '@payana/contracts';
import type { Redis } from 'ioredis';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { encrypt } from '../../../common/crypto.js';
import { Db, json } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { isoReq } from '../../../common/money.js';
import { ENTITLEMENTS, type EntitlementsPort } from '../../../common/ports.js';
import { REDIS } from '../../../common/redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import { SettingsService } from '../../platform/application/settings.service.js';
import { UploadsService } from '../../storage/application/uploads.service.js';
import {
  EDITABLE_STATUSES,
  isPersonDocument,
  isUnexpired,
  normalizeRegistration,
  onboardingChecklist,
  personDocumentsApproved,
  validateRates,
  vehicleDocumentsApproved,
} from '../domain/marketplace-rules.js';
import {
  toDriverDocument,
  toFacts,
  toVehicle,
  todayInIndia,
  type DocumentRow,
  type DriverProfileRow,
  type VehicleRow,
} from '../infrastructure/rows.js';

const MAX_LANGUAGES = 6;
const LOCATION_MAX_AGE_MS = 5 * 60_000;
const LOCATION_MAX_FUTURE_MS = 60_000;
/** Document types that are meaningless without an expiry date. */
const EXPIRY_REQUIRED: readonly DocumentType[] = [
  DocumentType.DrivingLicence,
  DocumentType.Insurance,
  DocumentType.Permit,
  DocumentType.Fitness,
  DocumentType.PollutionCertificate,
];

/** What a driver, vehicle owner or fleet owner does to their own listing. */
@Injectable()
export class PartnerService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly uploads: UploadsService,
    private readonly settings: SettingsService,
    @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementsPort,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // --- profile --------------------------------------------------------------------

  async getOwnProfile(user: AuthUser): Promise<DriverProfile | null> {
    const row = await this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE user_id = $1`, [user.id]);
    return row ? this.toProfile(row) : null;
  }

  async upsertProfile(user: AuthUser, input: UpsertDriverProfileRequest): Promise<DriverProfile> {
    if (input.languages.length > MAX_LANGUAGES) throw AppError.invalid('languages', `List at most ${MAX_LANGUAGES} languages.`);
    await this.catalog.assertRegionSlugs(input.serviceAreas, 'serviceAreas');
    if (input.operatingHours && input.operatingHours.from === input.operatingHours.to) {
      throw AppError.invalid('operatingHours', 'Opening and closing time cannot be the same.');
    }
    let photoKey: string | null | undefined;
    if (input.photoKey) {
      await this.uploads.claim(user.id, input.photoKey, UploadPurpose.ProfilePhoto, 'photoKey');
      photoKey = input.photoKey;
    } else if (input.photoKey === null) photoKey = null;

    const row = await this.db.tx(async () => {
      const existing = await this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE user_id = $1 FOR UPDATE`, [
        user.id,
      ]);
      const values = {
        partner_type: input.partnerType,
        display_name: input.displayName.trim(),
        bio: input.bio?.trim() || null,
        languages: [...new Set(input.languages.map((l) => l.trim()).filter(Boolean))],
        years_experience: input.yearsExperience ?? null,
        service_areas: [...new Set(input.serviceAreas)],
        operating_hours: json(input.operatingHours ?? null),
        photo_key: photoKey,
      };
      if (!existing) {
        await this.settings.requireFeature(FeatureFlag.DriverSignUp);
        const created = await this.db.insert<DriverProfileRow>('driver_profiles', { user_id: user.id, ...values });
        if (!user.displayName) {
          await this.db.exec(`UPDATE users SET display_name = $2 WHERE id = $1 AND display_name IS NULL`, [user.id, values.display_name]);
        }
        await this.audit.record({ actor: user, action: 'driver_profile.created', targetType: 'driver_profile', targetId: created.id });
        return created;
      }
      // The partner type decides which documents are required, so it is fixed once review has started.
      if (existing.partner_type !== input.partnerType && !EDITABLE_STATUSES.includes(existing.verification_status)) {
        throw AppError.conflict('The partner type cannot be changed after verification has started. Contact support.');
      }
      return (await this.db.update<DriverProfileRow>('driver_profiles', { id: existing.id }, { ...values, updated_at: new Date() }))!;
    });
    return this.toProfile(row);
  }

  async submitForReview(user: AuthUser): Promise<DriverProfile> {
    const profile = await this.requireProfile(user);
    const row = await this.db.tx(async () => {
      const locked = await this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE id = $1 FOR UPDATE`, [profile.id]);
      if (!locked) throw AppError.notFound('Profile');
      if (!EDITABLE_STATUSES.includes(locked.verification_status)) {
        throw AppError.conflict(
          locked.verification_status === VerificationStatus.Pending
            ? 'Your profile is already waiting for review.'
            : 'Your profile has already been reviewed.',
        );
      }
      const checklist = await this.checklist(locked);
      if (!checklist.readyForReview) {
        throw AppError.conflict('Complete your profile, vehicle and documents before asking for review.');
      }
      await this.db.exec(
        `UPDATE vehicles SET verification_status = 'pending', updated_at = now()
          WHERE owner_profile_id = $1 AND deleted_at IS NULL AND verification_status IN ('incomplete','changes_requested','rejected')`,
        [locked.id],
      );
      const updated = await this.db.one<DriverProfileRow>(
        `UPDATE driver_profiles SET verification_status = 'pending', submitted_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [locked.id],
      );
      await this.db.insert('verification_events', {
        driver_profile_id: locked.id,
        actor_label: locked.display_name,
        action: 'submitted_for_review',
      });
      await this.audit.record({ actor: user, action: 'verification.submitted', targetType: 'driver_profile', targetId: locked.id });
      return updated!;
    });
    return this.toProfile(row);
  }

  // --- vehicles ----------------------------------------------------------------------

  async listVehicles(user: AuthUser): Promise<Vehicle[]> {
    const profile = await this.requireProfile(user);
    const rows = await this.db.query<VehicleRow>(
      `SELECT * FROM vehicles WHERE owner_profile_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [profile.id],
    );
    return Promise.all(rows.map((v) => this.vehicleDto(v)));
  }

  async createVehicle(user: AuthUser, input: UpsertVehicleRequest): Promise<Vehicle> {
    const profile = await this.requireProfile(user);
    if (profile.partner_type === PartnerType.HiredDriver) {
      throw AppError.conflict('Hired drivers operate vehicles owned by someone else. Change your partner type to add your own vehicle.');
    }
    const values = await this.vehicleValues(user, input);
    const row = await this.db.tx(async () => {
      // Lock the profile so two parallel creates cannot both slip under the plan limit.
      await this.db.one(`SELECT id FROM driver_profiles WHERE id = $1 FOR UPDATE`, [profile.id]);
      const count = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM vehicles WHERE owner_profile_id = $1 AND deleted_at IS NULL`,
        [profile.id],
      );
      const plan = await this.entitlements.forDriver(profile.id);
      if ((count?.n ?? 0) >= plan.maxVehicles) {
        throw new AppError(
          403,
          ErrorCode.EntitlementExceeded,
          'Plan limit reached',
          `Your plan allows ${plan.maxVehicles} vehicle${plan.maxVehicles === 1 ? '' : 's'}. Upgrade to list more.`,
        );
      }
      await this.assertRegistrationFree(values.registration_number as string, null);
      const created = await this.db.insert<VehicleRow>('vehicles', { owner_profile_id: profile.id, ...values });
      await this.audit.record({ actor: user, action: 'vehicle.created', targetType: 'vehicle', targetId: created.id });
      return created;
    });
    return this.vehicleDto(row);
  }

  async updateVehicle(user: AuthUser, vehicleId: string, input: UpsertVehicleRequest): Promise<Vehicle> {
    const profile = await this.requireProfile(user);
    const values = await this.vehicleValues(user, input);
    const row = await this.db.tx(async () => {
      const existing = await this.ownedVehicle(profile.id, vehicleId, true);
      await this.assertRegistrationFree(values.registration_number as string, existing.id);
      const identityChanged =
        existing.registration_number !== values.registration_number || existing.category_code !== values.category_code;
      const extra: Record<string, unknown> = { updated_at: new Date() };
      if (input.photoKeys === undefined) delete values.photo_keys;
      if (identityChanged) {
        // The documents on file describe the old registration / class: the vehicle must be reviewed again.
        if (existing.verification_status === VerificationStatus.Approved) {
          extra.verification_status = VerificationStatus.Pending;
          extra.listing_status = ListingStatus.Unlisted;
        }
        extra.base_fare_minor = null;
        extra.per_km_minor = null;
        extra.per_hour_waiting_minor = null;
        extra.full_day_minor = null;
        await this.db.exec(
          `UPDATE driver_documents SET is_current = false WHERE vehicle_id = $1 AND is_current`,
          [existing.id],
        );
        await this.audit.record({
          actor: user,
          action: 'vehicle.identity_changed',
          targetType: 'vehicle',
          targetId: existing.id,
          metadata: { requiresReview: true },
        });
      }
      const updated = await this.db.update<VehicleRow>('vehicles', { id: existing.id }, { ...values, ...extra });
      if (identityChanged) await this.takeOfflineIfActive(existing.id);
      return updated!;
    });
    return this.vehicleDto(row);
  }

  async deleteVehicle(user: AuthUser, vehicleId: string): Promise<void> {
    const profile = await this.requireProfile(user);
    await this.db.tx(async () => {
      const existing = await this.ownedVehicle(profile.id, vehicleId, true);
      // Read-only integrity check against the bookings table: a vehicle on a live booking stays.
      const active = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM bookings
          WHERE vehicle_id = $1 AND status IN ('confirmed','driver_en_route','driver_arrived','in_progress')`,
        [existing.id],
      );
      if ((active?.n ?? 0) > 0) throw AppError.conflict('This vehicle has an active booking. Finish or cancel it first.');
      await this.takeOfflineIfActive(existing.id);
      await this.db.exec(
        `UPDATE vehicles SET deleted_at = now(), listing_status = 'unlisted', updated_at = now() WHERE id = $1`,
        [existing.id],
      );
      await this.db.exec(
        `UPDATE vehicle_authorizations SET status = 'revoked', updated_at = now() WHERE vehicle_id = $1 AND status IN ('invited','active')`,
        [existing.id],
      );
      await this.audit.record({ actor: user, action: 'vehicle.deleted', targetType: 'vehicle', targetId: existing.id });
    });
  }

  async updateRates(user: AuthUser, input: UpdateRatesRequest): Promise<Vehicle> {
    const profile = await this.requireProfile(user);
    const vehicle = await this.ownedVehicle(profile.id, input.vehicleId, false);
    const category = await this.catalog.findCategory(vehicle.category_code);
    if (!category) throw AppError.conflict('This vehicle category is no longer available.');
    const errors = validateRates(input, {
      minPerKmMinor: category.min_per_km_minor,
      maxPerKmMinor: category.max_per_km_minor,
      baseFareMinor: category.base_fare_minor,
      perHourWaitingMinor: category.per_hour_waiting_minor,
    });
    if (errors.length > 0) throw AppError.validation(errors, 'These rates are outside the platform pricing rules.');
    const updated = await this.db.update<VehicleRow>(
      'vehicles',
      { id: vehicle.id },
      {
        base_fare_minor: input.baseFareMinor,
        per_km_minor: input.perKmMinor,
        per_hour_waiting_minor: input.perHourWaitingMinor,
        full_day_minor: input.fullDayMinor ?? null,
        updated_at: new Date(),
      },
    );
    return this.vehicleDto(updated!);
  }

  // --- documents ---------------------------------------------------------------------

  async listDocuments(user: AuthUser): Promise<DriverDocument[]> {
    const profile = await this.requireProfile(user);
    const rows = await this.db.query<DocumentRow>(
      `SELECT * FROM driver_documents WHERE driver_profile_id = $1 AND is_current ORDER BY submitted_at DESC`,
      [profile.id],
    );
    return rows.map(toDriverDocument);
  }

  async submitDocument(user: AuthUser, input: SubmitDocumentRequest): Promise<DriverDocument> {
    const profile = await this.requireProfile(user);
    const personDoc = isPersonDocument(input.type);
    if (personDoc && input.vehicleId) throw AppError.invalid('vehicleId', 'This document is about you, not a vehicle.');
    if (!personDoc && !input.vehicleId) throw AppError.invalid('vehicleId', 'Choose the vehicle this document belongs to.');
    if (input.vehicleId) await this.ownedVehicle(profile.id, input.vehicleId, false);

    const today = todayInIndia();
    if (EXPIRY_REQUIRED.includes(input.type) && !input.expiresOn) {
      throw AppError.invalid('expiresOn', 'Enter the expiry date printed on this document.');
    }
    if (input.expiresOn && !isUnexpired(input.expiresOn, today)) {
      throw AppError.invalid('expiresOn', 'This document has already expired. Upload the renewed one.');
    }
    const { contentType } = await this.uploads.claim(user.id, input.fileKey, UploadPurpose.DriverDocument, 'fileKey');
    const number = input.documentNumber?.replace(/\s+/g, '').toUpperCase() || null;

    const row = await this.db.tx(async () => {
      const reused = await this.db.one(`SELECT 1 FROM driver_documents WHERE file_key = $1`, [input.fileKey]);
      if (reused) throw AppError.invalid('fileKey', 'This file is already attached to a document. Upload a new file.');
      // An approved document stays in force until its replacement is approved; only
      // earlier pending or rejected submissions of the same kind are superseded.
      await this.db.exec(
        `UPDATE driver_documents SET is_current = false
          WHERE driver_profile_id = $1 AND type = $2 AND vehicle_id IS NOT DISTINCT FROM $3
            AND is_current AND status IN ('pending','rejected','expired')`,
        [profile.id, input.type, input.vehicleId ?? null],
      );
      const created = await this.db.insert<DocumentRow>('driver_documents', {
        driver_profile_id: profile.id,
        vehicle_id: input.vehicleId ?? null,
        type: input.type,
        // Numbers of identity documents are encrypted at rest; only the last four characters are kept in clear.
        document_number_enc: number ? encrypt(number, this.config.auth.dataEncryptionKey) : null,
        document_number_tail: number ? number.slice(-4) : null,
        expires_on: input.expiresOn ?? null,
        file_key: input.fileKey,
        content_type: contentType,
      });
      await this.audit.record({
        actor: user,
        action: 'document.submitted',
        targetType: 'driver_document',
        targetId: created.id,
        metadata: { type: input.type, vehicleId: input.vehicleId ?? null },
      });
      return created;
    });
    return toDriverDocument(row);
  }

  // --- availability and location --------------------------------------------------------

  async updateAvailability(user: AuthUser, input: UpdateAvailabilityRequest): Promise<DriverProfile> {
    const profile = await this.requireProfile(user);
    if (input.status === AvailabilityStatus.Offline) {
      const row = await this.db.update<DriverProfileRow>(
        'driver_profiles',
        { id: profile.id },
        { availability: AvailabilityStatus.Offline, updated_at: new Date() },
      );
      return this.toProfile(row!);
    }

    if (profile.verification_status !== VerificationStatus.Approved) {
      throw AppError.forbidden('Your profile must be verified before you can go online.', ErrorCode.DriverNotVerified);
    }
    const vehicleId = input.vehicleId ?? profile.active_vehicle_id;
    if (!vehicleId) throw AppError.invalid('vehicleId', 'Choose the vehicle you are driving.');
    await this.assertCanOperate(profile, vehicleId);

    const row = await this.db.update<DriverProfileRow>(
      'driver_profiles',
      { id: profile.id },
      { availability: input.status, active_vehicle_id: vehicleId, updated_at: new Date() },
    );
    return this.toProfile(row!);
  }

  /**
   * The rule that separates the registered owner from the person driving:
   * a partner may operate a vehicle only if they own it or hold an active
   * authorisation from its owner, and only while the vehicle and the driver's
   * own documents are approved and unexpired.
   */
  async assertCanOperate(profile: DriverProfileRow, vehicleId: string): Promise<VehicleRow> {
    const vehicle = await this.db.one<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL`, [vehicleId]);
    if (!vehicle) throw AppError.invalid('vehicleId', 'This vehicle does not exist.');
    if (vehicle.owner_profile_id !== profile.id) {
      const auth = await this.db.one(
        `SELECT 1 FROM vehicle_authorizations
          WHERE vehicle_id = $1 AND driver_profile_id = $2 AND status = 'active'
            AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)`,
        [vehicleId, profile.id],
      );
      if (!auth) {
        throw AppError.forbidden(
          'You are not authorised to operate this vehicle. Ask the owner to authorise you.',
          ErrorCode.VehicleNotAuthorized,
        );
      }
    }
    if (vehicle.verification_status !== VerificationStatus.Approved || vehicle.listing_status !== ListingStatus.Published) {
      throw AppError.forbidden('This vehicle has not been approved for the marketplace yet.', ErrorCode.DriverNotVerified);
    }
    const today = todayInIndia();
    const docs = (
      await this.db.query<DocumentRow>(
        `SELECT * FROM driver_documents
          WHERE is_current AND ((driver_profile_id = $1 AND vehicle_id IS NULL) OR vehicle_id = $2)`,
        [profile.id, vehicleId],
      )
    ).map(toFacts);
    if (!vehicleDocumentsApproved(vehicleId, docs, today)) {
      throw AppError.conflict(
        `A required vehicle document (${REQUIRED_VEHICLE_DOCUMENT_TYPES.join(', ')}) is missing or expired.`,
        ErrorCode.DocumentExpired,
      );
    }
    if (!personDocumentsApproved(profile.partner_type, docs, today)) {
      throw AppError.conflict('One of your personal documents is missing or expired.', ErrorCode.DocumentExpired);
    }
    return vehicle;
  }

  async recordLocation(user: AuthUser, ping: LocationPing): Promise<void> {
    const profile = await this.requireProfile(user);
    const recordedAt = new Date(ping.recordedAt);
    const now = Date.now();
    if (now - recordedAt.getTime() > LOCATION_MAX_AGE_MS) {
      throw AppError.invalid('recordedAt', 'This position is more than five minutes old and was not recorded.');
    }
    if (recordedAt.getTime() - now > LOCATION_MAX_FUTURE_MS) {
      throw AppError.invalid('recordedAt', 'This position is dated in the future. Check the device clock.');
    }
    // One write every few seconds per driver is plenty; extra pings are accepted and dropped.
    const slot = await this.redis.set(`loc:${profile.id}`, '1', 'EX', 3, 'NX').catch(() => 'OK');
    if (slot !== 'OK') return;
    await this.db.exec(
      `UPDATE driver_profiles
          SET last_lat = $2, last_lng = $3, location_accuracy_m = $4, location_updated_at = LEAST($5::timestamptz, now())
        WHERE id = $1 AND (location_updated_at IS NULL OR location_updated_at < $5::timestamptz)`,
      [profile.id, ping.location.lat, ping.location.lng, ping.accuracyMeters ?? null, recordedAt],
    );
  }

  // --- helpers ---------------------------------------------------------------------------

  async requireProfile(user: AuthUser): Promise<DriverProfileRow> {
    const row = await this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE user_id = $1`, [user.id]);
    if (!row) throw AppError.conflict('Create your partner profile first.');
    return row;
  }

  async checklist(profile: DriverProfileRow) {
    const vehicles = await this.db.query<{ id: string }>(
      `SELECT id FROM vehicles WHERE owner_profile_id = $1 AND deleted_at IS NULL`,
      [profile.id],
    );
    const docs = await this.db.query<DocumentRow>(
      `SELECT * FROM driver_documents WHERE driver_profile_id = $1 AND is_current`,
      [profile.id],
    );
    return onboardingChecklist({
      hasProfile: profile.display_name.trim() !== '' && profile.service_areas.length > 0,
      partnerType: profile.partner_type,
      vehicleIds: vehicles.map((v) => v.id),
      documents: docs.map(toFacts),
    });
  }

  async toProfile(row: DriverProfileRow): Promise<DriverProfile> {
    return {
      id: row.id,
      userId: row.user_id,
      partnerType: row.partner_type,
      displayName: row.display_name,
      bio: row.bio,
      photoUrl: await this.uploads.publicUrl(row.photo_key),
      languages: row.languages,
      yearsExperience: row.years_experience,
      serviceAreas: row.service_areas,
      verificationStatus: row.verification_status,
      listingStatus: row.listing_status,
      availability: row.availability,
      operatingHours: row.operating_hours,
      activeVehicleId: row.active_vehicle_id,
      onboarding: await this.checklist(row),
      createdAt: isoReq(row.created_at),
    };
  }

  async vehicleDto(v: VehicleRow): Promise<Vehicle> {
    return toVehicle(v, await this.uploads.publicUrls(v.photo_keys));
  }

  private async ownedVehicle(profileId: string, vehicleId: string, lock: boolean): Promise<VehicleRow> {
    const row = await this.db.one<VehicleRow>(
      `SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
      [vehicleId],
    );
    // "Not found" for someone else's vehicle too: do not reveal that the id exists.
    if (!row || row.owner_profile_id !== profileId) throw AppError.notFound('Vehicle');
    return row;
  }

  private async vehicleValues(user: AuthUser, input: UpsertVehicleRequest): Promise<Record<string, unknown>> {
    const registration = normalizeRegistration(input.registrationNumber);
    if (!registration) {
      throw AppError.invalid('registrationNumber', 'Enter the registration number as on the RC, e.g. KA47A4821.');
    }
    const category = await this.catalog.requireActiveCategory(input.categoryCode);
    if (input.seats > category.seats + 2) {
      throw AppError.invalid('seats', `A ${category.name} is listed with at most ${category.seats + 2} passenger seats.`);
    }
    const photoKeys = input.photoKeys ?? [];
    if (photoKeys.length > 6) throw AppError.invalid('photoKeys', 'Add at most six photos.');
    for (const key of photoKeys) await this.uploads.claim(user.id, key, UploadPurpose.VehiclePhoto, 'photoKeys');
    return {
      category_code: category.code,
      make: input.make.trim(),
      model: input.model.trim(),
      year: input.year ?? null,
      color: input.color?.trim() || null,
      registration_number: registration,
      seats: input.seats,
      luggage_capacity: input.luggageCapacity,
      has_ac: input.hasAc,
      photo_keys: photoKeys,
    };
  }

  private async assertRegistrationFree(registration: string, exceptVehicleId: string | null): Promise<void> {
    const dup = await this.db.one<{ id: string }>(
      `SELECT id FROM vehicles WHERE registration_number = $1 AND deleted_at IS NULL AND id IS DISTINCT FROM $2`,
      [registration, exceptVehicleId],
    );
    if (dup) throw AppError.conflict('A vehicle with this registration number is already listed.');
  }

  /** Any driver currently operating this vehicle goes offline. */
  private async takeOfflineIfActive(vehicleId: string): Promise<void> {
    await this.db.exec(
      `UPDATE driver_profiles SET availability = 'offline', active_vehicle_id = NULL, updated_at = now()
        WHERE active_vehicle_id = $1`,
      [vehicleId],
    );
  }
}

export { DocumentStatus };
