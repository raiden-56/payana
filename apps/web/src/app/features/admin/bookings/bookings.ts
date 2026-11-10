import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BookingStatus } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { DateTimePipe, HumanizePipe, MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { Pager, StatusBadge, statusLabel } from '@ui/status';

const PAGE_SIZE = 20;
const STATUSES = Object.values(BookingStatus);

/** Every booking on the platform, for monitoring and dispute work. */
@Component({
  selector: 'app-admin-bookings',
  imports: [RouterLink, Icon, StatePanel, StatusBadge, Pager, DateTimePipe, MoneyPipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="a-head">
      <div>
        <h1>Bookings</h1>
        <p>Monitor trips across the marketplace and resolve the ones under dispute.</p>
      </div>
    </header>

    <form class="a-filters" role="search" (submit)="$event.preventDefault(); apply()">
      <div class="field a-filters__wide">
        <label class="field__label" for="bk-q">Search</label>
        <input id="bk-q" class="input" type="search" placeholder="Booking code, customer or driver" [value]="q()" (input)="q.set($any($event.target).value)" />
      </div>
      <div class="field">
        <label class="field__label" for="bk-status">Status</label>
        <select id="bk-status" class="select" (change)="status.set($any($event.target).value); apply()">
          <option value="" [selected]="status() === ''">Any status</option>
          @for (s of statuses; track s) {
            <option [value]="s" [selected]="status() === s">{{ label(s) }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="bk-from">Pickup from</label>
        <input id="bk-from" class="input" type="date" [value]="from()" [max]="to() || null" (change)="from.set($any($event.target).value); apply()" />
      </div>
      <div class="field">
        <label class="field__label" for="bk-to">Pickup to</label>
        <input id="bk-to" class="input" type="date" [value]="to()" [min]="from() || null" (change)="to.set($any($event.target).value); apply()" />
      </div>
      <div class="a-filters__actions">
        <button type="submit" class="btn btn--dark"><app-icon name="search" [size]="16" /> Search</button>
        @if (q() || status() || from() || to()) {
          <button type="button" class="btn btn--ghost" (click)="clear()">Clear</button>
        }
      </div>
    </form>

    @switch (bookings.status()) {
      @case ('error') {
        <app-state-panel [error]="bookings.error()" (retry)="bookings.load()" />
      }
      @case ('ready') {
        @let page = bookings.data()!;
        @if (page.items.length) {
          <div class="table-wrap table-wrap--stack">
            <table class="table">
              <caption class="visually-hidden">Bookings</caption>
              <thead>
                <tr>
                  <th scope="col">Booking</th>
                  <th scope="col">Status</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Driver</th>
                  <th scope="col">Route</th>
                  <th scope="col">Pickup</th>
                  <th scope="col" class="num">Quoted</th>
                </tr>
              </thead>
              <tbody>
                @for (b of page.items; track b.id) {
                  <tr>
                    <td data-label="Booking">
                      <a class="a-rowlink a-mono" [routerLink]="['/admin/bookings', b.id]">{{ b.code }}</a>
                      <small>{{ b.tripType | humanize }}</small>
                    </td>
                    <td data-label="Status"><app-status-badge kind="booking" [value]="b.status" /></td>
                    <td data-label="Customer">{{ b.customerName }}</td>
                    <td data-label="Driver">{{ b.driverName }}</td>
                    <td data-label="Route">
                      {{ b.pickupLabel }}
                      @if (b.dropLabel) {
                        <small>to {{ b.dropLabel }}</small>
                      }
                    </td>
                    <td data-label="Pickup"><time [attr.datetime]="b.scheduledAt">{{ b.scheduledAt | dateTime }}</time></td>
                    <td data-label="Quoted" class="num">{{ b.quoted | money }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <app-pager [page]="page.page" [pageSize]="page.pageSize" [total]="page.total" (pageChange)="goTo($event)" />
        } @else {
          <app-state-panel title="No bookings match" message="Widen the dates or clear the filters." />
        }
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3, 4, 5, 6]; track n) {
            <span class="skeleton"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading bookings…</p>
      }
    }
  `,
})
export class AdminBookings {
  private readonly api = inject(AdminApi);

  protected readonly statuses = STATUSES;
  protected readonly q = signal('');
  protected readonly status = signal<BookingStatus | ''>(initialStatus(inject(ActivatedRoute)));
  protected readonly from = signal('');
  protected readonly to = signal('');
  private readonly page = signal(1);

  protected readonly bookings = loader(() =>
    this.api.bookings({
      q: this.q().trim() || undefined,
      status: this.status() || undefined,
      from: this.from() || undefined,
      to: this.to() || undefined,
      page: this.page(),
      pageSize: PAGE_SIZE,
    }),
  );

  constructor() {
    this.bookings.load();
  }

  protected label(status: string): string {
    return statusLabel('booking', status);
  }

  protected apply(): void {
    this.page.set(1);
    this.bookings.load();
  }

  protected clear(): void {
    this.q.set('');
    this.status.set('');
    this.from.set('');
    this.to.set('');
    this.apply();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.bookings.load();
  }
}

function initialStatus(route: ActivatedRoute): BookingStatus | '' {
  const requested = route.snapshot.queryParamMap.get('status');
  return STATUSES.includes(requested as BookingStatus) ? (requested as BookingStatus) : '';
}
