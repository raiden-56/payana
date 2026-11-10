import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AdPlacement, DriverSort, FeatureFlag, TripType, type Place } from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { CatalogApi, DriversApi } from '@core/api/public.api';
import { BRAND } from '@core/brand';
import { AppConfigService } from '@core/config/app-config.service';
import { packagePhoto, type PhotoKey } from '@core/media/photos';
import { prefersReducedMotion } from '@core/platform/platform';
import { DurationPipe, MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { placeToParams } from '@core/util/place-params';
import { AdSlot } from '@ui/ad-slot';
import { DriverCard } from '@ui/driver-card';
import { Icon, type IconName } from '@ui/icon';
import { LocationPicker } from '@ui/location-picker';
import { CountUp, Parallax, Reveal, Tilt } from '@ui/motion';
import { Photo } from '@ui/photo';
import { StatePanel } from '@ui/primitives';
import { VehicleArt } from '@ui/vehicle-art';
import { CoastMap } from './coast-map';

interface TripTab {
  type: TripType;
  label: string;
  icon: IconName;
  hint: string;
}

const TRIP_TABS: TripTab[] = [
  { type: TripType.Immediate, label: 'Now', icon: 'clock', hint: 'Nearby drivers send you their price.' },
  { type: TripType.Scheduled, label: 'Later', icon: 'calendar', hint: 'Fix a pickup time; drivers quote in advance.' },
  { type: TripType.Outstation, label: 'Outstation', icon: 'route', hint: 'Airport, station and town-to-town trips.' },
  { type: TripType.Sightseeing, label: 'Day tour', icon: 'compass', hint: 'A driver for the day, to the places you choose.' },
];

/** Photos that cycle in the hero. */
const SLIDES: { key: PhotoKey; title: string; sub: string }[] = [
  { key: 'kudle-beach', title: 'Kudle Beach', sub: 'Gokarna' },
  { key: 'auto-stand', title: 'Autos, everywhere', sub: 'The quickest way across town' },
  { key: 'yana', title: 'Yana rocks', sub: 'A half-day trip inland' },
  { key: 'coast-sunset', title: 'Sunset on the Arabian Sea', sub: 'From the beaches of Gokarna' },
];

const STEPS: { title: string; text: string; photo: PhotoKey }[] = [
  { title: 'Say where and when', text: 'Pick a pickup and a drop — a beach, the bus stand, your stay — and whether you need it now or later.', photo: 'auto-stand' },
  { title: 'Drivers send quotes', text: 'Verified drivers nearby reply with their fare, their vehicle and what is included. You compare them side by side.', photo: 'car-sedan' },
  { title: 'Choose and ride', text: 'Accept the quote you like. You get the driver’s name, the vehicle number and a way to call them. Pay them directly.', photo: 'kudle-beach' },
];

const SLIDE_MS = 5500;

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    Icon,
    Photo,
    CoastMap,
    LocationPicker,
    VehicleArt,
    DriverCard,
    AdSlot,
    StatePanel,
    Reveal,
    Parallax,
    Tilt,
    CountUp,
    MoneyPipe,
    DurationPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly catalog = inject(CatalogApi);
  private readonly driversApi = inject(DriversApi);
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly config = inject(AppConfigService);

  protected readonly brand = BRAND;
  protected readonly tabs = TRIP_TABS;
  protected readonly slides = SLIDES;
  protected readonly steps = STEPS;
  protected readonly adPlacement = AdPlacement.HomeStrip;
  protected readonly packagePhoto = packagePhoto;

  protected readonly mosaic: { key: PhotoKey; title: string; sub: string; link: string }[] = [
    { key: 'kudle-beach', title: 'Kudle Beach', sub: 'Gokarna', link: '/packages/five-beaches-trail' },
    { key: 'temple', title: 'Temple town', sub: 'Gokarna', link: '/packages/temple-circuit' },
    { key: 'yana', title: 'Yana rocks', sub: 'Near Kumta', link: '/packages/yana-and-vibhooti-falls' },
    { key: 'mirjan-fort', title: 'Mirjan Fort', sub: 'Kumta', link: '/packages/mirjan-fort-and-kumta' },
    { key: 'backwater', title: 'Honnavar backwaters', sub: 'Mangroves by boat', link: '/packages/murudeshwar-and-honnavar-backwaters' },
    { key: 'murudeshwar', title: 'Murudeshwar', sub: 'The sea-side Shiva', link: '/packages/murudeshwar-and-honnavar-backwaters' },
  ];

  // --- hero search ------------------------------------------------------------------
  protected readonly tripType = signal<TripType>(TripType.Immediate);
  protected readonly pickup = signal<Place | null>(null);
  protected readonly drop = signal<Place | null>(null);
  protected readonly triedSubmit = signal(false);
  protected readonly activeTab = computed(() => TRIP_TABS.find((t) => t.type === this.tripType())!);
  protected readonly needsDrop = computed(() => this.tripType() !== TripType.Sightseeing);

  // --- slideshow and scroll-linked steps ------------------------------------------------
  protected readonly slide$ = signal(0);
  protected readonly activeStep = signal(0);
  private readonly rail = viewChild<ElementRef<HTMLElement>>('rail');

  // --- data -----------------------------------------------------------------------------
  protected readonly categories = loader(() => this.catalog.vehicleCategories());
  protected readonly regions = loader(() => this.catalog.regions());
  protected readonly packages = loader(() => this.catalog.packages());
  protected readonly drivers = loader(() =>
    this.driversApi.search({ regionSlug: this.config.config().defaultRegionSlug, sort: DriverSort.Recommended, pageSize: 4 }),
  );
  protected readonly driverTotal = loader(() =>
    this.driversApi.search({ pageSize: 1, verifiedOnly: true }).pipe(map((page) => page.total)),
  );

  protected readonly showPackages = computed(() => this.config.isEnabled(FeatureFlag.Packages));
  protected readonly showDrive = computed(() => this.config.isEnabled(FeatureFlag.DriverSignUp));

  /** Shown only when every number is real. */
  protected readonly figures = computed(() => {
    const drivers = this.driverTotal.data();
    const categories = this.categories.data();
    return drivers === null || !categories ? null : { drivers, vehicleTypes: categories.length };
  });

  constructor() {
    this.categories.load();
    this.regions.load();
    this.drivers.load();
    this.driverTotal.load();
    if (this.showPackages()) this.packages.load();

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // The slideshow advances on its own unless motion is reduced or the tab is hidden.
      if (!prefersReducedMotion()) {
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') this.slide$.update((i) => (i + 1) % SLIDES.length);
        }, SLIDE_MS);
        destroyRef.onDestroy(() => clearInterval(timer));
      }

      // The step nearest the middle of the screen is the active one.
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) this.activeStep.set(Number((e.target as HTMLElement).dataset['step']));
          }
        },
        { rootMargin: '-45% 0px -45% 0px' },
      );
      this.host.querySelectorAll('[data-step]').forEach((el) => io.observe(el));
      destroyRef.onDestroy(() => io.disconnect());
    });
  }

  protected goToSlide(i: number): void {
    this.slide$.set(i);
  }

  protected scrollRail(direction: 1 | -1): void {
    const el = this.rail()?.nativeElement;
    el?.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  protected selectTab(type: TripType): void {
    this.tripType.set(type);
  }

  /** Arrow keys move between trip-type tabs, as the tab pattern expects. */
  protected onTabKey(event: KeyboardEvent, index: number): void {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + TRIP_TABS.length) % TRIP_TABS.length;
    this.tripType.set(TRIP_TABS[next]!.type);
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  protected getQuotes(): void {
    this.triedSubmit.set(true);
    if (!this.pickup()) return;
    this.analytics.track('begin_ride_request', { trip_type: this.tripType(), source: 'home_hero' });
    void this.router.navigate(['/request'], {
      queryParams: {
        type: this.tripType(),
        ...placeToParams('from', this.pickup()),
        ...placeToParams('to', this.needsDrop() ? this.drop() : null),
      },
    });
  }

  protected browseNearby(): void {
    void this.router.navigate(['/explore'], { queryParams: placeToParams('from', this.pickup()) });
  }
}
