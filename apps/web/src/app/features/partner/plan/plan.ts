import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  BillingPeriod,
  ConversionEvent,
  FeatureFlag,
  PaymentProvider,
  SubscriptionStatus,
  type SubscriptionPlan,
} from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { CatalogApi } from '@core/api/public.api';
import { AppConfigService } from '@core/config/app-config.service';
import { newIdempotencyKey } from '@core/platform/platform';
import { DateOnlyPipe, MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Reveal } from '@ui/motion';
import { Modal, StatePanel } from '@ui/primitives';
import { Pager, StatusBadge } from '@ui/status';
import { IdempotencyKeys } from '../partner-logic';
import { PartnerHead } from '../shared/page-head';
import { FeaturedPlacements } from './featured-placements';

const PERIOD: Record<BillingPeriod, string> = {
  [BillingPeriod.Monthly]: 'month',
  [BillingPeriod.Quarterly]: '3 months',
  [BillingPeriod.Yearly]: 'year',
};

interface Meter {
  label: string;
  used: number;
  limit: number | null;
}

/** The partner's plan, what it allows, what has been used, and the invoices. */
@Component({
  selector: 'app-partner-plan',
  imports: [Icon, StatePanel, StatusBadge, Pager, Modal, Reveal, MoneyPipe, DateOnlyPipe, PartnerHead, FeaturedPlacements],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan.html',
  styleUrl: './plan.scss',
})
export class Plan {
  private readonly api = inject(PartnerApi);
  private readonly catalog = inject(CatalogApi);
  private readonly config = inject(AppConfigService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toasts = inject(ToastService);
  private readonly keys = new IdempotencyKeys(newIdempotencyKey);

  protected readonly subscriptionsOn = computed(() => this.config.isEnabled(FeatureFlag.Subscriptions));
  protected readonly featuredOn = computed(() => this.config.isEnabled(FeatureFlag.FeaturedListings));

  private readonly invoicePage = signal(1);
  protected readonly subscription = loader(() => this.api.subscription());
  protected readonly plans = loader(() => this.catalog.plans());
  protected readonly invoices = loader(() => this.api.invoices({ page: this.invoicePage(), pageSize: 8 }));

  protected readonly choosing = signal<SubscriptionPlan | null>(null);
  protected readonly confirmCancel = signal(false);
  protected readonly busy = signal(false);
  /** Plain-language outcome of the last checkout, shown until the next one. */
  protected readonly outcome = signal<{ tone: 'success' | 'warning'; text: string } | null>(null);

  protected readonly current = computed(() => this.subscription.data());
  protected readonly sortedPlans = computed(() =>
    [...(this.plans.data() ?? [])].filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
  );

  protected readonly meters = computed<Meter[]>(() => {
    const sub = this.current();
    if (!sub) return [];
    const e = sub.plan.entitlements;
    return [
      { label: 'Quotes sent this month', used: sub.usage.quotesSent, limit: e.monthlyQuoteLimit },
      { label: 'Vehicles listed', used: sub.usage.vehiclesListed, limit: e.maxVehicles },
      { label: 'Featured days used', used: sub.usage.featuredDaysUsed, limit: e.featuredDaysIncluded },
    ];
  });

  constructor() {
    this.subscription.load();
    this.invoices.load();
    if (this.subscriptionsOn()) this.plans.load();
  }

  protected period(plan: SubscriptionPlan): string {
    return PERIOD[plan.billingPeriod];
  }

  protected percent(meter: Meter): number {
    if (!meter.limit) return meter.limit === 0 ? 100 : 0;
    return Math.min(100, Math.round((meter.used / meter.limit) * 100));
  }

  protected isCurrent(plan: SubscriptionPlan): boolean {
    const sub = this.current();
    return !!sub && sub.plan.id === plan.id && sub.status !== SubscriptionStatus.Expired && sub.status !== SubscriptionStatus.Cancelled;
  }

  protected checkout(): void {
    const plan = this.choosing();
    if (!plan || this.busy()) return;
    this.busy.set(true);
    this.analytics.track('subscription_checkout', { plan_code: plan.code });
    this.api.checkout(plan.id, this.keys.keyFor({ planId: plan.id })).subscribe({
      next: (session) => {
        this.busy.set(false);
        this.choosing.set(null);
        if (session.status === 'completed') {
          const paid = session.amount.amountMinor > 0;
          this.outcome.set(
            session.provider === PaymentProvider.Manual && paid
              ? { tone: 'warning', text: `You are on ${plan.name}. Online payment is not connected yet, so no money was charged — the invoice is recorded as settled offline and our team will contact you about payment.` }
              : { tone: 'success', text: `You are on ${plan.name}.` },
          );
          if (paid) {
            this.analytics.conversion(ConversionEvent.SubscriptionPurchased, {
              valueMinor: session.amount.amountMinor,
              currency: session.amount.currency,
              transactionId: session.invoiceId,
            });
          }
        } else {
          this.outcome.set({ tone: 'warning', text: 'This plan needs an online payment, which is not available in the app yet. Nothing was charged and your plan has not changed.' });
        }
        this.subscription.load({ silent: true });
        this.invoices.load({ silent: true });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.choosing.set(null);
        const apiError = toApiError(error);
        this.toasts.error(apiError.problem?.detail ?? apiError.message);
      },
    });
  }

  protected cancelRenewal(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.cancelSubscription().subscribe({
      next: (sub) => {
        this.busy.set(false);
        this.confirmCancel.set(false);
        this.subscription.set(sub);
        this.toasts.info('Renewal switched off. Your plan stays active until the period ends.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirmCancel.set(false);
        this.toasts.error(toApiError(error));
      },
    });
  }

  protected setInvoicePage(page: number): void {
    this.invoicePage.set(page);
    this.invoices.load();
  }
}
