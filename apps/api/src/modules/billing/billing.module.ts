import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ENTITLEMENTS } from '../../common/ports.js';
import { JobLock } from '../../common/redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MarketplaceModule } from '../marketplace/marketplace.module.js';
import { BillingService } from './application/billing.service.js';
import { ManualPaymentGateway, PAYMENT_GATEWAY, RazorpayGateway } from './application/payment.port.js';
import { AdminPlansController, PartnerBillingController, PlansController } from './presentation/billing.controllers.js';

@Injectable()
class BillingJobs {
  constructor(
    private readonly billing: BillingService,
    private readonly lock: JobLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    await this.lock.runExclusive('billing-upkeep', 600, async () => {
      await this.billing.rollPlacements();
      await this.billing.rollSubscriptions();
    });
  }
}

/**
 * Plans, subscriptions, invoices and featured placements.
 * Global so that the marketplace and bookings modules can resolve the
 * ENTITLEMENTS port without importing this module (which itself imports the
 * marketplace) - see common/ports.ts.
 */
@Global()
@Module({
  imports: [MarketplaceModule, CatalogModule],
  controllers: [PlansController, PartnerBillingController, AdminPlansController],
  providers: [
    BillingService,
    BillingJobs,
    { provide: ENTITLEMENTS, useExisting: BillingService },
    {
      provide: PAYMENT_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.payments.provider === 'razorpay' ? new RazorpayGateway() : new ManualPaymentGateway(),
    },
  ],
  exports: [BillingService, ENTITLEMENTS],
})
export class BillingModule {}
