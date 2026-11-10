import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import {
  ApiRoutes,
  type AdCreative,
  type AdPlacement,
  type DriverListing,
  type DriverPublicProfile,
  type DriverSearchQuery,
  type FareEstimate,
  type LatLng,
  type PageQuery,
  type Paginated,
  type PlaceSearchQuery,
  type PlaceSuggestion,
  type Region,
  type Review,
  type SubscriptionPlan,
  type TourPackage,
  type VehicleCategory,
} from '@payana/contracts';
import { ApiClient } from './api-client';

/** Reference data: regions, categories, places, plans, packages. All public. */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly api = inject(ApiClient);

  // Reference data changes rarely; one request per app session is enough.
  private regions$?: Observable<Region[]>;
  private categories$?: Observable<VehicleCategory[]>;

  regions(): Observable<Region[]> {
    return (this.regions$ ??= this.api
      .get<Region[]>(ApiRoutes.catalog.regions)
      .pipe(shareReplay({ bufferSize: 1, refCount: false })));
  }

  vehicleCategories(): Observable<VehicleCategory[]> {
    return (this.categories$ ??= this.api
      .get<VehicleCategory[]>(ApiRoutes.catalog.vehicleCategories)
      .pipe(shareReplay({ bufferSize: 1, refCount: false })));
  }

  /** Forget cached reference data (after a failed load, or an admin edit). */
  invalidate(): void {
    this.regions$ = undefined;
    this.categories$ = undefined;
  }

  places(query: PlaceSearchQuery = {}): Observable<PlaceSuggestion[]> {
    return this.api.get<PlaceSuggestion[]>(ApiRoutes.catalog.places, { query });
  }

  fareEstimate(from: LatLng, to: LatLng, categoryCode: string): Observable<FareEstimate> {
    return this.api.get<FareEstimate>(ApiRoutes.catalog.fareEstimate, {
      query: { fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng, categoryCode },
    });
  }

  plans(): Observable<SubscriptionPlan[]> {
    return this.api.get<SubscriptionPlan[]>(ApiRoutes.plans.root);
  }

  packages(regionSlug?: string): Observable<TourPackage[]> {
    return this.api.get<TourPackage[]>(ApiRoutes.packages.root, { query: { regionSlug } });
  }

  package(slug: string): Observable<TourPackage> {
    return this.api.get<TourPackage>(ApiRoutes.packages.one(slug));
  }
}

/** Public driver discovery. */
@Injectable({ providedIn: 'root' })
export class DriversApi {
  private readonly api = inject(ApiClient);

  search(query: DriverSearchQuery): Observable<Paginated<DriverListing>> {
    return this.api.get<Paginated<DriverListing>>(ApiRoutes.drivers.search, { query });
  }

  profile(driverId: string): Observable<DriverPublicProfile> {
    return this.api.get<DriverPublicProfile>(ApiRoutes.drivers.profile(driverId));
  }

  reviews(driverId: string, page: PageQuery = {}): Observable<Paginated<Review>> {
    return this.api.get<Paginated<Review>>(ApiRoutes.drivers.reviews(driverId), { query: page });
  }
}

/** The platform's own local-business advertisements. */
@Injectable({ providedIn: 'root' })
export class AdsApi {
  private readonly api = inject(ApiClient);

  list(placement: AdPlacement, regionSlug?: string): Observable<AdCreative[]> {
    return this.api.get<AdCreative[]>(ApiRoutes.ads.root, { query: { placement, regionSlug } });
  }

  impression(campaignId: string): Observable<void> {
    return this.api.post<void>(ApiRoutes.ads.impression(campaignId));
  }

  click(campaignId: string): Observable<void> {
    return this.api.post<void>(ApiRoutes.ads.click(campaignId));
  }
}
