import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QuoteStatus, TripType, type DriverRequestFeedItem } from '@payana/contracts';
import { DateTimePipe, DistancePipe, MoneyPipe, RelativeTimePipe } from '@core/util/format';
import { Icon } from '@ui/icon';
import { StatusBadge } from '@ui/status';
import { TRIP_TYPE } from '../shared/labels';

/** One ride request in a driver's inbox. The whole card opens the request. */
@Component({
  selector: 'app-request-card',
  imports: [RouterLink, Icon, StatusBadge, MoneyPipe, DistancePipe, DateTimePipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = request();
    <a class="req" [class.req--direct]="r.directRequest" [routerLink]="['/partner/requests', r.requestId]">
      <header class="req__head">
        <span class="badge badge--dark"><app-icon [name]="trip().icon" [size]="13" /> {{ trip().label }}</span>
        @if (r.directRequest) {
          <span class="badge badge--accent"><app-icon name="heart" [size]="12" /> Asked for you</span>
        }
        @if (r.myQuote; as quote) {
          <app-status-badge kind="quote" [value]="quote.status" />
        }
        <span class="req__closes">closes {{ r.expiresAt | relativeTime }}</span>
      </header>

      <div class="route">
        <span class="route__dot" aria-hidden="true"></span>
        <div>
          <p class="route__label"><span class="visually-hidden">Pickup: </span>{{ r.pickup.label }}</p>
        </div>
        @if (r.drop; as drop) {
          <span class="route__dot route__dot--drop" aria-hidden="true"></span>
          <div>
            <p class="route__label"><span class="visually-hidden">Drop: </span>{{ drop.label }}</p>
          </div>
        } @else if (r.packageTitle) {
          <span class="route__dot route__dot--drop" aria-hidden="true"></span>
          <div>
            <p class="route__label">{{ r.packageTitle }}</p>
            <p class="route__sub">Sightseeing tour</p>
          </div>
        }
      </div>

      <ul class="req__facts">
        <li><app-icon name="calendar" [size]="15" /> {{ isNow() ? 'As soon as possible' : (r.scheduledAt | dateTime) }}</li>
        <li><app-icon name="users" [size]="15" /> {{ r.passengers }} {{ r.passengers === 1 ? 'passenger' : 'passengers' }}</li>
        @if (r.luggage > 0) {
          <li><app-icon name="luggage" [size]="15" /> {{ r.luggage }} {{ r.luggage === 1 ? 'bag' : 'bags' }}</li>
        }
        @if (r.distanceToPickupKm !== null) {
          <li><app-icon name="pin" [size]="15" /> {{ r.distanceToPickupKm | distance }} to pickup</li>
        }
      </ul>

      <footer class="req__foot">
        <div class="req__money">
          @if (r.myQuote; as quote) {
            <span class="req__label">Your quote</span>
            <strong>{{ quote.fare | money }}</strong>
          } @else if (r.estimate; as estimate) {
            <span class="req__label">Customer’s estimate</span>
            <strong>{{ estimate.low | money }} – {{ estimate.high | money }}</strong>
          } @else {
            <span class="req__label">No estimate</span>
            <strong>You set the fare</strong>
          }
        </div>
        <div class="req__cta">
          @if (r.competingQuotes > 0) {
            <span class="req__others">{{ r.competingQuotes }} other {{ r.competingQuotes === 1 ? 'quote' : 'quotes' }}</span>
          }
          <span class="btn btn--sm" [class.btn--accent]="canQuote()" [class.btn--outline]="!canQuote()">
            {{ canQuote() ? 'Send quote' : 'Open' }} <app-icon class="btn__arrow" name="arrow-right" [size]="15" />
          </span>
        </div>
      </footer>
    </a>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .req {
      display: grid;
      gap: 0.85rem;
      height: 100%;
      padding: 1rem 1.1rem 1.05rem;
      border: var(--stroke) solid var(--color-border);
      border-radius: var(--r-lg);
      background: var(--color-surface);
      transition:
        transform var(--dur-3) var(--ease-out),
        box-shadow var(--dur-3) var(--ease-out),
        border-color var(--dur-2) var(--ease-out);
    }
    @media (hover: hover) and (pointer: fine) {
      .req:hover {
        transform: translateY(-3px);
        border-color: var(--ink-900);
        box-shadow: var(--shadow-md);
      }
    }
    .req--direct {
      border-color: var(--ink-900);
      box-shadow: var(--shadow-hard-sm);
      background: linear-gradient(var(--marigold-50), var(--color-surface) 5.5rem);
    }
    .req__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
    }
    .req__closes {
      margin-left: auto;
      font-size: var(--fs-xs);
      font-weight: 650;
      color: var(--laterite-700);
      white-space: nowrap;
    }
    .req__facts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem 1rem;
      font-size: var(--fs-sm);
      color: var(--ink-700);
    }
    .req__facts li {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .req__facts app-icon {
      color: var(--ink-500);
    }
    .req__foot {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.6rem 1rem;
      padding-top: 0.8rem;
      border-top: 1px dashed var(--color-border);
    }
    .req__money {
      display: grid;
      line-height: 1.25;
    }
    .req__label,
    .req__others {
      font-size: var(--fs-xs);
      color: var(--color-text-subtle);
    }
    .req__money strong {
      font-size: 1.2rem;
      font-weight: 800;
      letter-spacing: -0.015em;
    }
    .req__cta {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      margin-left: auto;
    }
  `,
})
export class RequestCard {
  readonly request = input.required<DriverRequestFeedItem>();

  protected readonly trip = computed(() => TRIP_TYPE[this.request().tripType]);
  protected readonly isNow = computed(() => this.request().tripType === TripType.Immediate || !this.request().scheduledAt);
  /** A request this driver has not answered yet, or whose earlier quote is no longer standing. */
  protected readonly canQuote = computed(() => {
    const status = this.request().myQuote?.status;
    return !status || status === QuoteStatus.Withdrawn || status === QuoteStatus.Expired;
  });
}
