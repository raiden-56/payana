import { Injectable, computed, effect, inject } from '@angular/core';
import {
  AuthorizationStatus,
  VerificationStatus,
  type DriverProfile,
  type Vehicle,
  type VehicleCategory,
} from '@payana/contracts';
import { PartnerApi } from '@core/api/partner.api';
import { CatalogApi } from '@core/api/public.api';
import { AuthStore } from '@core/auth/auth.store';
import { loader } from '@core/util/loader';
import { formatRegistration } from './partner-logic';

/** A vehicle the signed-in partner may take on the road: their own, or one an owner authorised them for. */
export interface OperableVehicle {
  id: string;
  label: string;
  /** Null for a vehicle driven under someone else's authorisation (its details belong to the owner). */
  vehicle: Vehicle | null;
  ownerName: string | null;
}

/**
 * What the partner screens share: the profile, the partner's vehicles and
 * documents, and the reference data they all need. Provided by PartnerLayout,
 * so it lives exactly as long as the partner area is open and never leaks
 * one account's data into the next sign-in.
 */
@Injectable()
export class PartnerStore {
  private readonly api = inject(PartnerApi);
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);

  readonly profile = loader(() => this.api.profile());
  readonly vehicles = loader(() => this.api.vehicles());
  readonly documents = loader(() => this.api.documents());
  readonly authorizations = loader(() => this.api.authorizations());
  readonly categories = loader(() => this.catalog.vehicleCategories());
  readonly regions = loader(() => this.catalog.regions());

  /** True once we know whether a profile exists. */
  readonly profileKnown = computed(() => this.profile.status() === 'ready');
  readonly hasProfile = computed(() => this.profile.data() !== null);
  readonly verified = computed(() => this.profile.data()?.verificationStatus === VerificationStatus.Approved);

  readonly categoryByCode = computed(
    () => new Map<string, VehicleCategory>((this.categories.data() ?? []).map((c) => [c.code, c])),
  );

  /** Own vehicles first, then vehicles this partner holds an active authorisation for. */
  readonly operableVehicles = computed<OperableVehicle[]>(() => {
    const me = this.profile.data()?.id;
    const own: OperableVehicle[] = (this.vehicles.data() ?? []).map((v) => ({
      id: v.id,
      label: `${v.make} ${v.model} · ${formatRegistration(v.registrationNumber)}`,
      vehicle: v,
      ownerName: null,
    }));
    const ownIds = new Set(own.map((v) => v.id));
    const authorised: OperableVehicle[] = (this.authorizations.data() ?? [])
      .filter((a) => a.status === AuthorizationStatus.Active && a.ownerProfileId !== me && !ownIds.has(a.vehicleId))
      .map((a) => ({ id: a.vehicleId, label: a.vehicleLabel, vehicle: null, ownerName: a.ownerName }));
    return [...own, ...authorised];
  });

  constructor() {
    this.profile.load();
    this.categories.load();
    this.regions.load();

    // Vehicles, documents and authorisations only exist once there is a profile:
    // asking earlier is answered with "create your profile first".
    effect(() => {
      if (!this.hasProfile()) return;
      if (this.vehicles.status() === 'idle') this.vehicles.load();
      if (this.documents.status() === 'idle') this.documents.load();
      if (this.authorizations.status() === 'idle') this.authorizations.load();
    });
  }

  /** Use the profile an API call just returned. */
  setProfile(profile: DriverProfile): void {
    const created = !this.hasProfile();
    this.profile.set(profile);
    // The account record carries the profile id and verification status too.
    if (created || this.auth.me()?.driver?.verificationStatus !== profile.verificationStatus) {
      this.auth.reloadMe().subscribe();
    }
  }

  /** Re-read the profile quietly - its onboarding checklist is computed by the server. */
  refreshProfile(): void {
    this.profile.load({ silent: true });
  }

  refreshVehicles(): void {
    this.vehicles.load({ silent: true });
  }

  refreshDocuments(): void {
    this.documents.load({ silent: true });
    this.refreshProfile();
  }

  categoryFor(vehicle: Pick<Vehicle, 'categoryCode'>): VehicleCategory | undefined {
    return this.categoryByCode().get(vehicle.categoryCode);
  }
}
