import type { BookingStatus } from '@payana/contracts';

/** Domain events published by the bookings module through the outbox. */
export const BookingEvents = {
  RequestCreated: 'ride_request.created',
  RequestExpired: 'ride_request.expired',
  QuoteSubmitted: 'quote.submitted',
  QuoteAccepted: 'quote.accepted',
  StatusChanged: 'booking.status_changed',
  Cancelled: 'booking.cancelled',
} as const;

export interface RequestCreatedEvent {
  requestId: string;
  customerId: string;
  /** User ids of the partners the request was offered to. */
  driverUserIds: string[];
  pickupLabel: string;
  dropLabel: string | null;
  direct: boolean;
}

export interface RequestExpiredEvent {
  requestId: string;
  customerId: string;
  hadQuotes: boolean;
}

export interface QuoteSubmittedEvent {
  requestId: string;
  customerId: string;
  driverName: string;
  fareMinor: number;
}

export interface QuoteAcceptedEvent {
  bookingId: string;
  bookingCode: string;
  requestId: string;
  customerId: string;
  driverUserId: string;
  /** Partners whose quotes were closed because another one was chosen. */
  otherDriverUserIds: string[];
}

export interface BookingStatusChangedEvent {
  bookingId: string;
  bookingCode: string;
  status: BookingStatus;
  customerId: string;
  driverUserId: string;
  /** Who caused the change - they are not notified about their own action. */
  actor: 'customer' | 'driver' | 'admin' | 'system';
}

export interface BookingCancelledEvent extends BookingStatusChangedEvent {
  reason: string;
}
