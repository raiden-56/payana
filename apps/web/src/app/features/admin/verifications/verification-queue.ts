import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { VerificationStatus, type Region } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { CatalogApi } from '@core/api/public.api';
import { PhonePipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { Pager, StatusBadge, statusLabel } from '@ui/status';
import { PARTNER_LABEL } from './labels';

const PAGE_SIZE = 20;
const STATUSES = Object.values(VerificationStatus);

/** The verification queue: who is waiting for a document review, oldest first. */
@Component({
  selector: 'app-admin-verification-queue',
  imports: [RouterLink, Icon, StatePanel, StatusBadge, Pager, PhonePipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="a-head">
      <div>
        <h1>Verifications</h1>
        <p>Drivers and vehicle owners whose identity and vehicle papers need checking before they can be listed.</p>
      </div>
    </header>

    <div class="a-filters">
      <div class="field">
        <label class="field__label" for="vq-status">Status</label>
        <select id="vq-status" class="select" (change)="status.set($any($event.target).value); apply()">
          <option value="" [selected]="status() === ''">Any status</option>
          @for (s of statuses; track s) {
            <option [value]="s" [selected]="status() === s">{{ label(s) }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="vq-region">Service area</label>
        <select id="vq-region" class="select" (change)="region.set($any($event.target).value); apply()">
          <option value="" [selected]="region() === ''">Any area</option>
          @for (r of regions(); track r.id) {
            <option [value]="r.slug" [selected]="region() === r.slug">{{ r.name }}</option>
          }
        </select>
      </div>
    </div>

    @switch (queue.status()) {
      @case ('error') {
        <app-state-panel [error]="queue.error()" (retry)="queue.load()" />
      }
      @case ('ready') {
        @let page = queue.data()!;
        @if (page.items.length) {
          <div class="table-wrap table-wrap--stack">
            <table class="table">
              <caption class="visually-hidden">Partners in the verification queue</caption>
              <thead>
                <tr>
                  <th scope="col">Partner</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Areas</th>
                  <th scope="col" class="num">Vehicles</th>
                  <th scope="col" class="num">Documents waiting</th>
                  <th scope="col">Submitted</th>
                  <th scope="col"><span class="visually-hidden">Open</span></th>
                </tr>
              </thead>
              <tbody>
                @for (item of page.items; track item.driverProfileId) {
                  <tr>
                    <td data-label="Partner">
                      <a class="a-rowlink" [routerLink]="['/admin/verifications', item.driverProfileId]">{{ item.displayName }}</a>
                      <small class="tabular">{{ (item.phone | phone) || 'No phone' }}</small>
                    </td>
                    <td data-label="Type">{{ partnerLabel[item.partnerType] }}</td>
                    <td data-label="Status"><app-status-badge kind="verification" [value]="item.verificationStatus" /></td>
                    <td data-label="Areas">{{ item.serviceAreas.join(', ') || '—' }}</td>
                    <td data-label="Vehicles" class="num">{{ item.vehicles }}</td>
                    <td data-label="Waiting" class="num">
                      @if (item.documentsPending > 0) {
                        <strong class="a-warn">{{ item.documentsPending }}</strong>
                      } @else {
                        0
                      }
                    </td>
                    <td data-label="Submitted">{{ item.submittedAt ? (item.submittedAt | relativeTime) : 'Not yet' }}</td>
                    <td data-label="">
                      <div class="a-row-actions">
                        <a class="btn btn--dark btn--sm" [routerLink]="['/admin/verifications', item.driverProfileId]">
                          Review <app-icon name="arrow-right" [size]="15" />
                        </a>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <app-pager [page]="page.page" [pageSize]="page.pageSize" [total]="page.total" (pageChange)="goTo($event)" />
        } @else {
          <app-state-panel
            [title]="status() === 'pending' ? 'The queue is clear' : 'Nobody matches these filters'"
            [message]="status() === 'pending' ? 'No partner is waiting for review right now.' : 'Change the status or area to see other partners.'"
          />
        }
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3, 4, 5]; track n) {
            <span class="skeleton"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading the queue…</p>
      }
    }
  `,
})
export class VerificationQueue {
  private readonly api = inject(AdminApi);
  private readonly catalog = inject(CatalogApi);

  protected readonly statuses = STATUSES;
  protected readonly partnerLabel = PARTNER_LABEL;

  // The overview links here with ?status=…; otherwise start on what needs work.
  protected readonly status = signal<VerificationStatus | ''>(initialStatus(inject(ActivatedRoute)));
  protected readonly region = signal('');
  protected readonly regions = signal<Region[]>([]);
  private readonly page = signal(1);

  protected readonly queue = loader(() =>
    this.api.verifications({
      status: this.status() || undefined,
      regionSlug: this.region() || undefined,
      page: this.page(),
      pageSize: PAGE_SIZE,
    }),
  );

  constructor() {
    this.queue.load();
    // The area filter is optional; without the list the queue still works.
    this.catalog.regions().subscribe({ next: (regions) => this.regions.set(regions), error: () => undefined });
  }

  protected label(status: string): string {
    return statusLabel('verification', status);
  }

  protected apply(): void {
    this.page.set(1);
    this.queue.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.queue.load();
  }
}

function initialStatus(route: ActivatedRoute): VerificationStatus | '' {
  const requested = route.snapshot.queryParamMap.get('status');
  if (requested === 'any') return '';
  return STATUSES.includes(requested as VerificationStatus) ? (requested as VerificationStatus) : VerificationStatus.Pending;
}
