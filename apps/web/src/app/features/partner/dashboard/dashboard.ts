import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorCode } from '@payana/contracts';
import { PartnerApi } from '@core/api/partner.api';
import { AuthStore } from '@core/auth/auth.store';
import { MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon, type IconName } from '@ui/icon';
import { CountUp, Reveal } from '@ui/motion';
import { StatePanel } from '@ui/primitives';
import { BookingCard } from '../bookings/booking-card';
import { PartnerStore } from '../partner.store';
import { RequestCard } from '../requests/request-card';
import { PartnerHead } from '../shared/page-head';
import { pollWhileVisible } from '../shared/poll';
import { AvailabilityCard } from './availability-card';
import { VerificationBanner } from './verification-banner';

interface Tile {
  label: string;
  value: number;
  icon: IconName;
  help: string;
}

const PERIODS = [7, 30, 90] as const;

@Component({
  selector: 'app-partner-dashboard',
  imports: [
    RouterLink,
    Icon,
    StatePanel,
    Reveal,
    CountUp,
    MoneyPipe,
    PartnerHead,
    VerificationBanner,
    AvailabilityCard,
    RequestCard,
    BookingCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly api = inject(PartnerApi);
  private readonly auth = inject(AuthStore);
  protected readonly store = inject(PartnerStore);

  protected readonly periods = PERIODS;
  protected readonly period = signal<(typeof PERIODS)[number]>(30);

  protected readonly metrics = loader(() => this.api.metrics(this.period()));
  protected readonly requests = loader(() => this.api.requests({ pageSize: 3 }));
  protected readonly bookings = loader(() => this.api.bookings({ scope: 'active', pageSize: 3 }));

  protected readonly firstName = computed(() => {
    const name = this.store.profile.data()?.displayName ?? this.auth.me()?.displayName ?? '';
    return name.trim().split(/\s+/)[0] ?? '';
  });

  /** The performance figures are a paid-plan entitlement; the free plan is answered with "limit reached". */
  protected readonly metricsLocked = computed(() => this.metrics.error()?.code === ErrorCode.EntitlementExceeded);

  /** Requests are open only to verified partners; before that the feed answers "not verified". */
  protected readonly requestsLocked = computed(() => this.requests.error()?.code === ErrorCode.DriverNotVerified);

  protected readonly tiles = computed<Tile[]>(() => {
    const m = this.metrics.data();
    if (!m) return [];
    return [
      { label: 'Requests received', value: m.enquiriesReceived, icon: 'inbox', help: 'Ride requests offered to you' },
      { label: 'Quotes sent', value: m.quotesSent, icon: 'send', help: 'Requests you answered with a price' },
      { label: 'Bookings won', value: m.bookingsWon, icon: 'ticket', help: 'Quotes a customer accepted' },
      { label: 'Trips completed', value: m.bookingsCompleted, icon: 'check-circle', help: 'Bookings finished' },
      { label: 'Profile views', value: m.profileViews, icon: 'eye', help: 'Times your profile was opened' },
    ];
  });

  protected readonly cancellation = computed(() => {
    const rate = this.metrics.data()?.cancellationRate;
    return rate === null || rate === undefined ? null : Math.round(rate * 100);
  });

  private dependentsLoaded = false;

  constructor() {
    // Everything below needs a profile; a newcomer sees only the set-up banner.
    effect(() => {
      if (!this.store.hasProfile() || this.dependentsLoaded) return;
      this.dependentsLoaded = true;
      this.metrics.load();
      this.requests.load();
      this.bookings.load();
    });

    pollWhileVisible(() => {
      if (!this.dependentsLoaded) return;
      this.requests.load({ silent: true });
      this.bookings.load({ silent: true });
    }, 20_000);
  }

  protected setPeriod(days: (typeof PERIODS)[number]): void {
    if (days === this.period()) return;
    this.period.set(days);
    this.metrics.load();
  }
}
