import { Inject, Injectable, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JobLock } from '../../common/redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MarketplaceModule } from '../marketplace/marketplace.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';
import { BookingsService } from './application/bookings.service.js';
import { RequestsService } from './application/requests.service.js';
import {
  AdminBookingsController,
  BookingsController,
  DriverRequestsController,
  RideRequestsController,
} from './presentation/bookings.controllers.js';

@Injectable()
class BookingJobs {
  constructor(
    private readonly requests: RequestsService,
    private readonly lock: JobLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Requests and quotes are short-lived, so their expiry is swept every minute. */
  @Interval(60_000)
  async expire(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    await this.lock.runExclusive('expire-requests', 55, async () => {
      await this.requests.expireDue();
    });
  }
}

/** Ride requests, quotations and bookings. */
@Module({
  imports: [CatalogModule, MarketplaceModule, PromotionsModule],
  controllers: [RideRequestsController, DriverRequestsController, BookingsController, AdminBookingsController],
  providers: [BookingsService, RequestsService, BookingJobs],
  exports: [BookingsService, RequestsService],
})
export class BookingsModule {}
