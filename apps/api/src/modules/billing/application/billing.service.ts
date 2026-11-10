import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  FeatureFlag,
  InvoiceStatus,
  SubscriptionStatus,
  type BillingPeriod,
  type CheckoutSession,
  type DriverSubscription,
  type FeaturedPlacement,
  type Invoice,
  type PageQuery,
  type Paginated,
  type PaymentProvider,
  type PlanEntitlements,
  type PurchaseFeaturedPlacementRequest,
  type SubscriptionPlan,
  type SubscriptionPlanInput,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db, json } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { dateOnly, inr, iso, isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import type { EntitlementsPort } from '../../../common/ports.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import { MarketplaceFacade } from '../../marketplace/application/marketplace.facade.js';
import { todayInIndia } from '../../marketplace/infrastructure/rows.js';
import { SettingsService } from '../../platform/application/settings.service.js';
import { FREE_PLAN_CODE, PAST_DUE_GRACE_DAYS, addDays, addPeriod, daysInclusive, invoiceNumber } from '../domain/billing-rules.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment.port.js';

export const SUBSCRIPTION_CHANGED_EVENT = 'subscription.changed';
export interface SubscriptionChangedEvent {
  userId: string;
  planName: string;
  change: 'activated' | 'lapsed' | 'auto_renew_off';
}

interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string;
  price_minor: number;
  billing_period: BillingPeriod;
  entitlements: PlanEntitlements;
  highlights: string[];
  is_recommended: boolean;
  is_active: boolean;
  sort_order: number;
}

interface SubscriptionRow {
  id: string;
  driver_profile_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: Date;
  current_period_end: Date;
  auto_renew: boolean;
  quotes_used: number;
}

interface InvoiceRow {
  id: string;
  number: string;
  description: string;
  amount_minor: number;
  status: InvoiceStatus;
  provider: PaymentProvider;
  provider_order_id: string | null;
  issued_at: Date;
  paid_at: Date | null;
}

interface PlacementRow {
  id: string;
  vehicle_id: string;
  region_slug: string;
  starts_on: Date | string;
  ends_on: Date | string;
  status: 'scheduled' | 'active' | 'ended' | 'cancelled';
  from_plan_allowance: boolean;
}

const CURRENT = `status IN ('active','pending_payment','past_due')`;

/**
 * Plans, partner subscriptions, invoices and featured placements. Also the
 * implementation of EntitlementsPort that other modules consult.
 */
@Injectable()
export class BillingService implements EntitlementsPort {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly marketplace: MarketplaceFacade,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // --- plans ---------------------------------------------------------------------------

  async listPlans(includeInactive = false): Promise<SubscriptionPlan[]> {
    const rows = await this.db.query<PlanRow>(
      `SELECT * FROM subscription_plans ${includeInactive ? '' : 'WHERE is_active'} ORDER BY sort_order, price_minor`,
    );
    return rows.map(toPlan);
  }

  async createPlan(input: SubscriptionPlanInput, actor: AuthUser): Promise<SubscriptionPlan> {
    return this.db.tx(async () => {
      const dup = await this.db.one(`SELECT 1 FROM subscription_plans WHERE code = $1`, [input.code]);
      if (dup) throw AppError.conflict('A plan with this code already exists.');
      const row = await this.db.insert<PlanRow>('subscription_plans', planValues(input));
      await this.audit.record({ actor, action: 'plan.created', targetType: 'subscription_plan', targetId: row.id, metadata: { code: row.code, priceMinor: row.price_minor } });
      return toPlan(row);
    });
  }

  async updatePlan(planId: string, input: SubscriptionPlanInput, actor: AuthUser): Promise<SubscriptionPlan> {
    return this.db.tx(async () => {
      const existing = await this.db.one<PlanRow>(`SELECT * FROM subscription_plans WHERE id = $1 FOR UPDATE`, [planId]);
      if (!existing) throw AppError.notFound('Plan');
      if (input.code !== existing.code) throw AppError.invalid('code', 'The code of an existing plan cannot be changed.');
      if (existing.code === FREE_PLAN_CODE && (input.price.amountMinor !== 0 || !input.isActive)) {
        throw AppError.conflict('The free plan is every partner’s fallback: it must stay active and cost nothing.');
      }
      const row = await this.db.update<PlanRow>('subscription_plans', { id: planId }, { ...planValues(input), updated_at: new Date() });
      await this.audit.record({
        actor,
        action: 'plan.updated',
        targetType: 'subscription_plan',
        targetId: planId,
        metadata: { code: existing.code, priceMinor: input.price.amountMinor, previousPriceMinor: existing.price_minor, isActive: input.isActive },
      });
      return toPlan(row!);
    });
  }

  // --- entitlements (EntitlementsPort) -----------------------------------------------------

  async forDriver(driverProfileId: string): Promise<PlanEntitlements> {
    return (await this.current(driverProfileId)).plan.entitlements;
  }

  async assertCanSendQuote(driverProfileId: string): Promise<void> {
    const { sub, plan } = await this.current(driverProfileId);
    const limit = plan.entitlements.monthlyQuoteLimit;
    if (limit !== null && sub.quotes_used >= limit) {
      throw new AppError(
        403,
        ErrorCode.EntitlementExceeded,
        'Plan limit reached',
        `Your ${plan.name} plan includes ${limit} quotes per month and they are used up. Upgrade to keep quoting.`,
      );
    }
  }

  async recordQuoteSent(driverProfileId: string): Promise<void> {
    await this.db.exec(`UPDATE driver_subscriptions SET quotes_used = quotes_used + 1 WHERE driver_profile_id = $1 AND ${CURRENT}`, [
      driverProfileId,
    ]);
  }

  // --- subscription ---------------------------------------------------------------------------

  async getSubscription(driverProfileId: string): Promise<DriverSubscription> {
    const { sub, plan } = await this.current(driverProfileId);
    return {
      id: sub.id,
      plan: toPlan(plan),
      status: sub.status,
      currentPeriodStart: isoReq(sub.current_period_start),
      currentPeriodEnd: isoReq(sub.current_period_end),
      autoRenew: sub.auto_renew,
      usage: {
        quotesSent: sub.quotes_used,
        vehiclesListed: await this.marketplace.countVehicles(driverProfileId),
        featuredDaysUsed: await this.featuredDaysUsed(driverProfileId, sub.current_period_start),
      },
    };
  }

  async checkout(user: AuthUser, driverProfileId: string, planId: string): Promise<CheckoutSession> {
    await this.settings.requireFeature(FeatureFlag.Subscriptions);
    const plan = await this.db.one<PlanRow>(`SELECT * FROM subscription_plans WHERE id = $1`, [planId]);
    if (!plan || !plan.is_active) throw AppError.invalid('planId', 'This plan is not available.');
    if (plan.price_minor === 0) {
      throw AppError.invalid('planId', 'The free plan needs no checkout. Turn off auto-renewal to return to it.');
    }
    return this.db.tx(async () => {
      const { sub, plan: currentPlan } = await this.current(driverProfileId);
      if (currentPlan.id === plan.id && sub.status === SubscriptionStatus.Active) {
        throw AppError.conflict(`You are already on the ${plan.name} plan.`);
      }
      const now = new Date();
      const invoice = await this.createInvoice({
        driverProfileId,
        kind: 'subscription',
        description: `${plan.name} plan - ${plan.billing_period}`,
        amountMinor: plan.price_minor,
        at: now,
      });
      const order = await this.gateway.createOrder({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amountMinor: plan.price_minor,
        description: invoice.description,
      });
      if (order.status === 'completed') {
        await this.db.exec(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [invoice.id]);
        await this.db.exec(`UPDATE driver_subscriptions SET status = 'cancelled', updated_at = now() WHERE id = $1`, [sub.id]);
        const created = await this.db.insert<SubscriptionRow>('driver_subscriptions', {
          driver_profile_id: driverProfileId,
          plan_id: plan.id,
          status: SubscriptionStatus.Active,
          current_period_start: now,
          current_period_end: addPeriod(now, plan.billing_period),
        });
        await this.db.exec(`UPDATE invoices SET reference_id = $2 WHERE id = $1`, [invoice.id, created.id]);
        await this.outbox.publish(SUBSCRIPTION_CHANGED_EVENT, {
          userId: user.id,
          planName: plan.name,
          change: 'activated',
        } satisfies SubscriptionChangedEvent);
      } else {
        await this.db.exec(`UPDATE invoices SET provider_order_id = $2 WHERE id = $1`, [invoice.id, order.providerOrderId]);
      }
      await this.audit.record({
        actor: user,
        action: 'subscription.checkout',
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: { plan: plan.code, amountMinor: plan.price_minor, provider: this.gateway.provider, status: order.status },
      });
      return {
        invoiceId: invoice.id,
        provider: this.gateway.provider,
        status: order.status,
        providerOrderId: order.providerOrderId,
        providerPublicKey: order.providerPublicKey,
        amount: inr(plan.price_minor),
      };
    });
  }

  async cancelAutoRenew(user: AuthUser, driverProfileId: string): Promise<DriverSubscription> {
    await this.db.tx(async () => {
      const { sub, plan } = await this.current(driverProfileId);
      if (plan.price_minor === 0) throw AppError.conflict('You are on the free plan - there is nothing to cancel.');
      if (!sub.auto_renew) return;
      await this.db.exec(`UPDATE driver_subscriptions SET auto_renew = false, updated_at = now() WHERE id = $1`, [sub.id]);
      await this.audit.record({ actor: user, action: 'subscription.auto_renew_off', targetType: 'driver_subscription', targetId: sub.id });
      await this.outbox.publish(SUBSCRIPTION_CHANGED_EVENT, {
        userId: user.id,
        planName: plan.name,
        change: 'auto_renew_off',
      } satisfies SubscriptionChangedEvent);
    });
    return this.getSubscription(driverProfileId);
  }

  async listInvoices(driverProfileId: string, q: PageQuery): Promise<Paginated<Invoice>> {
    const w = pageWindow(q);
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM invoices WHERE driver_profile_id = $1`, [
      driverProfileId,
    ]);
    const rows = await this.db.query<InvoiceRow>(
      `SELECT * FROM invoices WHERE driver_profile_id = $1 ORDER BY issued_at DESC LIMIT ${w.limit} OFFSET ${w.offset}`,
      [driverProfileId],
    );
    return paginated(rows.map(toInvoice), total?.n ?? 0, w);
  }

  // --- featured placements ------------------------------------------------------------------------

  async listPlacements(driverProfileId: string): Promise<FeaturedPlacement[]> {
    const rows = await this.db.query<PlacementRow>(
      `SELECT * FROM featured_placements WHERE driver_profile_id = $1 ORDER BY starts_on DESC, created_at DESC LIMIT 100`,
      [driverProfileId],
    );
    return rows.map(toPlacement);
  }

  async purchasePlacement(
    user: AuthUser,
    driverProfileId: string,
    input: PurchaseFeaturedPlacementRequest,
  ): Promise<FeaturedPlacement> {
    await this.settings.requireFeature(FeatureFlag.FeaturedListings);
    const today = todayInIndia();
    if (input.startsOn < today) throw AppError.invalid('startsOn', 'The start date must be today or later.');
    if (input.startsOn > addDays(today, 60)) throw AppError.invalid('startsOn', 'Book featured days at most 60 days ahead.');
    const vehicle = await this.marketplace.vehicleOwnedBy(input.vehicleId, driverProfileId);
    if (!vehicle) throw AppError.notFound('Vehicle');
    if (vehicle.verification_status !== 'approved' || vehicle.listing_status !== 'published') {
      throw AppError.conflict('Only an approved, published vehicle can be featured.');
    }
    await this.catalog.assertRegionSlugs([input.regionSlug], 'regionSlug');
    const endsOn = addDays(input.startsOn, input.days - 1);

    return this.db.tx(async () => {
      const { sub, plan } = await this.current(driverProfileId);
      const overlap = await this.db.one(
        `SELECT 1 FROM featured_placements
          WHERE vehicle_id = $1 AND region_slug = $2 AND status IN ('scheduled','active')
            AND starts_on <= $4 AND ends_on >= $3`,
        [input.vehicleId, input.regionSlug, input.startsOn, endsOn],
      );
      if (overlap) throw AppError.conflict('This vehicle is already featured in that region for some of these days.');

      const used = await this.featuredDaysUsed(driverProfileId, sub.current_period_start);
      const remaining = Math.max(0, plan.entitlements.featuredDaysIncluded - used);
      const fromAllowance = input.days <= remaining;
      let invoiceId: string | null = null;
      if (!fromAllowance) {
        const amount = input.days * this.config.payments.featuredPricePerDayMinor;
        const invoice = await this.createInvoice({
          driverProfileId,
          kind: 'featured_placement',
          description: `Featured listing - ${input.days} day${input.days === 1 ? '' : 's'} in ${input.regionSlug}`,
          amountMinor: amount,
          at: new Date(),
        });
        const order = await this.gateway.createOrder({
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          amountMinor: amount,
          description: invoice.description,
        });
        if (order.status !== 'completed') {
          // A gateway that needs customer action cannot be completed inside this request.
          throw new AppError(503, ErrorCode.UpstreamUnavailable, 'Payment unavailable', 'Online payment for featured days is not available yet.');
        }
        await this.db.exec(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [invoice.id]);
        invoiceId = invoice.id;
      }
      const row = await this.db.insert<PlacementRow>('featured_placements', {
        driver_profile_id: driverProfileId,
        vehicle_id: input.vehicleId,
        region_slug: input.regionSlug,
        starts_on: input.startsOn,
        ends_on: endsOn,
        status: input.startsOn <= today ? 'active' : 'scheduled',
        from_plan_allowance: fromAllowance,
        invoice_id: invoiceId,
      });
      if (invoiceId) await this.db.exec(`UPDATE invoices SET reference_id = $2 WHERE id = $1`, [invoiceId, row.id]);
      await this.audit.record({
        actor: user,
        action: 'featured_placement.purchased',
        targetType: 'featured_placement',
        targetId: row.id,
        metadata: { days: input.days, regionSlug: input.regionSlug, fromAllowance },
      });
      return toPlacement(row);
    });
  }

  // --- upkeep -----------------------------------------------------------------------------------------

  /** Advances placement statuses with the calendar. */
  async rollPlacements(): Promise<void> {
    await this.db.exec(`UPDATE featured_placements SET status = 'ended' WHERE status IN ('scheduled','active') AND ends_on < CURRENT_DATE`);
    await this.db.exec(
      `UPDATE featured_placements SET status = 'active' WHERE status = 'scheduled' AND starts_on <= CURRENT_DATE AND ends_on >= CURRENT_DATE`,
    );
  }

  /** Applies period ends to every subscription that is past its end date. */
  async rollSubscriptions(): Promise<number> {
    const due = await this.db.query<{ driver_profile_id: string }>(
      `SELECT driver_profile_id FROM driver_subscriptions WHERE ${CURRENT} AND current_period_end <= now() LIMIT 500`,
    );
    for (const row of due) await this.current(row.driver_profile_id);
    return due.length;
  }

  async overview(): Promise<{ subscriptionsLast30DaysMinor: number; activeSubscriptions: number }> {
    const r = await this.db.one<{ revenue: string | null; active: number }>(
      `SELECT (SELECT COALESCE(sum(amount_minor), 0) FROM invoices
                WHERE kind = 'subscription' AND status = 'paid' AND paid_at >= now() - interval '30 days') AS revenue,
              (SELECT count(*)::int FROM driver_subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
                WHERE s.status = 'active' AND p.price_minor > 0 AND s.current_period_end > now()) AS active`,
    );
    return { subscriptionsLast30DaysMinor: Number(r?.revenue ?? 0), activeSubscriptions: r?.active ?? 0 };
  }

  // --- internals ----------------------------------------------------------------------------------------

  /**
   * The partner's current subscription, created or rolled forward as needed:
   *  - nobody is ever without one (the free plan is the floor);
   *  - a free period simply renews;
   *  - a paid period that ends is kept for a short grace window as past due,
   *    then replaced by the free plan. Nothing is charged automatically - the
   *    manual payment adapter cannot, and silently renewing would be false.
   */
  private async current(driverProfileId: string): Promise<{ sub: SubscriptionRow; plan: PlanRow }> {
    return this.db.tx(async () => {
      let sub = await this.db.one<SubscriptionRow>(
        `SELECT * FROM driver_subscriptions WHERE driver_profile_id = $1 AND ${CURRENT} FOR UPDATE`,
        [driverProfileId],
      );
      if (!sub) sub = await this.startFree(driverProfileId, new Date());
      let plan = (await this.db.one<PlanRow>(`SELECT * FROM subscription_plans WHERE id = $1`, [sub.plan_id]))!;

      const now = new Date();
      if (sub.current_period_end.getTime() <= now.getTime()) {
        if (plan.price_minor === 0) {
          sub = (await this.db.one<SubscriptionRow>(
            `UPDATE driver_subscriptions
                SET current_period_start = $2, current_period_end = $3, quotes_used = 0, status = 'active', updated_at = now()
              WHERE id = $1 RETURNING *`,
            [sub.id, now, addPeriod(now, plan.billing_period)],
          ))!;
        } else {
          const graceEnds = sub.current_period_end.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000;
          if (sub.auto_renew && now.getTime() < graceEnds) {
            if (sub.status !== SubscriptionStatus.PastDue) {
              sub = (await this.db.one<SubscriptionRow>(
                `UPDATE driver_subscriptions SET status = 'past_due', updated_at = now() WHERE id = $1 RETURNING *`,
                [sub.id],
              ))!;
            }
          } else {
            await this.db.exec(`UPDATE driver_subscriptions SET status = 'expired', updated_at = now() WHERE id = $1`, [sub.id]);
            const cards = await this.marketplace.driverCards([driverProfileId]);
            const userId = cards.get(driverProfileId)?.userId;
            if (userId) {
              await this.outbox.publish(SUBSCRIPTION_CHANGED_EVENT, {
                userId,
                planName: plan.name,
                change: 'lapsed',
              } satisfies SubscriptionChangedEvent);
            }
            sub = await this.startFree(driverProfileId, now);
            plan = (await this.db.one<PlanRow>(`SELECT * FROM subscription_plans WHERE id = $1`, [sub.plan_id]))!;
          }
        }
      }
      return { sub, plan };
    });
  }

  private async startFree(driverProfileId: string, now: Date): Promise<SubscriptionRow> {
    const free = await this.db.one<PlanRow>(`SELECT * FROM subscription_plans WHERE code = $1`, [FREE_PLAN_CODE]);
    if (!free) throw new Error('The free plan is missing from subscription_plans (reference data migration not applied?)');
    const created = await this.db.one<SubscriptionRow>(
      `INSERT INTO driver_subscriptions (driver_profile_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, 'active', $3, $4)
       ON CONFLICT (driver_profile_id) WHERE status IN ('active','pending_payment','past_due') DO NOTHING
       RETURNING *`,
      [driverProfileId, free.id, now, addPeriod(now, free.billing_period)],
    );
    if (created) return created;
    // Lost a race with a concurrent request: use the row that won.
    return (await this.db.one<SubscriptionRow>(`SELECT * FROM driver_subscriptions WHERE driver_profile_id = $1 AND ${CURRENT}`, [
      driverProfileId,
    ]))!;
  }

  private async featuredDaysUsed(driverProfileId: string, periodStart: Date): Promise<number> {
    const r = await this.db.one<{ days: number }>(
      `SELECT COALESCE(sum(ends_on - starts_on + 1), 0)::int AS days FROM featured_placements
        WHERE driver_profile_id = $1 AND from_plan_allowance AND status <> 'cancelled' AND created_at >= $2`,
      [driverProfileId, periodStart],
    );
    return r?.days ?? 0;
  }

  private async createInvoice(input: {
    driverProfileId: string;
    kind: 'subscription' | 'featured_placement';
    description: string;
    amountMinor: number;
    at: Date;
  }): Promise<{ id: string; number: string; description: string }> {
    const seq = await this.db.one<{ n: string }>(`SELECT nextval('invoice_number_seq') AS n`);
    const row = await this.db.insert<InvoiceRow>('invoices', {
      number: invoiceNumber(Number(seq!.n), input.at),
      driver_profile_id: input.driverProfileId,
      kind: input.kind,
      description: input.description,
      amount_minor: input.amountMinor,
      status: InvoiceStatus.Open,
      provider: this.gateway.provider,
      issued_at: input.at,
    });
    return { id: row.id, number: row.number, description: row.description };
  }
}

function planValues(input: SubscriptionPlanInput): Record<string, unknown> {
  return {
    code: input.code,
    name: input.name.trim(),
    description: input.description.trim(),
    price_minor: input.price.amountMinor,
    billing_period: input.billingPeriod,
    entitlements: json(input.entitlements),
    highlights: input.highlights,
    is_recommended: input.isRecommended,
    is_active: input.isActive,
    sort_order: input.sortOrder,
  };
}

function toPlan(p: PlanRow): SubscriptionPlan {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    price: inr(p.price_minor),
    billingPeriod: p.billing_period,
    entitlements: p.entitlements,
    highlights: p.highlights,
    isRecommended: p.is_recommended,
    isActive: p.is_active,
    sortOrder: p.sort_order,
  };
}

function toInvoice(i: InvoiceRow): Invoice {
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    description: i.description,
    amount: inr(i.amount_minor),
    provider: i.provider,
    issuedAt: isoReq(i.issued_at),
    paidAt: iso(i.paid_at),
  };
}

function toPlacement(p: PlacementRow): FeaturedPlacement {
  return {
    id: p.id,
    vehicleId: p.vehicle_id,
    regionSlug: p.region_slug,
    startsOn: dateOnly(p.starts_on)!,
    endsOn: dateOnly(p.ends_on)!,
    status: p.status,
    fromPlanAllowance: p.from_plan_allowance,
  };
}

export { daysInclusive };
