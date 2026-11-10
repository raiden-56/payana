import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiRoutes, Permission, type AdminOverview } from '@payana/contracts';
import { RequirePermission } from '../../common/auth/auth.types.js';
import { ApiContract } from '../../common/http/api-contract.js';
import { inr } from '../../common/money.js';
import { BillingService } from '../billing/application/billing.service.js';
import { BookingsService } from '../bookings/application/bookings.service.js';
import { RequestsService } from '../bookings/application/requests.service.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { SupportService } from '../engagement/application/support.service.js';
import { EngagementModule } from '../engagement/engagement.module.js';
import { UsersAdminService } from '../identity/application/users-admin.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MarketplaceFacade } from '../marketplace/application/marketplace.facade.js';
import { MarketplaceModule } from '../marketplace/marketplace.module.js';

/** Composes the headline numbers from each module's own statistics; it owns no data. */
@Injectable()
class OverviewService {
  constructor(
    private readonly users: UsersAdminService,
    private readonly marketplace: MarketplaceFacade,
    private readonly requests: RequestsService,
    private readonly bookings: BookingsService,
    private readonly billing: BillingService,
    private readonly support: SupportService,
  ) {}

  async overview(): Promise<AdminOverview> {
    const [customers, drivers, requests, bookings, billing, support] = await Promise.all([
      this.users.customerCounts(),
      this.marketplace.overviewCounts(),
      this.requests.stats(),
      this.bookings.stats(),
      this.billing.overview(),
      this.support.stats(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      customers,
      drivers: {
        total: drivers.total,
        verified: drivers.verified,
        pendingVerification: drivers.pendingVerification,
        availableNow: drivers.availableNow,
      },
      requests,
      bookings: {
        activeNow: bookings.activeNow,
        completedLast7Days: bookings.completedLast7Days,
        cancelledLast7Days: bookings.cancelledLast7Days,
        disputed: bookings.disputed,
      },
      revenue: { subscriptionsLast30Days: inr(billing.subscriptionsLast30DaysMinor), activeSubscriptions: billing.activeSubscriptions },
      support,
      documents: { expiringIn30Days: drivers.documentsExpiring },
      trend: bookings.trend,
    };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
class AdminOverviewController {
  constructor(private readonly service: OverviewService) {}

  @Get(ApiRoutes.admin.overview)
  @RequirePermission(Permission.OverviewRead)
  @ApiContract({ summary: 'Headline numbers for the admin console', response: 'AdminOverview' })
  overview(): Promise<AdminOverview> {
    return this.service.overview();
  }
}

/** The admin overview. Every other admin route lives in the module that owns its data. */
@Module({
  imports: [IdentityModule, MarketplaceModule, BookingsModule, EngagementModule],
  controllers: [AdminOverviewController],
  providers: [OverviewService],
})
export class AdminModule {}
