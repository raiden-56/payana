import { Injectable } from '@nestjs/common';
import {
  BookingStatus,
  ErrorCode,
  FeatureFlag,
  ReviewStatus,
  type PageQuery,
  type Paginated,
  type Review,
  type SubmitReviewRequest,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { BookingsService } from '../../bookings/application/bookings.service.js';
import { withinReviewWindow } from '../../bookings/domain/booking-rules.js';
import { publicAuthorName } from '../../identity/domain/auth-rules.js';
import { MarketplaceFacade } from '../../marketplace/application/marketplace.facade.js';
import { SettingsService } from '../../platform/application/settings.service.js';
import { REVIEW_RECEIVED_EVENT, type ReviewReceivedEvent } from './notifications.service.js';

interface ReviewRow {
  id: string;
  booking_id: string;
  driver_profile_id: string;
  rating: number;
  comment: string | null;
  author_name: string;
  trip_type: string;
  reply_text: string | null;
  reply_at: Date | null;
  status: ReviewStatus;
  created_at: Date;
}

/** Customer reviews of completed trips, the driver's public reply, and moderation. */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly bookings: BookingsService,
    private readonly marketplace: MarketplaceFacade,
    private readonly settings: SettingsService,
  ) {}

  async listForDriver(driverId: string, q: PageQuery): Promise<Paginated<Review>> {
    const w = pageWindow(q);
    if (!(await this.settings.isEnabled(FeatureFlag.Reviews))) return paginated([], 0, w);
    const total = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM reviews WHERE driver_profile_id = $1 AND status = 'published'`,
      [driverId],
    );
    const rows = await this.db.query<ReviewRow>(
      `SELECT * FROM reviews WHERE driver_profile_id = $1 AND status = 'published'
        ORDER BY created_at DESC LIMIT ${w.limit} OFFSET ${w.offset}`,
      [driverId],
    );
    return paginated(rows.map(toDto), total?.n ?? 0, w);
  }

  /** One review per booking, by its customer, after completion and inside the review window. */
  async submit(user: AuthUser, bookingId: string, input: SubmitReviewRequest): Promise<Review> {
    await this.settings.requireFeature(FeatureFlag.Reviews);
    return this.db.tx(async () => {
      const ctx = await this.bookings.reviewContext(user, bookingId);
      if (!ctx) throw AppError.notFound('Booking');
      const { row, customerName } = ctx;
      const notEligible = (detail: string) => AppError.conflict(detail, ErrorCode.ReviewNotEligible);
      if (row.status !== BookingStatus.Completed) throw notEligible('Only a completed trip can be reviewed.');
      if (row.review_submitted) throw notEligible('You have already reviewed this trip.');
      if (!withinReviewWindow(row.completed_at, new Date())) throw notEligible('The time to review this trip has passed.');

      const created = await this.db.insert<ReviewRow>('reviews', {
        booking_id: row.id,
        driver_profile_id: row.driver_profile_id,
        customer_id: user.id,
        rating: input.rating,
        comment: input.comment?.trim() || null,
        author_name: publicAuthorName(customerName),
        trip_type: row.trip_type,
      });
      await this.bookings.markReviewed(row.id);
      await this.recomputeRating(row.driver_profile_id);
      const driver = (await this.marketplace.driverCards([row.driver_profile_id])).get(row.driver_profile_id);
      if (driver) {
        await this.outbox.publish(REVIEW_RECEIVED_EVENT, {
          driverUserId: driver.userId,
          rating: input.rating,
          bookingCode: row.code,
        } satisfies ReviewReceivedEvent);
      }
      return toDto(created);
    });
  }

  async reply(user: AuthUser, reviewId: string, text: string): Promise<Review> {
    return this.db.tx(async () => {
      const review = await this.db.one<ReviewRow>(`SELECT * FROM reviews WHERE id = $1 FOR UPDATE`, [reviewId]);
      // Only the reviewed driver may reply; a hidden review is not open for replies.
      if (!review || !user.driverProfileId || review.driver_profile_id !== user.driverProfileId) throw AppError.notFound('Review');
      if (review.status !== ReviewStatus.Published) throw AppError.conflict('This review is not published.');
      const updated = await this.db.update<ReviewRow>('reviews', { id: review.id }, { reply_text: text.trim(), reply_at: new Date() });
      return toDto(updated!);
    });
  }

  async moderate(reviewId: string, status: ReviewStatus, reason: string | undefined, actor: AuthUser): Promise<Review> {
    return this.db.tx(async () => {
      const review = await this.db.one<ReviewRow>(`SELECT * FROM reviews WHERE id = $1 FOR UPDATE`, [reviewId]);
      if (!review) throw AppError.notFound('Review');
      if (status === ReviewStatus.Hidden && !reason?.trim()) throw AppError.invalid('reason', 'Give a reason for hiding a review.');
      const updated = await this.db.update<ReviewRow>('reviews', { id: review.id }, { status });
      await this.recomputeRating(review.driver_profile_id);
      await this.audit.record({
        actor,
        action: status === ReviewStatus.Hidden ? 'review.hidden' : 'review.published',
        targetType: 'review',
        targetId: review.id,
        metadata: { reason: reason ?? null, previous: review.status },
      });
      return toDto(updated!);
    });
  }

  /** The driver's public rating is always derived from the published reviews, never edited directly. */
  private async recomputeRating(driverProfileId: string): Promise<void> {
    const r = await this.db.one<{ avg: string | null; n: number }>(
      `SELECT round(avg(rating), 1) AS avg, count(*)::int AS n FROM reviews WHERE driver_profile_id = $1 AND status = 'published'`,
      [driverProfileId],
    );
    await this.marketplace.setRating(driverProfileId, r?.avg === null || r?.avg === undefined ? null : Number(r.avg), r?.n ?? 0);
  }
}

function toDto(r: ReviewRow): Review {
  return {
    id: r.id,
    bookingId: r.booking_id,
    driverId: r.driver_profile_id,
    rating: r.rating,
    comment: r.comment,
    authorName: r.author_name,
    tripType: r.trip_type,
    reply: r.reply_text && r.reply_at ? { text: r.reply_text, at: isoReq(r.reply_at) } : null,
    status: r.status,
    createdAt: isoReq(r.created_at),
  };
}
