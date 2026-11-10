import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { tap } from 'rxjs';
import {
  AdPlacement,
  DEFAULT_SEARCH_RADIUS_KM,
  DriverSort,
  MAX_SEARCH_RADIUS_KM,
  type DriverSearchQuery,
  type Place,
} from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { CatalogApi, DriversApi } from '@core/api/public.api';
import { AppConfigService } from '@core/config/app-config.service';
import { DistancePipe, formatDistance } from '@core/util/format';
import { loader } from '@core/util/loader';
import { placeFromParams, placeToParams } from '@core/util/place-params';
import { AdSlot } from '@ui/ad-slot';
import { DriverCard } from '@ui/driver-card';
import { Icon } from '@ui/icon';
import { LocationPicker } from '@ui/location-picker';
import { Reveal } from '@ui/motion';
import { StatePanel } from '@ui/primitives';
import { Pager } from '@ui/status';
import { VehicleArt } from '@ui/vehicle-art';

const PAGE_SIZE = 12;

const SORTS: { value: DriverSort; label: string; needsPoint?: boolean }[] = [
  { value: DriverSort.Recommended, label: 'Recommended' },
  { value: DriverSort.Nearest, label: 'Nearest first', needsPoint: true },
  { value: DriverSort.Rating, label: 'Best rated' },
  { value: DriverSort.Price, label: 'Lowest rate' },
];

const SEAT_OPTIONS = [0, 3, 4, 6, 10];

/**
 * Find a ride: browse verified drivers, optionally around a pickup point.
 *
 * The URL is the state - every filter lives in the query string, so a search
 * can be bookmarked, shared and survives a reload, and the back button undoes
 * the last filter change.
 */
@Component({
  selector: 'app-explore',
  imports: [Icon, LocationPicker, DriverCard, AdSlot, StatePanel, Pager, VehicleArt, Reveal, DistancePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './explore.html',
  styleUrl: './explore.scss',
})
export class Explore {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly driversApi = inject(DriversApi);
  private readonly catalog = inject(CatalogApi);
  private readonly config = inject(AppConfigService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly sorts = SORTS;
  protected readonly seatOptions = SEAT_OPTIONS;
  protected readonly maxRadius = MAX_SEARCH_RADIUS_KM;
  protected readonly adPlacement = AdPlacement.SearchInline;

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });

  // --- filters, read from the URL ---------------------------------------------
  protected readonly pickup = computed<Place | null>(() => placeFromParams('from', this.params()));
  protected readonly category = computed(() => this.params().get('category') ?? '');
  protected readonly region = computed(() => this.params().get('region') ?? this.config.config().defaultRegionSlug);
  protected readonly availableNow = computed(() => this.params().get('available') === '1');
  protected readonly minSeats = computed(() => clampInt(this.params().get('seats'), 0, 20, 0));
  protected readonly radiusKm = computed(() =>
    clampInt(this.params().get('radius'), 1, MAX_SEARCH_RADIUS_KM, DEFAULT_SEARCH_RADIUS_KM),
  );
  protected readonly page = computed(() => clampInt(this.params().get('page'), 1, 500, 1));
  protected readonly sort = computed<DriverSort>(() => {
    const value = this.params().get('sort') as DriverSort | null;
    const known = SORTS.some((s) => s.value === value);
    // "Nearest" means nothing without a point to measure from.
    if (!known || (value === DriverSort.Nearest && !this.pickup())) {
      return this.pickup() ? DriverSort.Nearest : DriverSort.Recommended;
    }
    return value!;
  });

  /** The radius slider shows its value while being dragged, before the URL changes. */
  protected readonly radiusDraft = signal<number | null>(null);
  protected readonly radiusShown = computed(() => this.radiusDraft() ?? this.radiusKm());

  private readonly query = computed<DriverSearchQuery>(() => {
    const point = this.pickup();
    return {
      ...(point ? { lat: point.location.lat, lng: point.location.lng, radiusKm: this.radiusKm() } : { regionSlug: this.region() }),
      categoryCode: this.category() || undefined,
      minSeats: this.minSeats() || undefined,
      availableNow: this.availableNow() || undefined,
      sort: this.sort(),
      page: this.page(),
      pageSize: PAGE_SIZE,
    };
  });

  // --- data --------------------------------------------------------------------
  protected readonly categories = loader(() => this.catalog.vehicleCategories());
  protected readonly results = loader(() =>
    this.driversApi.search(this.query()).pipe(
      tap((page) =>
        this.analytics.track('search', {
          search_type: this.pickup() ? 'nearby' : 'region',
          vehicle_category: this.category() || 'any',
          radius_km: this.pickup() ? this.radiusKm() : undefined,
          results: page.total,
        }),
      ),
    ),
  );

  protected readonly drivers = computed(() => this.results.data()?.items ?? []);
  protected readonly total = computed(() => this.results.data()?.total ?? 0);
  protected readonly pageSize = PAGE_SIZE;

  /** Driver picked from the "closest" strip. */
  protected readonly activeId = signal<string | null>(null);
  /** The three nearest drivers with a current position, shown as a quick-pick strip. */
  protected readonly closest = computed(() =>
    this.pickup()
      ? this.drivers()
          .filter((d) => d.location.distanceKm !== null)
          .sort((a, b) => a.location.distanceKm! - b.location.distanceKm!)
          .slice(0, 3)
      : [],
  );

  protected readonly summary = computed(() => {
    const n = this.total();
    const noun = n === 1 ? 'verified driver' : 'verified drivers';
    const point = this.pickup();
    return point
      ? `${n} ${noun} within ${formatDistance(this.radiusKm())} of ${point.label}`
      : `${n} ${noun} serving ${this.regionName()}`;
  });

  private readonly regionsList = toSignal(this.catalog.regions(), { initialValue: [] });
  protected readonly regionName = computed(
    () => this.regionsList().find((r) => r.slug === this.region())?.name ?? 'this area',
  );

  protected readonly hasFilters = computed(
    () => !!this.category() || this.availableNow() || this.minSeats() > 0 || this.radiusKm() !== DEFAULT_SEARCH_RADIUS_KM,
  );

  constructor() {
    this.categories.load();
    // Any change to the query string reruns the search.
    effect(() => {
      this.query();
      untracked(() => this.results.load());
    });
  }

  // --- filter changes write to the URL -------------------------------------------

  protected setPickup(place: Place | null): void {
    this.patch({
      from: null,
      fromLat: null,
      fromLng: null,
      fromRegion: null,
      ...placeToParams('from', place),
      // Leaving "nearest" selected with no point would be silently ignored.
      sort: place ? DriverSort.Nearest : null,
    });
  }

  protected setCategory(code: string): void {
    this.patch({ category: code || null });
  }

  protected setAvailable(on: boolean): void {
    this.patch({ available: on ? '1' : null });
  }

  protected setSeats(value: string): void {
    this.patch({ seats: Number(value) > 0 ? value : null });
  }

  protected setSort(value: string): void {
    this.patch({ sort: value });
  }

  protected commitRadius(): void {
    const value = this.radiusDraft();
    this.radiusDraft.set(null);
    if (value !== null && value !== this.radiusKm()) {
      this.patch({ radius: value === DEFAULT_SEARCH_RADIUS_KM ? null : String(value) });
    }
  }

  protected widenRadius(): void {
    this.patch({ radius: String(Math.min(MAX_SEARCH_RADIUS_KM, this.radiusKm() * 2)) });
  }

  protected clearFilters(): void {
    this.patch({ category: null, available: null, seats: null, radius: null });
  }

  protected goToPage(page: number): void {
    this.patch({ page: page > 1 ? String(page) : null }, false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Bring that driver's card into view. */
  protected focusDriver(id: string): void {
    this.activeId.set(id);
    document.getElementById('driver-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private patch(changes: Record<string, string | null>, resetPage = true): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...(resetPage ? { page: null } : {}), ...changes },
      queryParamsHandling: 'merge',
      // Filter tweaks should not pile up in history one keystroke at a time.
      replaceUrl: resetPage,
    });
  }
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
