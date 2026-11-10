import {
  ACTIVE_BOOKING_STATUSES,
  BookingAction,
  BookingStatus,
  CANCELLABLE_BOOKING_STATUSES,
  DRIVER_BOOKING_TRANSITIONS,
  MAX_ADVANCE_DAYS,
  MAX_PASSENGERS,
  MIN_ADVANCE_NOTICE_MINUTES,
  REQUEST_TTL_MINUTES,
  REVIEW_WINDOW_DAYS,
  TripType,
  type CancellationPolicy,
  type FieldError,
} from '@payana/contracts';
import { randomCode } from '../../../common/crypto.js';
import { inr } from '../../../common/money.js';

/** Pure booking rules - no I/O. The API is the authority on every one of them. */

export type Party = 'customer' | 'driver' | 'admin';

/** A driver may not set off for a pickup that is still more than this far in the future. */
export const EN_ROUTE_EARLIEST_HOURS_BEFORE = 6;
/** How long a driver must have waited at the pickup before recording a no-show. */
export const NO_SHOW_MIN_WAIT_MINUTES = 10;
/** A completed booking's fare can be disputed for this long. */
export const DISPUTE_WINDOW_HOURS = 48;

// --- ride requests -------------------------------------------------------------------

export interface RideRequestFacts {
  tripType: TripType;
  hasDrop: boolean;
  hasPackage: boolean;
  scheduledAt: Date | null;
  returnAt: Date | null;
  passengers: number;
  luggage: number;
  categorySeats: number;
  categoryLuggage: number;
}

export function validateRideRequest(r: RideRequestFacts, now: Date): FieldError[] {
  const errors: FieldError[] = [];
  const immediate = r.tripType === TripType.Immediate;

  if (immediate && r.scheduledAt) {
    errors.push({ field: 'scheduledAt', message: 'An immediate trip has no scheduled time. Choose "scheduled" to book ahead.' });
  }
  if (!immediate) {
    if (!r.scheduledAt) {
      errors.push({ field: 'scheduledAt', message: 'Choose a pickup date and time.' });
    } else {
      const lead = (r.scheduledAt.getTime() - now.getTime()) / 60_000;
      if (lead < MIN_ADVANCE_NOTICE_MINUTES) {
        errors.push({ field: 'scheduledAt', message: `Pickup must be at least ${MIN_ADVANCE_NOTICE_MINUTES} minutes from now.` });
      } else if (lead > MAX_ADVANCE_DAYS * 1440) {
        errors.push({ field: 'scheduledAt', message: `Pickup can be at most ${MAX_ADVANCE_DAYS} days ahead.` });
      }
    }
  }
  if (r.returnAt) {
    if (r.tripType !== TripType.Outstation) {
      errors.push({ field: 'returnAt', message: 'Only outstation trips have a return time.' });
    } else if (r.scheduledAt && r.returnAt.getTime() <= r.scheduledAt.getTime()) {
      errors.push({ field: 'returnAt', message: 'The return must be after the pickup.' });
    }
  }
  if (!r.hasDrop && !(r.tripType === TripType.Sightseeing && r.hasPackage)) {
    errors.push({ field: 'drop', message: 'Choose where you are going.' });
  }
  if (r.hasPackage && r.tripType !== TripType.Sightseeing) {
    errors.push({ field: 'packageId', message: 'A package can only be requested as a sightseeing trip.' });
  }
  if (r.passengers < 1 || r.passengers > MAX_PASSENGERS) {
    errors.push({ field: 'passengers', message: `Passengers must be between 1 and ${MAX_PASSENGERS}.` });
  } else if (r.passengers > r.categorySeats) {
    errors.push({ field: 'passengers', message: `This vehicle type seats ${r.categorySeats}. Choose a larger one.` });
  }
  if (r.luggage > r.categoryLuggage + 2) {
    errors.push({ field: 'luggage', message: 'That is more luggage than this vehicle type carries. Choose a larger one.' });
  }
  return errors;
}

/** When a request stops accepting quotes: its time-to-live, but never later than the pickup itself. */
export function requestExpiry(tripType: TripType, now: Date, scheduledAt: Date | null): Date {
  const ttl = new Date(now.getTime() + REQUEST_TTL_MINUTES[tripType] * 60_000);
  if (scheduledAt && scheduledAt.getTime() < ttl.getTime()) return scheduledAt;
  return ttl;
}

// --- quotations ------------------------------------------------------------------------

export interface QuoteBoundsInput {
  categoryBaseFareMinor: number;
  /** Upper end of the fare estimate, when the request has a destination. */
  estimateHighMinor: number | null;
  isReturnTrip: boolean;
}

/** Hard ceiling when there is no estimate to compare against (a day tour, for example). */
export const QUOTE_ABSOLUTE_MAX_MINOR = 5_000_000;

/**
 * The band a quotation must sit in. Deliberately wide - drivers price their
 * own trips - but it stops fat-finger and bait prices: nothing below half the
 * category base fare, nothing above three times the top of the estimate
 * (six times for a return trip).
 */
export function quoteFareBounds(i: QuoteBoundsInput): { minMinor: number; maxMinor: number } {
  const minMinor = Math.max(100, Math.round(i.categoryBaseFareMinor / 2));
  if (i.estimateHighMinor === null) return { minMinor, maxMinor: QUOTE_ABSOLUTE_MAX_MINOR };
  const multiple = i.isReturnTrip ? 6 : 3;
  const maxMinor = Math.min(QUOTE_ABSOLUTE_MAX_MINOR, Math.max(i.estimateHighMinor * multiple, i.categoryBaseFareMinor * 10));
  return { minMinor, maxMinor };
}

// --- bookings ----------------------------------------------------------------------------

export function bookingCode(): string {
  return `PY-${randomCode(5)}`;
}

/**
 * The policy frozen onto a booking when it is made. No cancellation fee is
 * charged at launch (the platform takes no payment from customers), so the
 * late fee is zero; the free-cancellation window is still recorded so a fee
 * can be introduced later without rewriting old bookings.
 */
export function cancellationPolicyFor(tripType: TripType): CancellationPolicy {
  const freeUntilMinutesBefore = tripType === TripType.Immediate ? 0 : 120;
  return {
    freeUntilMinutesBefore,
    lateFee: inr(0),
    summary:
      tripType === TripType.Immediate
        ? 'You can cancel free of charge until the trip starts. Please cancel as early as you can so the driver can take another ride.'
        : 'You can cancel free of charge at any time before the trip starts. Cancelling at least 2 hours ahead lets the driver take another booking.',
  };
}

export function isCancellable(status: BookingStatus): boolean {
  return CANCELLABLE_BOOKING_STATUSES.includes(status);
}

export function isActive(status: BookingStatus): boolean {
  return ACTIVE_BOOKING_STATUSES.includes(status);
}

/** Fee owed when `by` cancels at `now`. Drivers never owe the customer's late fee. */
export function cancellationFeeMinor(policy: CancellationPolicy, scheduledAt: Date, now: Date, by: Party): number {
  if (by !== 'customer') return 0;
  const freeUntil = scheduledAt.getTime() - policy.freeUntilMinutesBefore * 60_000;
  return now.getTime() <= freeUntil ? 0 : policy.lateFee.amountMinor;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export interface TransitionFacts {
  from: BookingStatus;
  to: BookingStatus;
  scheduledAt: Date;
  /** When the driver marked "arrived", if they have. */
  arrivedAt: Date | null;
  now: Date;
}

/** Whether the booking's driver may move it from `from` to `to` right now. */
export function checkDriverTransition(f: TransitionFacts): TransitionCheck {
  if (!DRIVER_BOOKING_TRANSITIONS[f.from].includes(f.to)) {
    return { ok: false, reason: `A booking that is "${f.from}" cannot be changed to "${f.to}".` };
  }
  if (f.to === BookingStatus.DriverEnRoute) {
    const earliest = f.scheduledAt.getTime() - EN_ROUTE_EARLIEST_HOURS_BEFORE * 3_600_000;
    if (f.now.getTime() < earliest) {
      return { ok: false, reason: `You can set off at most ${EN_ROUTE_EARLIEST_HOURS_BEFORE} hours before the pickup time.` };
    }
  }
  if (f.to === BookingStatus.NoShow) {
    const waited = f.arrivedAt ? (f.now.getTime() - f.arrivedAt.getTime()) / 60_000 : 0;
    if (waited < NO_SHOW_MIN_WAIT_MINUTES) {
      return { ok: false, reason: `Wait at least ${NO_SHOW_MIN_WAIT_MINUTES} minutes at the pickup before recording a no-show.` };
    }
  }
  return { ok: true };
}

export interface ActionFacts {
  status: BookingStatus;
  reviewSubmitted: boolean;
  completedAt: Date | null;
  reviewsEnabled: boolean;
  now: Date;
}

export function withinReviewWindow(completedAt: Date | null, now: Date): boolean {
  if (!completedAt) return false;
  return now.getTime() - completedAt.getTime() <= REVIEW_WINDOW_DAYS * 86_400_000;
}

/** What the viewing party may do next - computed for them so clients need no copy of the rules. */
export function allowedActions(f: ActionFacts, viewer: Party): BookingAction[] {
  if (viewer === 'admin') return [];
  const actions: BookingAction[] = [];
  if (isCancellable(f.status)) actions.push(BookingAction.Cancel);
  if (viewer === 'driver') {
    if (f.status === BookingStatus.Confirmed) actions.push(BookingAction.MarkEnRoute);
    if (f.status === BookingStatus.DriverEnRoute) actions.push(BookingAction.MarkArrived);
    if (f.status === BookingStatus.DriverArrived) actions.push(BookingAction.StartTrip, BookingAction.MarkNoShow);
    if (f.status === BookingStatus.InProgress) actions.push(BookingAction.Complete);
  }
  if (viewer === 'customer' && f.status === BookingStatus.Completed && !f.reviewSubmitted && f.reviewsEnabled && withinReviewWindow(f.completedAt, f.now)) {
    actions.push(BookingAction.Review);
  }
  if (f.status === BookingStatus.Completed) actions.push(BookingAction.ViewReceipt);
  actions.push(BookingAction.ReportIssue);
  return actions;
}

/** Whether a party may open a fare dispute on a booking in this state. */
export function canDispute(status: BookingStatus, completedAt: Date | null, now: Date): boolean {
  if (status === BookingStatus.NoShow) return true;
  if (status !== BookingStatus.Completed || !completedAt) return false;
  return now.getTime() - completedAt.getTime() <= DISPUTE_WINDOW_HOURS * 3_600_000;
}
