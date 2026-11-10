import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { SubscriptionPlan } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { HumanizePipe, MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { PlanForm } from './plan-form';

/** Driver subscription plans and their entitlements. */
@Component({
  selector: 'app-admin-plans',
  imports: [Icon, StatePanel, PlanForm, MoneyPipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing() !== undefined) {
      <app-admin-plan-form [plan]="editing() ?? null" (saved)="onSaved($event)" (cancelled)="editing.set(undefined)" />
    } @else {
      <header class="a-head">
        <div>
          <h1>Plans</h1>
          <p>What drivers can subscribe to, what each plan costs and what it unlocks.</p>
        </div>
        <div class="a-head__actions">
          <button type="button" class="btn btn--dark" (click)="editing.set(null)"><app-icon name="plus" [size]="16" /> New plan</button>
        </div>
      </header>

      @switch (plans.status()) {
        @case ('error') {
          <app-state-panel [error]="plans.error()" (retry)="plans.load()" />
        }
        @case ('ready') {
          @if (plans.data()!.length) {
            <ul class="a-cards">
              @for (p of plans.data(); track p.id) {
                <li class="a-card" [class.is-inactive]="!p.isActive">
                  <div class="top">
                    <h3>{{ p.name }}</h3>
                    <span class="a-tags">
                      @if (p.isRecommended) {
                        <span class="badge badge--accent">Recommended</span>
                      }
                      <span class="badge" [class.badge--success]="p.isActive">{{ p.isActive ? 'On sale' : 'Withdrawn' }}</span>
                    </span>
                  </div>
                  <p class="price">
                    <strong class="tabular">{{ p.price.amountMinor === 0 ? 'Free' : (p.price | money) }}</strong>
                    @if (p.price.amountMinor > 0) {
                      <span>/ {{ p.billingPeriod | humanize }}</span>
                    }
                  </p>
                  <p class="a-sub">{{ p.description }}</p>
                  <ul class="facts">
                    <li><app-icon name="car" [size]="15" /> {{ p.entitlements.maxVehicles }} vehicle{{ p.entitlements.maxVehicles === 1 ? '' : 's' }}</li>
                    <li><app-icon name="send" [size]="15" /> {{ p.entitlements.monthlyQuoteLimit === null ? 'Unlimited quotes' : p.entitlements.monthlyQuoteLimit + ' quotes a month' }}</li>
                    <li><app-icon name="sparkle" [size]="15" /> {{ p.entitlements.featuredDaysIncluded }} featured days</li>
                    @if (p.entitlements.priorityInSearch) {
                      <li><app-icon name="arrow-up-right" [size]="15" /> Priority in search</li>
                    }
                    @if (p.entitlements.analytics) {
                      <li><app-icon name="chart" [size]="15" /> Performance dashboard</li>
                    }
                    @if (p.entitlements.badge) {
                      <li><app-icon name="tag" [size]="15" /> “{{ p.entitlements.badge }}” badge</li>
                    }
                  </ul>
                  <div class="a-card__foot">
                    <button type="button" class="btn btn--outline btn--sm" (click)="editing.set(p)">
                      <app-icon name="edit" [size]="15" /> Edit <span class="visually-hidden">{{ p.name }}</span>
                    </button>
                    <span class="a-sub a-mono code">{{ p.code }}</span>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <app-state-panel title="No plans yet" message="Create a free plan first, then the paid tiers." />
          }
        }
        @default {
          <div class="a-cards" aria-hidden="true">
            @for (n of [1, 2, 3]; track n) {
              <span class="skeleton" style="height: 20rem; border-radius: var(--r-md)"></span>
            }
          </div>
          <p class="visually-hidden" role="status">Loading plans…</p>
        }
      }
    }
  `,
  styles: `
    .top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
    }
    .price {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
    }
    .price strong {
      font-size: 1.9rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .price span {
      color: var(--color-text-subtle);
      font-size: var(--fs-sm);
    }
    .facts {
      display: grid;
      gap: 0.35rem;
      font-size: var(--fs-sm);
    }
    .facts li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .facts app-icon {
      color: var(--laterite-600);
    }
    .a-card__foot {
      align-items: center;
    }
    .code {
      margin-left: auto;
    }
  `,
})
export class AdminPlans {
  private readonly api = inject(AdminApi);

  protected readonly plans = loader(() => this.api.plans());
  /** undefined = list; null = creating; a plan = editing it. */
  protected readonly editing = signal<SubscriptionPlan | null | undefined>(undefined);

  constructor() {
    this.plans.load();
  }

  protected onSaved(plan: SubscriptionPlan): void {
    this.editing.set(undefined);
    this.plans.update((list) =>
      (list.some((p) => p.id === plan.id) ? list.map((p) => (p.id === plan.id ? plan : p)) : [...list, plan]).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    );
  }
}
