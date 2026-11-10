import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Booking } from '@payana/contracts';
import { DateTimePipe, MoneyPipe } from '@core/util/format';
import { Icon } from '@ui/icon';
import { Avatar } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { TRIP_TYPE } from '../shared/labels';

/** A booking as the driver sees it in a list: a ticket stub that opens the full booking. */
@Component({
  selector: 'app-booking-card',
  imports: [RouterLink, Icon, Avatar, StatusBadge, MoneyPipe, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = booking();
    <a class="ticket bk" [routerLink]="['/partner/bookings', b.id]">
      <div class="ticket__main">
        <header class="bk__head">
          <span class="bk__code">{{ b.code }}</span>
          <app-status-badge kind="booking" [value]="b.status" />
          <span class="bk__type"><app-icon [name]="trip().icon" [size]="14" /> {{ trip().label }}</span>
        </header>
        <div class="route">
          <span class="route__dot" aria-hidden="true"></span>
          <div><p class="route__label"><span class="visually-hidden">Pickup: </span>{{ b.pickup.label }}</p></div>
          @if (b.drop; as drop) {
            <span class="route__dot route__dot--drop" aria-hidden="true"></span>
            <div><p class="route__label"><span class="visually-hidden">Drop: </span>{{ drop.label }}</p></div>
          } @else if (b.packageTitle) {
            <span class="route__dot route__dot--drop" aria-hidden="true"></span>
            <div><p class="route__label">{{ b.packageTitle }}</p></div>
          }
        </div>
      </div>
      <div class="ticket__stub bk__stub">
        <div class="bk__who">
          <app-avatar [name]="b.customer.displayName" [photoUrl]="b.customer.photoUrl" [size]="34" />
          <div>
            <strong>{{ b.customer.displayName }}</strong>
            <span>{{ b.scheduledAt | dateTime }}</span>
          </div>
        </div>
        <div class="bk__fare">
          <span>Fare</span>
          <strong>{{ b.fare.quoted | money }}</strong>
        </div>
        <app-icon class="bk__go" name="chevron-right" [size]="20" />
      </div>
    </a>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .bk {
      display: block;
      transition:
        transform var(--dur-3) var(--ease-out),
        box-shadow var(--dur-3) var(--ease-out);
    }
    @media (hover: hover) and (pointer: fine) {
      .bk:hover {
        transform: translate(-2px, -2px);
        box-shadow: var(--shadow-hard);
      }
      .bk:hover .bk__go {
        transform: translateX(3px);
      }
    }
    .bk__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem 0.6rem;
      margin-bottom: 0.8rem;
    }
    .bk__code {
      font-weight: 800;
      font-stretch: 110%;
      letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
    }
    .bk__type {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin-left: auto;
      font-size: var(--fs-xs);
      font-weight: 650;
      color: var(--ink-600);
    }
    .bk__stub {
      display: flex;
      align-items: center;
      gap: 0.75rem 1rem;
      padding-block: 0.8rem;
    }
    .bk__who {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
      flex: 1;
    }
    .bk__who div {
      display: grid;
      min-width: 0;
      line-height: 1.25;
    }
    .bk__who strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bk__who span,
    .bk__fare span {
      font-size: var(--fs-xs);
      color: var(--ink-600);
    }
    .bk__fare {
      display: grid;
      text-align: right;
      line-height: 1.2;
    }
    .bk__fare strong {
      font-size: 1.15rem;
      font-weight: 800;
    }
    .bk__go {
      color: var(--ink-500);
      transition: transform var(--dur-2) var(--ease-out);
    }
  `,
})
export class BookingCard {
  readonly booking = input.required<Booking>();
  protected readonly trip = computed(() => TRIP_TYPE[this.booking().tripType]);
}
