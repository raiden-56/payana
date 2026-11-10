import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingStatus, NotificationType, VerificationStatus, type AppNotification, type NotificationList } from '@payana/contracts';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { iso, isoReq } from '../../../common/money.js';
import { SUBSCRIPTION_CHANGED_EVENT, type SubscriptionChangedEvent } from '../../billing/application/billing.service.js';
import {
  BookingEvents,
  type BookingCancelledEvent,
  type BookingStatusChangedEvent,
  type QuoteAcceptedEvent,
  type QuoteSubmittedEvent,
  type RequestCreatedEvent,
  type RequestExpiredEvent,
} from '../../bookings/application/events.js';
import { ACCOUNT_ERASED_EVENT, type AccountErasedEvent } from '../../identity/application/account.service.js';
import { AUTHORIZATION_INVITED_EVENT, type AuthorizationInvitedEvent } from '../../marketplace/application/authorizations.service.js';
import { DOCUMENT_EXPIRING_EVENT, type DocumentExpiringEvent } from '../../marketplace/application/marketplace.jobs.js';
import {
  DOCUMENT_REVIEWED_EVENT,
  VERIFICATION_DECIDED_EVENT,
  type DocumentReviewedEvent,
  type VerificationDecidedEvent,
} from '../../marketplace/application/verification.service.js';

/** Delivery beyond the in-app inbox. One adapter per channel. */
export interface PushSender {
  send(userId: string, title: string, body: string, link: string | null): Promise<void>;
}
export const PUSH_SENDER = Symbol('PUSH_SENDER');

/**
 * STUB. No push provider is integrated yet (FCM / APNs come with the native
 * apps). The adapter records what would have been sent so the flow can be
 * followed in the logs; the in-app inbox is the channel that works today.
 */
export class LoggingPushSender implements PushSender {
  private readonly logger = new Logger('PushStub');
  async send(userId: string, title: string): Promise<void> {
    this.logger.debug(`[push not sent - no provider] to ${userId}: ${title}`);
  }
}

export const REVIEW_RECEIVED_EVENT = 'review.received';
export interface ReviewReceivedEvent {
  driverUserId: string;
  rating: number;
  bookingCode: string;
}
export const TICKET_UPDATED_EVENT = 'ticket.updated';
export interface TicketUpdatedEvent {
  userId: string;
  ticketId: string;
  reference: string;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}

const rupees = (minor: number) => `Rs ${Math.round(minor / 100).toLocaleString('en-IN')}`;
const docName = (type: string) => type.replaceAll('_', ' ');

const STATUS_TEXT: Partial<Record<BookingStatus, { title: string; body: string }>> = {
  [BookingStatus.DriverEnRoute]: { title: 'Your driver is on the way', body: 'The driver has set off for your pickup point.' },
  [BookingStatus.DriverArrived]: { title: 'Your driver has arrived', body: 'The driver is waiting at the pickup point.' },
  [BookingStatus.InProgress]: { title: 'Trip started', body: 'Have a good journey.' },
  [BookingStatus.Completed]: { title: 'Trip completed', body: 'Thank you for travelling with Payana. You can rate your driver now.' },
  [BookingStatus.NoShow]: { title: 'Marked as no-show', body: 'The driver waited at the pickup point and recorded a no-show.' },
  [BookingStatus.CancelledByAdmin]: { title: 'Booking closed by support', body: 'Payana support has closed this booking.' },
};

/**
 * In-app notifications, written in response to domain events delivered by the
 * outbox. Handlers run inside the outbox transaction: if one fails the event
 * stays queued and is retried, so a notification is never half-written.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: Db,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  async list(userId: string, unreadOnly: boolean): Promise<NotificationList> {
    const rows = await this.db.query<NotificationRow>(
      `SELECT * FROM notifications WHERE user_id = $1 ${unreadOnly ? 'AND read_at IS NULL' : ''}
        ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    const unread = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return { items: rows.map(toDto), unreadCount: unread?.n ?? 0 };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const n = await this.db.exec(
      `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2`,
      [notificationId, userId],
    );
    if (n === 0) throw AppError.notFound('Notification');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.exec(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  }

  async notify(userId: string | null | undefined, type: NotificationType, title: string, body: string, link: string | null): Promise<void> {
    if (!userId) return;
    await this.db.insert('notifications', { user_id: userId, type, title, body, link });
    void this.push.send(userId, title, body, link).catch(() => undefined);
  }

  // --- reactions to domain events ------------------------------------------------------------

  @OnEvent(BookingEvents.RequestCreated, { suppressErrors: false })
  async onRequestCreated(e: RequestCreatedEvent): Promise<void> {
    for (const userId of e.driverUserIds) {
      await this.notify(
        userId,
        NotificationType.NewRideRequest,
        e.direct ? 'A customer asked for you' : 'New ride request',
        e.dropLabel ? `${e.pickupLabel} to ${e.dropLabel}` : `Pickup at ${e.pickupLabel}`,
        `/driver/requests/${e.requestId}`,
      );
    }
  }

  @OnEvent(BookingEvents.QuoteSubmitted, { suppressErrors: false })
  async onQuoteSubmitted(e: QuoteSubmittedEvent): Promise<void> {
    await this.notify(e.customerId, NotificationType.QuoteReceived, `Quote from ${e.driverName}`, `${rupees(e.fareMinor)} for your trip`, `/requests/${e.requestId}`);
  }

  @OnEvent(BookingEvents.RequestExpired, { suppressErrors: false })
  async onRequestExpired(e: RequestExpiredEvent): Promise<void> {
    await this.notify(
      e.customerId,
      NotificationType.RequestExpired,
      'Your request has expired',
      e.hadQuotes ? 'No quote was chosen in time. You can ask again.' : 'No driver quoted in time. Try again or widen your search.',
      `/requests/${e.requestId}`,
    );
  }

  @OnEvent(BookingEvents.QuoteAccepted, { suppressErrors: false })
  async onQuoteAccepted(e: QuoteAcceptedEvent): Promise<void> {
    await this.notify(e.driverUserId, NotificationType.QuoteAccepted, 'You got the booking', `Booking ${e.bookingCode} is confirmed.`, `/driver/bookings/${e.bookingId}`);
    for (const userId of e.otherDriverUserIds) {
      await this.notify(userId, NotificationType.QuoteNotChosen, 'Another quote was chosen', 'The customer went with a different driver this time.', '/driver/requests');
    }
  }

  @OnEvent(BookingEvents.StatusChanged, { suppressErrors: false })
  async onStatusChanged(e: BookingStatusChangedEvent): Promise<void> {
    const text = STATUS_TEXT[e.status] ?? { title: 'Booking updated', body: `Booking ${e.bookingCode} was updated.` };
    if (e.actor !== 'customer') {
      await this.notify(e.customerId, NotificationType.BookingStatusChanged, text.title, `${text.body} (${e.bookingCode})`, `/bookings/${e.bookingId}`);
    }
    if (e.actor !== 'driver') {
      await this.notify(e.driverUserId, NotificationType.BookingStatusChanged, 'Booking updated', `Booking ${e.bookingCode} was updated by support.`, `/driver/bookings/${e.bookingId}`);
    }
  }

  @OnEvent(BookingEvents.Cancelled, { suppressErrors: false })
  async onCancelled(e: BookingCancelledEvent): Promise<void> {
    if (e.actor !== 'customer') {
      await this.notify(e.customerId, NotificationType.BookingCancelled, 'Your driver cancelled', `Booking ${e.bookingCode} was cancelled. You can ask for another ride.`, `/bookings/${e.bookingId}`);
    }
    if (e.actor !== 'driver') {
      await this.notify(e.driverUserId, NotificationType.BookingCancelled, 'Booking cancelled', `The customer cancelled booking ${e.bookingCode}.`, `/driver/bookings/${e.bookingId}`);
    }
  }

  @OnEvent(DOCUMENT_REVIEWED_EVENT, { suppressErrors: false })
  async onDocumentReviewed(e: DocumentReviewedEvent): Promise<void> {
    await this.notify(
      e.userId,
      NotificationType.DocumentReviewed,
      e.approved ? 'Document approved' : 'Document needs attention',
      e.approved ? `Your ${docName(e.documentType)} was approved.` : `Your ${docName(e.documentType)} was not accepted. Open it to see why and upload it again.`,
      '/driver/onboarding',
    );
  }

  @OnEvent(DOCUMENT_EXPIRING_EVENT, { suppressErrors: false })
  async onDocumentExpiring(e: DocumentExpiringEvent): Promise<void> {
    await this.notify(
      e.userId,
      NotificationType.DocumentExpiring,
      e.daysLeft <= 0 ? 'A document has expired' : `A document expires in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'}`,
      e.daysLeft <= 0
        ? `Your ${docName(e.documentType)} expired on ${e.expiresOn}. Upload the renewed one to keep taking bookings.`
        : `Your ${docName(e.documentType)} expires on ${e.expiresOn}. Upload the renewal to stay listed.`,
      '/driver/onboarding',
    );
  }

  @OnEvent(VERIFICATION_DECIDED_EVENT, { suppressErrors: false })
  async onVerificationDecided(e: VerificationDecidedEvent): Promise<void> {
    const titles: Partial<Record<VerificationStatus, string>> = {
      [VerificationStatus.Approved]: 'You are verified',
      [VerificationStatus.ChangesRequested]: 'Changes needed on your profile',
      [VerificationStatus.Rejected]: 'Verification was not successful',
      [VerificationStatus.Suspended]: 'Your listing has been suspended',
    };
    await this.notify(
      e.userId,
      NotificationType.VerificationDecided,
      titles[e.status] ?? 'Verification updated',
      e.status === VerificationStatus.Approved ? 'Your listing is live. Go online to start receiving requests.' : (e.note ?? 'Open your profile for details.'),
      e.status === VerificationStatus.Approved ? '/driver' : '/driver/onboarding',
    );
  }

  @OnEvent(AUTHORIZATION_INVITED_EVENT, { suppressErrors: false })
  async onAuthorizationInvited(e: AuthorizationInvitedEvent): Promise<void> {
    await this.notify(e.driverUserId, NotificationType.AuthorizationInvite, `${e.ownerName} authorised you`, `Accept to operate their ${e.vehicleLabel} on Payana.`, '/driver/vehicles');
  }

  @OnEvent(SUBSCRIPTION_CHANGED_EVENT, { suppressErrors: false })
  async onSubscriptionChanged(e: SubscriptionChangedEvent): Promise<void> {
    const text = {
      activated: { title: `${e.planName} plan active`, body: 'Your new plan and its benefits are active now.' },
      lapsed: { title: `${e.planName} plan ended`, body: 'Your listing is back on the Starter plan. Renew any time.' },
      auto_renew_off: { title: 'Auto-renewal turned off', body: `Your ${e.planName} plan stays active until the end of the current period.` },
    }[e.change];
    await this.notify(e.userId, NotificationType.SubscriptionChanged, text.title, text.body, '/driver/subscription');
  }

  @OnEvent(REVIEW_RECEIVED_EVENT, { suppressErrors: false })
  async onReviewReceived(e: ReviewReceivedEvent): Promise<void> {
    await this.notify(e.driverUserId, NotificationType.ReviewReceived, `New ${e.rating}-star review`, `A customer reviewed booking ${e.bookingCode}.`, '/driver');
  }

  @OnEvent(TICKET_UPDATED_EVENT, { suppressErrors: false })
  async onTicketUpdated(e: TicketUpdatedEvent): Promise<void> {
    await this.notify(e.userId, NotificationType.TicketUpdated, 'Support replied', `There is a new reply on ticket ${e.reference}.`, `/support/${e.ticketId}`);
  }

  @OnEvent(ACCOUNT_ERASED_EVENT, { suppressErrors: false })
  async onAccountErased(e: AccountErasedEvent): Promise<void> {
    await this.db.exec(`DELETE FROM notifications WHERE user_id = $1`, [e.userId]);
    // Reviews stay (they belong to the driver's record) but lose the author's name and link.
    await this.db.exec(`UPDATE reviews SET author_name = 'Former customer', customer_id = NULL WHERE customer_id = $1`, [e.userId]);
    await this.db.exec(`UPDATE ticket_messages SET author_name = 'Former user' WHERE author_id = $1 AND author = 'user'`, [e.userId]);
  }
}

function toDto(n: NotificationRow): AppNotification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: iso(n.read_at),
    createdAt: isoReq(n.created_at),
  };
}
