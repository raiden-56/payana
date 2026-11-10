import { BookingAction, BookingStatus, DRIVER_BOOKING_TRANSITIONS, TripType } from '@payana/contracts';
import { bookingFeeFor, addPeriod, daysInclusive, addDays, invoiceNumber } from '../../billing/domain/billing-rules.js';
import {
  NO_SHOW_MIN_WAIT_MINUTES,
  allowedActions,
  bookingCode,
  canDispute,
  cancellationFeeMinor,
  cancellationPolicyFor,
  checkDriverTransition,
  isCancellable,
  quoteFareBounds,
  requestExpiry,
  validateRideRequest,
  type RideRequestFacts,
} from './booking-rules.js';

const now = new Date('2026-11-10T10:00:00Z');
const mins = (m: number) => new Date(now.getTime() + m * 60_000);
const S = BookingStatus;

describe('booking state machine (driver transitions)', () => {
  const facts = (from: BookingStatus, to: BookingStatus) => ({
    from,
    to,
    scheduledAt: mins(30),
    arrivedAt: mins(-NO_SHOW_MIN_WAIT_MINUTES - 1),
    now,
  });

  it('allows exactly the transitions in the contract table and nothing else', () => {
    for (const from of Object.values(S)) {
      for (const to of Object.values(S)) {
        const expected = DRIVER_BOOKING_TRANSITIONS[from].includes(to);
        expect(checkDriverTransition(facts(from, to)).ok, `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('walks the happy path in order', () => {
    const path = [S.Confirmed, S.DriverEnRoute, S.DriverArrived, S.InProgress, S.Completed];
    for (let i = 0; i < path.length - 1; i++) {
      expect(checkDriverTransition(facts(path[i]!, path[i + 1]!)).ok).toBe(true);
    }
  });

  it('never leaves a terminal status', () => {
    for (const from of [S.Completed, S.CancelledByCustomer, S.CancelledByDriver, S.CancelledByAdmin, S.NoShow, S.Disputed]) {
      expect(DRIVER_BOOKING_TRANSITIONS[from]).toEqual([]);
    }
  });

  it('refuses to skip steps or go backwards', () => {
    expect(checkDriverTransition(facts(S.Confirmed, S.InProgress)).ok).toBe(false);
    expect(checkDriverTransition(facts(S.Confirmed, S.Completed)).ok).toBe(false);
    expect(checkDriverTransition(facts(S.InProgress, S.DriverEnRoute)).ok).toBe(false);
  });

  it('does not let a driver set off more than six hours early', () => {
    const early = { ...facts(S.Confirmed, S.DriverEnRoute), scheduledAt: mins(6 * 60 + 1) };
    expect(checkDriverTransition(early).ok).toBe(false);
    expect(checkDriverTransition({ ...early, scheduledAt: mins(6 * 60) }).ok).toBe(true);
  });

  it('requires a ten-minute wait before a no-show', () => {
    const base = facts(S.DriverArrived, S.NoShow);
    expect(checkDriverTransition({ ...base, arrivedAt: mins(-9) }).ok).toBe(false);
    expect(checkDriverTransition({ ...base, arrivedAt: null }).ok).toBe(false);
    expect(checkDriverTransition({ ...base, arrivedAt: mins(-10) }).ok).toBe(true);
  });
});

describe('allowed actions', () => {
  const f = (status: BookingStatus, extra: Partial<Parameters<typeof allowedActions>[0]> = {}) => ({
    status,
    reviewSubmitted: false,
    completedAt: status === S.Completed ? mins(-60) : null,
    reviewsEnabled: true,
    now,
    ...extra,
  });

  it('offers the driver only the next step', () => {
    expect(allowedActions(f(S.Confirmed), 'driver')).toEqual([BookingAction.Cancel, BookingAction.MarkEnRoute, BookingAction.ReportIssue]);
    expect(allowedActions(f(S.DriverEnRoute), 'driver')).toContain(BookingAction.MarkArrived);
    expect(allowedActions(f(S.DriverArrived), 'driver')).toEqual(
      expect.arrayContaining([BookingAction.StartTrip, BookingAction.MarkNoShow, BookingAction.Cancel]),
    );
    expect(allowedActions(f(S.InProgress), 'driver')).toEqual([BookingAction.Complete, BookingAction.ReportIssue]);
  });

  it('never offers a customer the driver’s actions', () => {
    for (const status of Object.values(S)) {
      const actions = allowedActions(f(status), 'customer');
      for (const a of [BookingAction.MarkEnRoute, BookingAction.MarkArrived, BookingAction.StartTrip, BookingAction.Complete, BookingAction.MarkNoShow]) {
        expect(actions).not.toContain(a);
      }
    }
  });

  it('lets a customer review once, after completion, inside the window, when reviews are on', () => {
    expect(allowedActions(f(S.Completed), 'customer')).toContain(BookingAction.Review);
    expect(allowedActions(f(S.Completed, { reviewSubmitted: true }), 'customer')).not.toContain(BookingAction.Review);
    expect(allowedActions(f(S.Completed, { reviewsEnabled: false }), 'customer')).not.toContain(BookingAction.Review);
    expect(allowedActions(f(S.Completed, { completedAt: mins(-15 * 24 * 60) }), 'customer')).not.toContain(BookingAction.Review);
    expect(allowedActions(f(S.InProgress), 'customer')).not.toContain(BookingAction.Review);
    expect(allowedActions(f(S.Completed), 'driver')).not.toContain(BookingAction.Review);
  });

  it('offers cancel only while the trip has not started, and a receipt only when completed', () => {
    expect(isCancellable(S.Confirmed) && isCancellable(S.DriverEnRoute) && isCancellable(S.DriverArrived)).toBe(true);
    expect(isCancellable(S.InProgress) || isCancellable(S.Completed)).toBe(false);
    expect(allowedActions(f(S.InProgress), 'customer')).not.toContain(BookingAction.Cancel);
    expect(allowedActions(f(S.Completed), 'customer')).toContain(BookingAction.ViewReceipt);
    expect(allowedActions(f(S.Confirmed), 'customer')).not.toContain(BookingAction.ViewReceipt);
  });

  it('gives administrators no party actions', () => {
    expect(allowedActions(f(S.Confirmed), 'admin')).toEqual([]);
  });
});

describe('cancellation', () => {
  const policy = { freeUntilMinutesBefore: 120, lateFee: { amountMinor: 5000, currency: 'INR' as const }, summary: '' };

  it('is free up to the cut-off and charges the late fee after it', () => {
    expect(cancellationFeeMinor(policy, mins(121), now, 'customer')).toBe(0);
    expect(cancellationFeeMinor(policy, mins(120), now, 'customer')).toBe(0);
    expect(cancellationFeeMinor(policy, mins(119), now, 'customer')).toBe(5000);
  });

  it('never charges the customer when the driver or support cancels', () => {
    expect(cancellationFeeMinor(policy, mins(5), now, 'driver')).toBe(0);
    expect(cancellationFeeMinor(policy, mins(5), now, 'admin')).toBe(0);
  });

  it('freezes a zero-fee launch policy onto new bookings', () => {
    expect(cancellationPolicyFor(TripType.Immediate)).toMatchObject({ freeUntilMinutesBefore: 0, lateFee: { amountMinor: 0 } });
    expect(cancellationPolicyFor(TripType.Outstation)).toMatchObject({ freeUntilMinutesBefore: 120, lateFee: { amountMinor: 0 } });
  });

  it('opens disputes only on no-shows and recently completed trips', () => {
    expect(canDispute(S.NoShow, null, now)).toBe(true);
    expect(canDispute(S.Completed, mins(-60), now)).toBe(true);
    expect(canDispute(S.Completed, mins(-49 * 60), now)).toBe(false);
    expect(canDispute(S.Confirmed, null, now)).toBe(false);
  });
});

describe('booking fee', () => {
  const off = { enabled: false, flatMinor: 1000, percent: 5, capMinor: null };

  it('is zero when the fee is switched off', () => {
    expect(bookingFeeFor(50_000, off)).toBe(0);
  });

  it('adds the flat part and the percentage, rounded to whole paise', () => {
    expect(bookingFeeFor(50_000, { ...off, enabled: true })).toBe(1000 + 2500);
    expect(bookingFeeFor(33_333, { enabled: true, flatMinor: 0, percent: 2.5, capMinor: null })).toBe(833);
  });

  it('respects the cap and never goes negative', () => {
    expect(bookingFeeFor(1_000_000, { enabled: true, flatMinor: 1000, percent: 5, capMinor: 20_000 })).toBe(20_000);
    expect(bookingFeeFor(0, { ...off, enabled: true })).toBe(0);
    expect(bookingFeeFor(-10, { ...off, enabled: true })).toBe(0);
  });
});

describe('billing periods and dates', () => {
  it('adds calendar months without overflowing short months', () => {
    expect(addPeriod(new Date('2026-01-31T10:00:00Z'), 'monthly').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addPeriod(new Date('2026-11-10T10:00:00Z'), 'quarterly').toISOString()).toBe('2027-02-10T10:00:00.000Z');
    expect(addPeriod(new Date('2024-02-29T00:00:00Z'), 'yearly').toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('counts featured days inclusively', () => {
    expect(daysInclusive('2026-11-10', '2026-11-10')).toBe(1);
    expect(daysInclusive('2026-11-28', '2026-12-02')).toBe(5);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('formats invoice numbers', () => {
    expect(invoiceNumber(42, new Date('2026-11-10T00:00:00Z'))).toBe('INV-2026-000042');
  });
});

describe('ride request validation', () => {
  const base: RideRequestFacts = {
    tripType: TripType.Scheduled,
    hasDrop: true,
    hasPackage: false,
    scheduledAt: mins(120),
    returnAt: null,
    passengers: 2,
    luggage: 1,
    categorySeats: 4,
    categoryLuggage: 3,
  };
  const fields = (r: RideRequestFacts) => validateRideRequest(r, now).map((e) => e.field);

  it('accepts a well-formed scheduled trip and an immediate one', () => {
    expect(fields(base)).toEqual([]);
    expect(fields({ ...base, tripType: TripType.Immediate, scheduledAt: null })).toEqual([]);
  });

  it('enforces advance notice and the booking horizon', () => {
    expect(fields({ ...base, scheduledAt: mins(29) })).toEqual(['scheduledAt']);
    expect(fields({ ...base, scheduledAt: mins(91 * 24 * 60) })).toEqual(['scheduledAt']);
    expect(fields({ ...base, scheduledAt: null })).toEqual(['scheduledAt']);
    expect(fields({ ...base, tripType: TripType.Immediate })).toEqual(['scheduledAt']);
  });

  it('needs a destination unless it is a package tour', () => {
    expect(fields({ ...base, hasDrop: false })).toEqual(['drop']);
    expect(fields({ ...base, tripType: TripType.Sightseeing, hasDrop: false, hasPackage: true })).toEqual([]);
    expect(fields({ ...base, hasPackage: true })).toEqual(['packageId']);
  });

  it('checks the return leg and the vehicle capacity', () => {
    expect(fields({ ...base, tripType: TripType.Outstation, returnAt: mins(60) })).toEqual(['returnAt']);
    expect(fields({ ...base, returnAt: mins(600) })).toEqual(['returnAt']);
    expect(fields({ ...base, passengers: 5 })).toEqual(['passengers']);
    expect(fields({ ...base, luggage: 6 })).toEqual(['luggage']);
  });
});

describe('quotes and requests', () => {
  it('keeps a quote inside a wide but bounded band', () => {
    expect(quoteFareBounds({ categoryBaseFareMinor: 4000, estimateHighMinor: 16_000, isReturnTrip: false })).toEqual({ minMinor: 2000, maxMinor: 48_000 });
    expect(quoteFareBounds({ categoryBaseFareMinor: 4000, estimateHighMinor: 16_000, isReturnTrip: true }).maxMinor).toBe(96_000);
    expect(quoteFareBounds({ categoryBaseFareMinor: 4000, estimateHighMinor: null, isReturnTrip: false }).maxMinor).toBe(5_000_000);
    expect(quoteFareBounds({ categoryBaseFareMinor: 10_000, estimateHighMinor: 5_000_000, isReturnTrip: true }).maxMinor).toBe(5_000_000);
  });

  it('closes a request at its time-to-live, but never after the pickup time', () => {
    expect(requestExpiry(TripType.Immediate, now, null)).toEqual(mins(10));
    expect(requestExpiry(TripType.Scheduled, now, mins(60))).toEqual(mins(60));
    expect(requestExpiry(TripType.Scheduled, now, mins(48 * 60))).toEqual(mins(12 * 60));
  });

  it('issues readable booking codes', () => {
    expect(bookingCode()).toMatch(/^PY-[2-9A-HJKMNP-Z]{5}$/);
  });
});
