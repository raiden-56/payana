import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tap } from 'rxjs';
import { AvailabilityStatus, FeatureFlag, PartnerType, type OperatingHours } from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { CatalogApi, DriversApi } from '@core/api/public.api';
import { BRAND } from '@core/brand';
import { AppConfigService } from '@core/config/app-config.service';
import { DateOnlyPipe, MoneyPipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { Reveal } from '@ui/motion';
import { Avatar, Rating, StatePanel } from '@ui/primitives';
import { Pager } from '@ui/status';
import { VehicleArt } from '@ui/vehicle-art';
import { toSignal } from '@angular/core/rxjs-interop';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PARTNER_LABEL: Record<PartnerType, string> = {
  [PartnerType.OwnerDriver]: 'Drives their own vehicle',
  [PartnerType.FleetOwner]: 'Fleet owner',
  [PartnerType.HiredDriver]: 'Authorised driver',
};

/** A driver's public page: who they are, what they drive, what they charge, what riders said. */
@Component({
  selector: 'app-driver-profile',
  imports: [RouterLink, Icon, Avatar, Rating, VehicleArt, StatePanel, Pager, Reveal, MoneyPipe, DateOnlyPipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './driver-profile.html',
  styleUrl: './driver-profile.scss',
})
export class DriverProfile {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(DriversApi);
  private readonly catalog = inject(CatalogApi);
  private readonly analytics = inject(AnalyticsService);
  private readonly config = inject(AppConfigService);

  protected readonly brand = BRAND.name;
  protected readonly reviewPage = signal(1);
  protected readonly showReviews = this.config.isEnabled(FeatureFlag.Reviews);

  protected readonly driver = loader(() =>
    this.api.profile(this.id()).pipe(
      tap((d) =>
        this.analytics.track('view_driver', {
          vehicle_category: d.vehicle.categoryCode,
          verified: d.isVerified,
          featured: d.isFeatured,
        }),
      ),
    ),
  );
  protected readonly reviews = loader(() => this.api.reviews(this.id(), { page: this.reviewPage(), pageSize: 5 }));

  private readonly regions = toSignal(this.catalog.regions(), { initialValue: [] });
  protected readonly areaNames = computed(() => {
    const names = new Map(this.regions().map((r) => [r.slug, r.name]));
    return (this.driver.data()?.serviceAreas ?? []).map((slug) => names.get(slug) ?? slug);
  });

  protected readonly availability = computed(() => {
    switch (this.driver.data()?.availability) {
      case AvailabilityStatus.Available:
        return { text: 'Available now', live: true };
      case AvailabilityStatus.Busy:
        return { text: 'On a trip right now', live: false };
      default:
        return { text: 'Offline right now — you can still ask for a later trip', live: false };
    }
  });

  protected readonly partnerLabel = computed(() => {
    const type = this.driver.data()?.partnerType;
    return type ? PARTNER_LABEL[type] : '';
  });

  protected readonly cancellationText = computed(() => {
    const rate = this.driver.data()?.cancellationRate;
    if (rate === null || rate === undefined) return 'Not enough trips yet';
    return rate < 0.005 ? 'None so far' : `${Math.round(rate * 100)}% of bookings`;
  });

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.driver.load();
        if (this.showReviews) this.reviews.load();
      });
    });
  }

  protected hours(h: OperatingHours | null): string {
    if (!h) return 'Not specified';
    const days = h.days.length === 7 ? 'Every day' : h.days.map((d) => DAYS[d]).join(', ');
    return `${days} · ${h.from}–${h.to}`;
  }

  protected stars(rating: number): boolean[] {
    return [1, 2, 3, 4, 5].map((n) => n <= rating);
  }

  protected goToReviewPage(page: number): void {
    this.reviewPage.set(page);
    this.reviews.load();
  }
}
