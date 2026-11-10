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
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ACTIVE_BOOKING_STATUSES,
  AdPlacement,
  BookingAction,
  BookingStatus,
  CancellationReason,
  REVIEW_COMMENT_MAX_LENGTH,
  TicketCategory,
  type Booking,
  type Receipt,
} from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { BookingsApi, SupportApi } from '@core/api/customer.api';
import { AuthStore } from '@core/auth/auth.store';
import { DateTimePipe, MoneyPipe, PhonePipe, humanize } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { AdSlot } from '@ui/ad-slot';
import { Icon, type IconName } from '@ui/icon';
import { Avatar, Modal, Rating, StatePanel } from '@ui/primitives';
import { StatusBadge, statusLabel } from '@ui/status';
import { VehicleArt } from '@ui/vehicle-art';

const POLL_MS = 10_000;

/** The happy path, in order, for the progress track. */
const TRACK: { status: BookingStatus; label: string }[] = [
  { status: BookingStatus.Confirmed, label: 'Booked' },
  { status: BookingStatus.DriverEnRoute, label: 'On the way' },
  { status: BookingStatus.DriverArrived, label: 'Arrived' },
  { status: BookingStatus.InProgress, label: 'Riding' },
  { status: BookingStatus.Completed, label: 'Done' },
];

/** Driver buttons: which status each action asks the server for. */
const TRANSITIONS: Partial<Record<BookingAction, { to: BookingStatus; label: string; icon: IconName; confirm?: string }>> = {
  [BookingAction.MarkEnRoute]: { to: BookingStatus.DriverEnRoute, label: 'I am on my way', icon: 'route' },
  [BookingAction.MarkArrived]: { to: BookingStatus.DriverArrived, label: 'I have arrived', icon: 'pin' },
  [BookingAction.StartTrip]: { to: BookingStatus.InProgress, label: 'Start the trip', icon: 'car' },
  [BookingAction.Complete]: { to: BookingStatus.Completed, label: 'Complete the trip', icon: 'check-circle' },
  [BookingAction.MarkNoShow]: {
    to: BookingStatus.NoShow,
    label: 'Customer did not show',
    icon: 'alert-circle',
    confirm: 'Mark this booking as a no-show? Do this only after waiting at the pickup point and trying to call.',
  },
};

const CUSTOMER_REASONS: CancellationReason[] = [
  CancellationReason.ChangeOfPlans,
  CancellationReason.FoundAnotherRide,
  CancellationReason.DriverDelayed,
  CancellationReason.DriverAskedToCancel,
  CancellationReason.PriceDispute,
  CancellationReason.SafetyConcern,
  CancellationReason.Other,
];
const DRIVER_REASONS: CancellationReason[] = [
  CancellationReason.VehicleIssue,
  CancellationReason.CustomerUnreachable,
  CancellationReason.PriceDispute,
  CancellationReason.SafetyConcern,
  CancellationReason.Other,
];

const ISSUE_CATEGORIES: TicketCategory[] = [
  TicketCategory.BookingIssue,
  TicketCategory.FareDispute,
  TicketCategory.DriverBehaviour,
  TicketCategory.CustomerBehaviour,
  TicketCategory.Safety,
  TicketCategory.Other,
];

const HEADLINES: Record<BookingStatus, { customer: string; driver: string }> = {
  [BookingStatus.Confirmed]: { customer: 'Your ride is booked', driver: 'You have a booking' },
  [BookingStatus.DriverEnRoute]: { customer: 'Your driver is on the way', driver: 'You are on the way' },
  [BookingStatus.DriverArrived]: { customer: 'Your driver has arrived', driver: 'You are at the pickup' },
  [BookingStatus.InProgress]: { customer: 'Enjoy the ride', driver: 'Trip in progress' },
  [BookingStatus.Completed]: { customer: 'Trip completed', driver: 'Trip completed' },
  [BookingStatus.CancelledByCustomer]: { customer: 'You cancelled this booking', driver: 'The customer cancelled' },
  [BookingStatus.CancelledByDriver]: { customer: 'The driver cancelled', driver: 'You cancelled this booking' },
  [BookingStatus.CancelledByAdmin]: { customer: 'Cancelled by support', driver: 'Cancelled by support' },
  [BookingStatus.NoShow]: { customer: 'Marked as a no-show', driver: 'Customer did not show' },
  [BookingStatus.Disputed]: { customer: 'Support is reviewing this booking', driver: 'Support is reviewing this booking' },
};

type Dialog = 'cancel' | 'review' | 'issue' | 'receipt' | 'no-show' | null;

/**
 * One booking, for either party: the customer at /bookings/:id and the driver
 * at /partner/bookings/:id. The server works out `allowedActions` for whoever
 * is asking, so this screen simply offers what comes back.
 */
@Component({
  selector: 'app-booking-detail',
  imports: [RouterLink, ReactiveFormsModule, Icon, Avatar, Rating, VehicleArt, StatePanel, Modal, StatusBadge, AdSlot, MoneyPipe, DateTimePipe, PhonePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './booking-detail.html',
  styleUrl: './booking-detail.scss',
})
export class BookingDetail {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(BookingsApi);
  private readonly support = inject(SupportApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly track = TRACK;
  protected readonly issueCategories = ISSUE_CATEGORIES;
  protected readonly commentMax = REVIEW_COMMENT_MAX_LENGTH;
  protected readonly adPlacement = AdPlacement.BookingConfirmation;
  protected readonly humanize = humanize;

  protected readonly booking = loader(() => this.api.get(this.id()));
  protected readonly dialog = signal<Dialog>(null);
  protected readonly busy = signal(false);
  protected readonly receipt = signal<Receipt | null>(null);
  protected readonly stars = signal(0);

  protected readonly cancelForm = new FormGroup({
    reason: new FormControl<CancellationReason | ''>('', { nonNullable: true, validators: [Validators.required] }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });
  protected readonly reviewComment = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(REVIEW_COMMENT_MAX_LENGTH)],
  });
  protected readonly issueForm = new FormGroup({
    category: new FormControl<TicketCategory>(TicketCategory.BookingIssue, { nonNullable: true }),
    subject: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(10), Validators.maxLength(2000)] }),
  });

  /** In the partner area this screen is the driver's view. */
  protected readonly inPartnerArea = this.router.url.startsWith('/partner');
  protected readonly backLink = this.inPartnerArea ? '/partner/bookings' : '/bookings';

  protected readonly isDriver = computed(() => {
    const b = this.booking.data();
    return b ? b.driver.id === this.auth.me()?.id || (this.inPartnerArea && b.customer.id !== this.auth.me()?.id) : this.inPartnerArea;
  });
  /** The person on the other side of the booking. */
  protected readonly other = computed(() => {
    const b = this.booking.data();
    return b ? (this.isDriver() ? b.customer : b.driver) : null;
  });
  protected readonly headline = computed(() => {
    const b = this.booking.data();
    return b ? HEADLINES[b.status][this.isDriver() ? 'driver' : 'customer'] : '';
  });
  protected readonly isActive = computed(() => {
    const status = this.booking.data()?.status;
    return !!status && ACTIVE_BOOKING_STATUSES.includes(status);
  });
  /** Index on the progress track, or -1 when the booking left the happy path. */
  protected readonly trackIndex = computed(() => TRACK.findIndex((t) => t.status === this.booking.data()?.status));
  protected readonly trackPercent = computed(() => (Math.max(0, this.trackIndex()) / (TRACK.length - 1)) * 100);

  protected readonly driverSteps = computed(() =>
    (this.booking.data()?.allowedActions ?? [])
      .map((action) => ({ action, ...TRANSITIONS[action] }))
      .filter((s): s is { action: BookingAction; to: BookingStatus; label: string; icon: IconName; confirm?: string } => !!s.to),
  );
  protected can(action: BookingAction | `${BookingAction}`): boolean {
    return (this.booking.data()?.allowedActions ?? []).includes(action as BookingAction);
  }
  protected readonly reasons = computed(() => (this.isDriver() ? DRIVER_REASONS : CUSTOMER_REASONS));

  /** Whether cancelling now is still inside the free window of the policy frozen on this booking. */
  protected readonly cancelIsFree = computed(() => {
    const b = this.booking.data();
    if (!b || this.isDriver()) return true;
    const minutesToPickup = (new Date(b.scheduledAt).getTime() - Date.now()) / 60_000;
    return b.cancellationPolicy.lateFee.amountMinor === 0 || minutesToPickup >= b.cancellationPolicy.freeUntilMinutesBefore;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      this.id();
      untracked(() => this.booking.load());
    });

    const poll = setInterval(() => {
      if (this.isActive() && document.visibilityState === 'visible' && !this.busy() && !this.dialog()) {
        this.booking.load({ silent: true });
      }
    }, POLL_MS);
    destroyRef.onDestroy(() => clearInterval(poll));
  }

  protected statusText(status: string): string {
    return statusLabel('booking', status);
  }

  // --- driver transitions ----------------------------------------------------------

  protected step(action: BookingAction): void {
    const t = TRANSITIONS[action];
    if (!t) return;
    if (t.confirm) {
      this.dialog.set('no-show');
      return;
    }
    this.transition(t.to);
  }

  protected transition(to: BookingStatus): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.transition(this.id(), { to }).subscribe({
      next: (booking) => this.applied(booking, `Updated: ${this.statusText(booking.status)}.`),
      error: (error: unknown) => this.failed(error),
    });
  }

  // --- cancel -----------------------------------------------------------------------

  protected cancel(): void {
    this.cancelForm.markAllAsTouched();
    const { reason, note } = this.cancelForm.getRawValue();
    if (!reason || this.cancelForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.api.cancel(this.id(), { reason, note: note.trim() || undefined }).subscribe({
      next: (booking) => {
        this.analytics.track('booking_cancelled', { reason, by: this.isDriver() ? 'driver' : 'customer' });
        this.applied(booking, 'The booking is cancelled.');
      },
      error: (error: unknown) => this.failed(error),
    });
  }

  // --- review ------------------------------------------------------------------------

  protected submitReview(): void {
    if (this.stars() < 1 || this.reviewComment.invalid || this.busy()) return;
    this.busy.set(true);
    this.api.review(this.id(), { rating: this.stars(), comment: this.reviewComment.value.trim() || undefined }).subscribe({
      next: () => {
        this.analytics.track('review_submitted', { rating: this.stars() });
        this.busy.set(false);
        this.dialog.set(null);
        this.toasts.success('Thank you — your review is posted.');
        this.booking.load({ silent: true });
      },
      error: (error: unknown) => this.failed(error),
    });
  }

  // --- report an issue ---------------------------------------------------------------

  protected submitIssue(): void {
    this.issueForm.markAllAsTouched();
    if (this.issueForm.invalid || this.busy()) return;
    this.busy.set(true);
    const v = this.issueForm.getRawValue();
    this.support.create({ ...v, subject: v.subject.trim(), body: v.body.trim(), bookingId: this.id() }).subscribe({
      next: (ticket) => {
        this.analytics.track('contact_support', { source: 'booking', category: v.category });
        this.busy.set(false);
        this.dialog.set(null);
        this.issueForm.reset({ category: TicketCategory.BookingIssue, subject: '', body: '' });
        this.toasts.success(`Sent to support. Your reference is ${ticket.reference}.`);
        this.booking.load({ silent: true });
      },
      error: (error: unknown) => this.failed(error),
    });
  }

  // --- receipt -----------------------------------------------------------------------

  protected openReceipt(): void {
    this.dialog.set('receipt');
    if (this.receipt()) return;
    this.api.receipt(this.id()).subscribe({
      next: (receipt) => this.receipt.set(receipt),
      error: (error: unknown) => {
        this.dialog.set(null);
        this.toasts.error(error);
      },
    });
  }

  protected print(): void {
    window.print();
  }

  private applied(booking: Booking, message: string): void {
    this.busy.set(false);
    this.dialog.set(null);
    this.booking.set(booking);
    this.toasts.success(message);
  }

  private failed(error: unknown): void {
    this.busy.set(false);
    this.dialog.set(null);
    this.toasts.error(error);
    // Most failures here mean the booking moved on: show its current state.
    this.booking.load({ silent: true });
  }
}
