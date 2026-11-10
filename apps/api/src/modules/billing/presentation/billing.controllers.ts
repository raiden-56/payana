import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccountRole,
  ApiRoutes,
  BillingPeriod,
  Currency,
  Permission,
  type CheckoutSession,
  type DriverSubscription,
  type FeaturedPlacement,
  type Invoice,
  type Money,
  type Paginated,
  type PlanEntitlements,
  type PurchaseFeaturedPlacementRequest,
  type SubscriptionCheckoutRequest,
  type SubscriptionPlan,
  type SubscriptionPlanInput,
} from '@payana/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, Public, RequirePermission, Roles, type AuthUser } from '../../../common/auth/auth.types.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { PageQueryDto } from '../../../common/http/pagination.js';
import { r } from '../../../common/http/route.js';
import { DATE_ONLY } from '../../../common/http/validators.js';
import { Idempotent } from '../../../common/idempotency/idempotency.js';
import { BillingService } from '../application/billing.service.js';

class MoneyDto implements Money {
  @IsInt() @Min(0) @Max(100_000_000)
  amountMinor!: number;

  @IsIn([Currency.INR])
  currency!: Currency;
}

class PlanEntitlementsDto implements PlanEntitlements {
  @IsInt() @Min(1) @Max(500)
  maxVehicles!: number;

  @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(100_000)
  monthlyQuoteLimit!: number | null;

  @IsBoolean()
  priorityInSearch!: boolean;

  @IsInt() @Min(0) @Max(31)
  featuredDaysIncluded!: number;

  @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 12)
  badge!: string | null;

  @IsBoolean()
  analytics!: boolean;
}

class PlanInputDto implements SubscriptionPlanInput {
  @Matches(/^[a-z][a-z0-9_]{1,29}$/)
  code!: string;

  @IsString() @Length(2, 40)
  name!: string;

  @IsString() @MaxLength(300)
  description!: string;

  @ValidateNested() @Type(() => MoneyDto)
  price!: MoneyDto;

  @IsEnum(BillingPeriod)
  billingPeriod!: BillingPeriod;

  @ValidateNested() @Type(() => PlanEntitlementsDto)
  entitlements!: PlanEntitlementsDto;

  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(120, { each: true })
  highlights!: string[];

  @IsBoolean()
  isRecommended!: boolean;

  @IsBoolean()
  isActive!: boolean;

  @IsInt() @Min(0) @Max(1000)
  sortOrder!: number;
}

class CheckoutDto implements SubscriptionCheckoutRequest {
  @IsUUID()
  planId!: string;
}

class PurchasePlacementDto implements PurchaseFeaturedPlacementRequest {
  @IsUUID()
  vehicleId!: string;

  @Matches(/^[a-z][a-z0-9-]{1,39}$/)
  regionSlug!: string;

  @Matches(DATE_ONLY, { message: 'Use YYYY-MM-DD.' })
  startsOn!: string;

  @IsInt() @Min(1) @Max(30)
  days!: number;
}

class InvoiceQueryDto extends PageQueryDto {
  @IsOptional() @IsString()
  _?: never;
}

function profileId(user: AuthUser): string {
  if (!user.driverProfileId) throw AppError.conflict('Create your partner profile first.');
  return user.driverProfileId;
}

@ApiTags('plans')
@Controller()
export class PlansController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get(ApiRoutes.plans.root)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiContract({ summary: 'Subscription plans on sale', response: 'SubscriptionPlan', array: true })
  plans(): Promise<SubscriptionPlan[]> {
    return this.billing.listPlans(false);
  }
}

@ApiTags('driver')
@ApiBearerAuth()
@Roles(AccountRole.Driver)
@Controller()
export class PartnerBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get(ApiRoutes.driver.subscription)
  @ApiContract({ summary: 'The caller’s current plan and usage', response: 'DriverSubscription' })
  subscription(@CurrentUser() user: AuthUser): Promise<DriverSubscription> {
    return this.billing.getSubscription(profileId(user));
  }

  @Post(ApiRoutes.driver.subscriptionCheckout)
  @HttpCode(200)
  @Idempotent()
  @ApiContract({ summary: 'Buy a plan', body: 'SubscriptionCheckoutRequest', response: 'CheckoutSession', idempotent: true })
  checkout(@CurrentUser() user: AuthUser, @Body() body: CheckoutDto): Promise<CheckoutSession> {
    return this.billing.checkout(user, profileId(user), body.planId);
  }

  @Post(ApiRoutes.driver.subscriptionCancel)
  @HttpCode(200)
  @ApiContract({ summary: 'Turn off auto-renewal; access continues to the period end', response: 'DriverSubscription' })
  cancel(@CurrentUser() user: AuthUser): Promise<DriverSubscription> {
    return this.billing.cancelAutoRenew(user, profileId(user));
  }

  @Get(ApiRoutes.driver.invoices)
  @ApiContract({ summary: 'Invoices', response: 'Invoice', paginated: true })
  invoices(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto): Promise<Paginated<Invoice>> {
    return this.billing.listInvoices(profileId(user), q);
  }

  @Get(ApiRoutes.driver.featuredPlacements)
  @ApiContract({ summary: 'Featured placements bought or drawn from the plan', response: 'FeaturedPlacement', array: true })
  placements(@CurrentUser() user: AuthUser): Promise<FeaturedPlacement[]> {
    return this.billing.listPlacements(profileId(user));
  }

  @Post(ApiRoutes.driver.featuredPlacements)
  @Idempotent()
  @ApiContract({ summary: 'Feature a vehicle for a number of days', body: 'PurchaseFeaturedPlacementRequest', response: 'FeaturedPlacement', status: 201, idempotent: true })
  purchasePlacement(@CurrentUser() user: AuthUser, @Body() body: PurchasePlacementDto): Promise<FeaturedPlacement> {
    return this.billing.purchasePlacement(user, profileId(user), body);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminPlansController {
  constructor(private readonly billing: BillingService) {}

  @Get(ApiRoutes.admin.plans)
  @RequirePermission(Permission.PlansManage)
  @ApiContract({ summary: 'All plans, including inactive', response: 'SubscriptionPlan', array: true })
  plans(): Promise<SubscriptionPlan[]> {
    return this.billing.listPlans(true);
  }

  @Post(ApiRoutes.admin.plans)
  @RequirePermission(Permission.PlansManage)
  @ApiContract({ summary: 'Create a plan', body: 'SubscriptionPlanInput', response: 'SubscriptionPlan', status: 201 })
  create(@Body() body: PlanInputDto, @CurrentUser() actor: AuthUser): Promise<SubscriptionPlan> {
    return this.billing.createPlan(body, actor);
  }

  @Put(r(ApiRoutes.admin.plan(':planId')))
  @RequirePermission(Permission.PlansManage)
  @ApiContract({ summary: 'Update a plan', body: 'SubscriptionPlanInput', response: 'SubscriptionPlan' })
  update(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() body: PlanInputDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<SubscriptionPlan> {
    return this.billing.updatePlan(planId, body, actor);
  }
}

export { InvoiceQueryDto };
