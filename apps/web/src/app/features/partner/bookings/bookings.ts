import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PartnerApi } from '@core/api/partner.api';
import { loader } from '@core/util/loader';
import { Reveal } from '@ui/motion';
import { StatePanel } from '@ui/primitives';
import { Pager } from '@ui/status';
import { PartnerHead } from '../shared/page-head';
import { pollWhileVisible } from '../shared/poll';
import { BookingCard } from './booking-card';

type Scope = 'active' | 'past';
const PAGE_SIZE = 10;

/** The driver's bookings: what is coming up, and what is done. */
@Component({
  selector: 'app-partner-bookings',
  imports: [StatePanel, Pager, Reveal, PartnerHead, BookingCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-partner-head heading="Bookings" lead="Trips customers have confirmed with you. Open one to update its status or call the customer." />

    <div class="segmented tabs" role="tablist" aria-label="Which bookings">
      <button type="button" role="tab" class="segmented__item" [attr.aria-selected]="scope() === 'active'" (click)="setScope('active')">Upcoming and in progress</button>
      <button type="button" role="tab" class="segmented__item" [attr.aria-selected]="scope() === 'past'" (click)="setScope('past')">Past</button>
    </div>

    @switch (list.status()) {
      @case ('error') {
        <app-state-panel [error]="list.error()" (retry)="list.load()" />
      }
      @case ('ready') {
        <div class="grid grid--auto" style="--min: 22rem">
          @for (booking of list.data()!.items; track booking.id; let i = $index) {
            <app-booking-card [booking]="booking" appReveal [revealDelay]="i * 50" />
          } @empty {
            <app-state-panel
              style="grid-column: 1 / -1"
              kind="empty"
              [title]="scope() === 'active' ? 'No trips booked' : 'No past trips yet'"
              [message]="scope() === 'active' ? 'When a customer accepts one of your quotes, the booking appears here.' : 'Completed and cancelled bookings are kept here.'"
            />
          }
        </div>
        <app-pager [page]="list.data()!.page" [pageSize]="list.data()!.pageSize" [total]="list.data()!.total" (pageChange)="setPage($event)" />
      }
      @default {
        <div class="grid grid--auto" style="--min: 22rem" aria-hidden="true">
          @for (n of [1, 2]; track n) {
            <span class="skeleton" style="height: 12rem; border-radius: var(--r-lg)"></span>
          }
        </div>
      }
    }
  `,
  styles: `
    .tabs {
      margin-bottom: var(--s-5);
    }
    .tabs .segmented__item {
      min-height: 2.75rem;
    }
  `,
})
export class Bookings {
  private readonly api = inject(PartnerApi);
  protected readonly scope = signal<Scope>('active');
  private readonly page = signal(1);

  protected readonly list = loader(() => this.api.bookings({ scope: this.scope(), page: this.page(), pageSize: PAGE_SIZE }));

  constructor() {
    this.list.load();
    pollWhileVisible(() => {
      if (this.scope() === 'active') this.list.load({ silent: true });
    }, 30_000);
  }

  protected setScope(scope: Scope): void {
    if (scope === this.scope()) return;
    this.scope.set(scope);
    this.page.set(1);
    this.list.load();
  }

  protected setPage(page: number): void {
    this.page.set(page);
    this.list.load();
    window.scrollTo({ top: 0 });
  }
}
