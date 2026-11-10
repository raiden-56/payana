import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorCode } from '@payana/contracts';
import { PartnerApi } from '@core/api/partner.api';
import { loader } from '@core/util/loader';
import { Reveal } from '@ui/motion';
import { StatePanel } from '@ui/primitives';
import { Pager } from '@ui/status';
import { PartnerHead } from '../shared/page-head';
import { pollWhileVisible } from '../shared/poll';
import { RequestCard } from './request-card';

const PAGE_SIZE = 12;
const POLL_MS = 15_000;

/** The driver's inbox of open ride requests. Refreshes itself while on screen. */
@Component({
  selector: 'app-partner-requests',
  imports: [RouterLink, StatePanel, Pager, Reveal, PartnerHead, RequestCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-partner-head heading="Requests" lead="Ride requests that match your vehicle and area. Answer with your price; the customer chooses.">
      <span class="live" aria-live="polite"><span class="dot dot--live"></span> Updates on its own</span>
    </app-partner-head>

    @if (locked()) {
      <app-state-panel kind="info" title="Requests open once you are verified" message="When your documents are approved, requests near you appear here.">
        <a routerLink="/partner/onboarding" class="btn btn--dark btn--sm">Check verification</a>
      </app-state-panel>
    } @else {
      @switch (feed.status()) {
        @case ('error') {
          <app-state-panel [error]="feed.error()" (retry)="feed.load()" />
        }
        @case ('ready') {
          <div class="grid grid--auto list" style="--min: 21rem">
            @for (item of feed.data()!.items; track item.requestId; let i = $index) {
              <app-request-card [request]="item" appReveal [revealDelay]="i * 50" />
            } @empty {
              <app-state-panel class="list__empty" kind="empty" title="No open requests right now" message="New requests show up here by themselves. Stay available with location sharing on to be offered nearby rides first." />
            }
          </div>
          <app-pager [page]="feed.data()!.page" [pageSize]="feed.data()!.pageSize" [total]="feed.data()!.total" (pageChange)="setPage($event)" />
        }
        @default {
          <div class="grid grid--auto" style="--min: 21rem" aria-hidden="true">
            @for (n of [1, 2, 3]; track n) {
              <span class="skeleton" style="height: 13rem; border-radius: var(--r-lg)"></span>
            }
          </div>
        }
      }
    }
  `,
  styles: `
    .live {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--fs-sm);
      font-weight: 600;
      color: var(--ink-700);
    }
    .list__empty {
      grid-column: 1 / -1;
    }
  `,
})
export class Requests {
  private readonly api = inject(PartnerApi);
  private readonly page = signal(1);

  protected readonly feed = loader(() => this.api.requests({ page: this.page(), pageSize: PAGE_SIZE }));
  protected readonly locked = computed(() => this.feed.error()?.code === ErrorCode.DriverNotVerified);

  constructor() {
    this.feed.load();
    pollWhileVisible(() => this.feed.load({ silent: true }), POLL_MS);
  }

  protected setPage(page: number): void {
    this.page.set(page);
    this.feed.load();
    window.scrollTo({ top: 0 });
  }
}
