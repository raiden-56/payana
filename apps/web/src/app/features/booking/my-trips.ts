import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RideRequestStatus } from '@payana/contracts';
import { BookingsApi, RideRequestsApi } from '@core/api/customer.api';
import { DateTimePipe, MoneyPipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { Reveal } from '@ui/motion';
import { Avatar, StatePanel } from '@ui/primitives';
import { Pager, StatusBadge } from '@ui/status';
import { VehicleArt } from '@ui/vehicle-art';

type Scope = 'active' | 'past';
const PAGE_SIZE = 10;

/** The customer's trips: requests still waiting for quotes, then bookings (upcoming or past). */
@Component({
  selector: 'app-my-trips',
  imports: [RouterLink, Icon, Avatar, VehicleArt, StatePanel, StatusBadge, Pager, Reveal, MoneyPipe, DateTimePipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="container container--narrow">
        <header class="page-head spread">
          <div class="stack" style="--stack-gap: 0.4rem">
            <span class="eyebrow">My trips</span>
            <h1>Where you are going, and where you have been.</h1>
          </div>
        </header>

        <!-- requests still open -->
        @if (openRequests().length) {
          <section class="open" aria-labelledby="open-title">
            <h2 id="open-title">Waiting for you to choose</h2>
            <ul class="stack">
              @for (r of openRequests(); track r.id) {
                <li>
                  <a class="open__item" [routerLink]="['/requests', r.id]">
                    <span class="open__pulse" aria-hidden="true"></span>
                    <div>
                      <strong>{{ r.pickup.label }}@if (r.drop) { → {{ r.drop.label }} }</strong>
                      <span>{{ r.categoryName }} · {{ r.quotes.length }} {{ r.quotes.length === 1 ? 'quote' : 'quotes' }} · closes {{ r.expiresAt | relativeTime }}</span>
                    </div>
                    <app-icon name="chevron-right" />
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <div class="segmented tabs" role="tablist" aria-label="Bookings">
          <button type="button" role="tab" class="segmented__item" [attr.aria-selected]="scope() === 'active'" (click)="setScope('active')">Upcoming</button>
          <button type="button" role="tab" class="segmented__item" [attr.aria-selected]="scope() === 'past'" (click)="setScope('past')">Past</button>
        </div>

        @switch (bookings.status()) {
          @case ('error') {
            <app-state-panel [error]="bookings.error()" (retry)="bookings.load()" />
          }
          @case ('ready') {
            @if (bookings.data()!.items.length) {
              <ul class="list">
                @for (b of bookings.data()!.items; track b.id; let i = $index) {
                  <li appReveal [revealDelay]="i * 50">
                    <a class="ticket trip spin-wheels" [routerLink]="['/bookings', b.id]">
                      <div class="ticket__main trip__main">
                        <div class="trip__head">
                          <span class="trip__code tabular">{{ b.code }}</span>
                          <app-status-badge kind="booking" [value]="b.status" />
                        </div>
                        <div class="route">
                          <span class="route__dot"></span>
                          <p class="route__label">{{ b.pickup.label }}</p>
                          @if (b.drop) {
                            <span class="route__dot route__dot--drop"></span>
                            <p class="route__label">{{ b.drop.label }}</p>
                          }
                        </div>
                      </div>
                      <div class="ticket__stub trip__stub">
                        <app-vehicle-art [icon]="b.vehicle.icon" />
                        <div class="trip__who">
                          <app-avatar [name]="b.driver.displayName" [photoUrl]="b.driver.photoUrl" [size]="34" />
                          <div>
                            <strong>{{ b.driver.displayName }}</strong>
                            <span>{{ b.scheduledAt | dateTime }}</span>
                          </div>
                        </div>
                        <strong class="trip__fare">{{ b.fare.quoted | money }}</strong>
                      </div>
                    </a>
                  </li>
                }
              </ul>
              <app-pager [page]="page()" [pageSize]="pageSize" [total]="bookings.data()!.total" (pageChange)="goTo($event)" />
            } @else {
              <app-state-panel
                kind="empty"
                [title]="scope() === 'active' ? 'No upcoming trips' : 'No past trips yet'"
                [message]="scope() === 'active' ? 'When you accept a driver’s quote, the booking shows up here.' : 'Completed and cancelled bookings are kept here, with their receipts.'"
              >
                <a routerLink="/request" class="btn btn--accent btn--sm">Book a ride</a>
              </app-state-panel>
            }
          }
          @default {
            <div class="stack" aria-hidden="true">
              @for (n of [1, 2, 3]; track n) {
                <span class="skeleton" style="height: 11rem; border-radius: var(--r-lg)"></span>
              }
            </div>
          }
        }
      </div>
    </section>
  `,
  styles: `
    .open {
      margin-bottom: var(--s-8);
    }
    .open h2 {
      font-size: var(--fs-h4);
      margin-bottom: var(--s-3);
    }
    .open__item {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 0.9rem;
      align-items: center;
      padding: 0.9rem 1.1rem;
      border: var(--stroke) solid var(--ink-900);
      border-radius: var(--r-md);
      background: var(--marigold-50);
      box-shadow: var(--shadow-hard-sm);
      transition: transform var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
    }
    .open__item:hover {
      transform: translate(-1.5px, -1.5px);
      box-shadow: var(--shadow-hard);
    }
    .open__item div {
      display: grid;
      min-width: 0;
      line-height: 1.3;
    }
    .open__item span {
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .open__pulse {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      background: var(--laterite-500);
      color: var(--laterite-500);
      animation: pulse-ring 1.8s var(--ease-out) infinite;
    }
    .tabs {
      margin-bottom: var(--s-5);
    }
    .list {
      display: grid;
      gap: var(--s-5);
    }
    .trip {
      display: block;
      transition: transform var(--dur-3) var(--ease-out), box-shadow var(--dur-3) var(--ease-out);
    }
    .trip:hover {
      transform: translate(-2px, -2px);
      box-shadow: var(--shadow-hard);
    }
    .trip__main {
      display: grid;
      gap: 0.9rem;
    }
    .trip__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .trip__code {
      font-weight: 750;
      letter-spacing: 0.1em;
      color: var(--ink-600);
    }
    .trip .route {
      row-gap: 0.5rem;
    }
    .trip__stub {
      display: grid;
      grid-template-columns: 4.5rem 1fr auto;
      gap: 0.9rem;
      align-items: center;
    }
    .trip__who {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
    }
    .trip__who div {
      display: grid;
      min-width: 0;
      line-height: 1.25;
    }
    .trip__who span {
      font-size: var(--fs-xs);
      color: var(--ink-600);
    }
    .trip__fare {
      font-size: 1.4rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class MyTrips {
  private readonly bookingsApi = inject(BookingsApi);
  private readonly requestsApi = inject(RideRequestsApi);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly scope = signal<Scope>('active');
  protected readonly page = signal(1);

  protected readonly bookings = loader(() =>
    this.bookingsApi.list({ scope: this.scope(), page: this.page(), pageSize: PAGE_SIZE }),
  );
  private readonly requests = loader(() => this.requestsApi.list({ status: RideRequestStatus.Open, pageSize: 5 }));
  protected readonly openRequests = computed(() => this.requests.data()?.items ?? []);

  constructor() {
    this.bookings.load();
    this.requests.load();
  }

  protected setScope(scope: Scope): void {
    if (scope === this.scope()) return;
    this.scope.set(scope);
    this.page.set(1);
    this.bookings.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.bookings.load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
