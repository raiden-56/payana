import type { IsoDateTime, PageQuery, Uuid } from './common.js';

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const ReviewStatus = {
  Published: 'published',
  /** Hidden by a moderator. */
  Hidden: 'hidden',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export interface Review {
  id: Uuid;
  bookingId: Uuid;
  driverId: Uuid;
  /** 1 - 5. */
  rating: number;
  comment: string | null;
  /** First name and initial only, e.g. "Anita R." */
  authorName: string;
  tripType: string;
  /** The driver's public reply, if any. */
  reply: { text: string; at: IsoDateTime } | null;
  status: ReviewStatus;
  createdAt: IsoDateTime;
}

export interface SubmitReviewRequest {
  rating: number;
  comment?: string;
}

export interface ReplyToReviewRequest {
  text: string;
}

/** Days after completion during which a booking may be reviewed. */
export const REVIEW_WINDOW_DAYS = 14;
export const REVIEW_COMMENT_MAX_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Support tickets and issue reports
// ---------------------------------------------------------------------------

export const TicketCategory = {
  BookingIssue: 'booking_issue',
  FareDispute: 'fare_dispute',
  DriverBehaviour: 'driver_behaviour',
  CustomerBehaviour: 'customer_behaviour',
  Safety: 'safety',
  RefundRequest: 'refund_request',
  Subscription: 'subscription',
  Account: 'account',
  AbuseReport: 'abuse_report',
  Other: 'other',
} as const;
export type TicketCategory = (typeof TicketCategory)[keyof typeof TicketCategory];

export const TicketStatus = {
  Open: 'open',
  InProgress: 'in_progress',
  WaitingOnUser: 'waiting_on_user',
  Resolved: 'resolved',
  Closed: 'closed',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
  Normal: 'normal',
  High: 'high',
  /** Safety reports are always urgent. */
  Urgent: 'urgent',
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export interface TicketMessage {
  id: Uuid;
  author: 'user' | 'support';
  authorName: string;
  body: string;
  createdAt: IsoDateTime;
}

export interface SupportTicket {
  id: Uuid;
  /** e.g. "T-004211". */
  reference: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  subject: string;
  bookingId: Uuid | null;
  bookingCode: string | null;
  messages: TicketMessage[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateTicketRequest {
  category: TicketCategory;
  subject: string;
  body: string;
  bookingId?: Uuid;
}

export interface AddTicketMessageRequest {
  body: string;
}

export interface TicketListQuery extends PageQuery {
  status?: TicketStatus;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NotificationType = {
  QuoteReceived: 'quote_received',
  RequestExpired: 'request_expired',
  NewRideRequest: 'new_ride_request',
  QuoteAccepted: 'quote_accepted',
  QuoteNotChosen: 'quote_not_chosen',
  BookingStatusChanged: 'booking_status_changed',
  BookingCancelled: 'booking_cancelled',
  DocumentReviewed: 'document_reviewed',
  DocumentExpiring: 'document_expiring',
  VerificationDecided: 'verification_decided',
  AuthorizationInvite: 'authorization_invite',
  SubscriptionChanged: 'subscription_changed',
  ReviewReceived: 'review_received',
  TicketUpdated: 'ticket_updated',
  AccountNotice: 'account_notice',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationChannel = {
  InApp: 'in_app',
  Sms: 'sms',
  Push: 'push',
  Email: 'email',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export interface AppNotification {
  id: Uuid;
  type: NotificationType;
  title: string;
  body: string;
  /** In-app path to open, e.g. "/requests/3f2a...". */
  link: string | null;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface NotificationList {
  items: AppNotification[];
  unreadCount: number;
}
