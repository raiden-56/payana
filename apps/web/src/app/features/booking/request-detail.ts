import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ConversionEvent,
  ErrorCode,
  QuoteStatus,
  RideRequestStatus,
  TripType,
  type Quote,
} from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { toApiError } from '@core/api/api-error';
import { RideRequestsApi } from '@core/api/customer.api';
import { newIdempotencyKey } from '@core/platform/platform';
import { DateTimePipe, DistancePipe, MoneyPipe, formatMoney } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Reveal } from '@ui/motion';
import { Avatar, Modal, Rating, StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { VehicleArt } from '@ui/vehicle-art';

/** How often an open request is re-read. Real-time push comes later (ADR: polling first). */
const POLL_MS = 5000;

/**
 * A ride request and the quotes on it. While the request is open the page
 * re-reads it every few seconds; quotes appear as drivers send them. The
 * customer compares and accepts one, which creates the booking.
 */
@Component({
  selector: 'app-request-detail',
  imports: [RouterLink, Icon, Avatar, Rating, VehicleArt, StatePanel, Modal, StatusBadge, Reveal, MoneyPipe, DateTimePipe, DistancePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(RideRequestsApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly request = loader(() => this.api.get(this.id()));
  protected readonly now = signal(Date.now());
  protected readonly confirming = signal<Quote | null>(null);
  protected readonly accepting = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly confirmCancel = signal(false);
  protected readonly sortBy = signal<'price' | 'rating' | 'eta'>('price');

  /** One idempotency key per quote, so re-tapping "accept" can never book twice. */
  private readonly acceptKeys = new Map<string, string>();

  protected readonly isOpen = computed(() => this.request.data()?.status === RideRequestStatus.Open);
  protected readonly isImmediate = computed(() => this.request.data()?.tripType === TripType.Immediate);

  protected readonly quotes = computed(() => {
    const quotes = [...(this.request.data()?.quotes ?? [])];
    const live = (q: Quote) => (this.usable(q) ? 0 : 1);
    const by = this.sortBy();
    return quotes.sort((a, b) => {
      if (live(a) !== live(b)) return live(a) - live(b);
      if (by === 'rating') return (b.driver.rating.average ?? 0) - (a.driver.rating.average ?? 0);
      if (by === 'eta') return (a.etaMinutes ?? 9999) - (b.etaMinutes ?? 9999);
      return a.fare.amountMinor - b.fare.amountMinor;
    });
  });
  protected readonly usableCount = computed(() => this.quotes().filter((q) => this.usable(q)).length);
  protected readonly lowestId = computed(() => {
    const usable = this.quotes().filter((q) => this.usable(q));
    if (usable.length < 2) return null;
    return usable.reduce((min, q) => (q.fare.amountMinor < min.fare.amountMinor ? q : min)).id;
  });

  /** "4:32" until the request stops taking quotes. */
  protected readonly timeLeft = computed(() => countdown(this.request.data()?.expiresAt, this.now()));

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      this.id();
      untracked(() => this.request.load());
    });

    // Poll while open and while someone is actually looking at the tab.
    const poll = setInterval(() => {
      if (this.isOpen() && document.visibilityState === 'visible' && !this.accepting()) {
        this.request.load({ silent: true });
      }
    }, POLL_MS);
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && this.isOpen()) this.request.load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  protected usable(quote: Quote): boolean {
    return quote.status === QuoteStatus.Active && new Date(quote.validUntil).getTime() > this.now();
  }

  protected validFor(quote: Quote): string {
    return countdown(quote.validUntil, this.now());
  }

  protected accept(): void {
    const quote = this.confirming();
    const request = this.request.data();
    if (!quote || !request || this.accepting()) return;

    let key = this.acceptKeys.get(quote.id);
    if (!key) {
      key = newIdempotencyKey();
      this.acceptKeys.set(quote.id, key);
    }

    this.accepting.set(true);
    this.api.acceptQuote(request.id, quote.id, key).subscribe({
      next: (booking) => {
        this.analytics.track('quote_accepted', { trip_type: request.tripType, vehicle_category: request.categoryCode });
        this.analytics.conversion(ConversionEvent.BookingConfirmed, {
          valueMinor: booking.fare.quoted.amountMinor,
          currency: booking.fare.quoted.currency,
          transactionId: booking.id,
        });
        this.toasts.success(`Booked with ${quote.driver.displayName} for ${formatMoney(quote.fare)}.`);
        void this.router.navigate(['/bookings', booking.id]);
      },
      error: (error: unknown) => {
        this.accepting.set(false);
        this.confirming.set(null);
        const e = toApiError(error);
        this.toasts.error(e);
        // The quote or request changed under us: show the current truth.
        if (e.is(ErrorCode.QuoteNotActive) || e.is(ErrorCode.RequestNotOpen) || e.is(ErrorCode.Conflict)) {
          this.request.load({ silent: true });
        }
      },
    });
  }

  protected cancel(): void {
    if (this.cancelling()) return;
    this.cancelling.set(true);
    this.api.cancel(this.id()).subscribe({
      next: (request) => {
        this.cancelling.set(false);
        this.confirmCancel.set(false);
        this.request.set(request);
        this.toasts.info('Request cancelled. No driver was booked.');
      },
      error: (error: unknown) => {
        this.cancelling.set(false);
        this.confirmCancel.set(false);
        this.toasts.error(error);
      },
    });
  }
}

/** "4:32", "1 h 05 min" or "" once the moment has passed. */
function countdown(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const seconds = Math.floor((new Date(iso).getTime() - now) / 1000);
  if (seconds <= 0) return '';
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} h ${String(m).padStart(2, '0')} min`;
  }
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
