import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { MarketplaceModule } from '../marketplace/marketplace.module.js';
import { LoggingPushSender, NotificationsService, PUSH_SENDER } from './application/notifications.service.js';
import { ReviewsService } from './application/reviews.service.js';
import { SupportService } from './application/support.service.js';
import {
  AdminSupportController,
  NotificationsController,
  ReviewsController,
  SupportController,
} from './presentation/engagement.controllers.js';

/** Reviews, notifications and support - everything that happens around a booking rather than in it. */
@Module({
  imports: [BookingsModule, MarketplaceModule],
  controllers: [ReviewsController, NotificationsController, SupportController, AdminSupportController],
  providers: [ReviewsService, NotificationsService, SupportService, { provide: PUSH_SENDER, useClass: LoggingPushSender }],
  exports: [SupportService],
})
export class EngagementModule {}
