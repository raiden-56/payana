import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TicketStatus } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { HumanizePipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { Pager, StatusBadge, statusLabel } from '@ui/status';

const PAGE_SIZE = 20;

/** The support queue: complaints, disputes, refund requests and abuse reports. */
@Component({
  selector: 'app-admin-tickets',
  imports: [RouterLink, Icon, StatePanel, StatusBadge, Pager, HumanizePipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="a-head">
      <div>
        <h1>Support</h1>
        <p>Tickets raised by customers and drivers. Safety reports are always marked urgent.</p>
      </div>
    </header>

    <div class="a-filters">
      <div class="field">
        <label class="field__label" for="tk-status">Status</label>
        <select id="tk-status" class="select" (change)="status.set($any($event.target).value); apply()">
          <option value="" [selected]="status() === ''">Any status</option>
          @for (s of statuses; track s) {
            <option [value]="s" [selected]="status() === s">{{ label(s) }}</option>
          }
        </select>
      </div>
    </div>

    @switch (tickets.status()) {
      @case ('error') {
        <app-state-panel [error]="tickets.error()" (retry)="tickets.load()" />
      }
      @case ('ready') {
        @let page = tickets.data()!;
        @if (page.items.length) {
          <div class="table-wrap table-wrap--stack">
            <table class="table">
              <caption class="visually-hidden">Support tickets</caption>
              <thead>
                <tr>
                  <th scope="col">Ticket</th>
                  <th scope="col">Category</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
                  <th scope="col">Booking</th>
                  <th scope="col">Updated</th>
                  <th scope="col"><span class="visually-hidden">Open</span></th>
                </tr>
              </thead>
              <tbody>
                @for (t of page.items; track t.id) {
                  <tr>
                    <td data-label="Ticket">
                      <a class="a-rowlink" [routerLink]="['/admin/support', t.id]">{{ t.subject }}</a>
                      <small class="a-mono">{{ t.reference }}</small>
                    </td>
                    <td data-label="Category">{{ t.category | humanize }}</td>
                    <td data-label="Priority"><app-status-badge kind="priority" [value]="t.priority" /></td>
                    <td data-label="Status"><app-status-badge kind="ticket" [value]="t.status" /></td>
                    <td data-label="Booking" class="a-mono">{{ t.bookingCode || '—' }}</td>
                    <td data-label="Updated">{{ t.updatedAt | relativeTime }}</td>
                    <td data-label="">
                      <div class="a-row-actions">
                        <a class="btn btn--dark btn--sm" [routerLink]="['/admin/support', t.id]">Open <app-icon name="arrow-right" [size]="15" /></a>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <app-pager [page]="page.page" [pageSize]="page.pageSize" [total]="page.total" (pageChange)="goTo($event)" />
        } @else {
          <app-state-panel title="No tickets here" message="Nothing matches this status right now." />
        }
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3, 4, 5]; track n) {
            <span class="skeleton"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading tickets…</p>
      }
    }
  `,
})
export class AdminTickets {
  private readonly api = inject(AdminApi);

  protected readonly statuses = Object.values(TicketStatus);
  protected readonly status = signal<TicketStatus | ''>('');
  private readonly page = signal(1);

  protected readonly tickets = loader(() =>
    this.api.tickets({ status: this.status() || undefined, page: this.page(), pageSize: PAGE_SIZE }),
  );

  constructor() {
    this.tickets.load();
  }

  protected label(status: string): string {
    return statusLabel('ticket', status);
  }

  protected apply(): void {
    this.page.set(1);
    this.tickets.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.tickets.load();
  }
}
