import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { AdCampaign, Region } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { CatalogApi } from '@core/api/public.api';
import { DateOnlyPipe, HumanizePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { clickThroughRate, formatRate } from '../shared/rules';
import { CampaignForm, toCampaignInput } from './campaign-form';

/** Local-business advertising: campaigns, where they run and how they perform. */
@Component({
  selector: 'app-admin-ads',
  imports: [Icon, StatePanel, StatusBadge, CampaignForm, DateOnlyPipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing() !== undefined) {
      <app-admin-campaign-form [campaign]="editing() ?? null" [regions]="regions()" (saved)="onSaved($event)" (cancelled)="editing.set(undefined)" />
    } @else {
      <header class="a-head">
        <div>
          <h1>Advertisements</h1>
          <p>Campaigns from local businesses. Every advertisement is labelled “Sponsored” wherever it is shown.</p>
        </div>
        <div class="a-head__actions">
          <button type="button" class="btn btn--dark" (click)="editing.set(null)"><app-icon name="plus" [size]="16" /> New campaign</button>
        </div>
      </header>

      @switch (campaigns.status()) {
        @case ('error') {
          <app-state-panel [error]="campaigns.error()" (retry)="campaigns.load()" />
        }
        @case ('ready') {
          @if (campaigns.data()!.length) {
            <div class="table-wrap table-wrap--stack">
              <table class="table">
                <caption class="visually-hidden">Advertising campaigns</caption>
                <thead>
                  <tr>
                    <th scope="col">Campaign</th>
                    <th scope="col">Status</th>
                    <th scope="col">Runs</th>
                    <th scope="col">Shown in</th>
                    <th scope="col" class="num">Impressions</th>
                    <th scope="col" class="num">Clicks</th>
                    <th scope="col" class="num">Click rate</th>
                    <th scope="col"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of campaigns.data(); track c.id) {
                    <tr>
                      <td data-label="Campaign">
                        <strong>{{ c.title }}</strong>
                        <small>{{ c.advertiserName }} · weight {{ c.weight }}</small>
                      </td>
                      <td data-label="Status"><app-status-badge kind="campaign" [value]="c.status" /></td>
                      <td data-label="Runs">
                        <time [attr.datetime]="c.startsOn">{{ c.startsOn | dateOnly }}</time>
                        <small>to {{ c.endsOn | dateOnly }}</small>
                      </td>
                      <td data-label="Shown in">
                        @for (p of c.placements; track p) {
                          <span>{{ p | humanize }}{{ $last ? '' : ', ' }}</span>
                        }
                        <small>{{ c.regionSlugs.length ? c.regionSlugs.join(', ') : 'All regions' }}</small>
                      </td>
                      <td data-label="Impressions" class="num">{{ c.stats.impressions }}</td>
                      <td data-label="Clicks" class="num">{{ c.stats.clicks }}</td>
                      <td data-label="Click rate" class="num">{{ rate(c) }}</td>
                      <td data-label="">
                        <div class="a-row-actions">
                          @if (c.status === 'running' || c.status === 'scheduled') {
                            <button type="button" class="btn btn--soft btn--sm" [disabled]="busyId() === c.id" (click)="setStatus(c, 'paused')">
                              Pause <span class="visually-hidden">{{ c.title }}</span>
                            </button>
                          } @else if (c.status === 'paused' || c.status === 'draft') {
                            <button type="button" class="btn btn--soft btn--sm" [disabled]="busyId() === c.id" (click)="setStatus(c, 'scheduled')">
                              {{ c.status === 'draft' ? 'Schedule' : 'Resume' }} <span class="visually-hidden">{{ c.title }}</span>
                            </button>
                          }
                          <button type="button" class="btn btn--outline btn--sm" (click)="editing.set(c)">
                            <app-icon name="edit" [size]="15" /> Edit <span class="visually-hidden">{{ c.title }}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <app-state-panel title="No campaigns yet" message="Create a campaign for a local business to fill the sponsored positions." />
          }
        }
        @default {
          <div class="a-skeleton-rows" aria-hidden="true">
            @for (n of [1, 2, 3, 4]; track n) {
              <span class="skeleton"></span>
            }
          </div>
          <p class="visually-hidden" role="status">Loading campaigns…</p>
        }
      }
    }
  `,
})
export class AdminAds {
  private readonly api = inject(AdminApi);
  private readonly catalog = inject(CatalogApi);
  private readonly toasts = inject(ToastService);

  protected readonly campaigns = loader(() => this.api.adCampaigns());
  protected readonly regions = signal<Region[]>([]);
  /** undefined = list; null = creating; a campaign = editing it. */
  protected readonly editing = signal<AdCampaign | null | undefined>(undefined);
  protected readonly busyId = signal<string | null>(null);

  constructor() {
    this.campaigns.load();
    this.catalog.regions().subscribe({ next: (r) => this.regions.set(r), error: () => undefined });
  }

  protected rate(c: AdCampaign): string {
    return formatRate(clickThroughRate(c.stats.impressions, c.stats.clicks));
  }

  protected setStatus(c: AdCampaign, status: 'paused' | 'scheduled'): void {
    this.busyId.set(c.id);
    this.api.updateAdCampaign(c.id, toCampaignInput(c, status)).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.busyId.set(null);
        this.toasts.success(status === 'paused' ? 'Campaign paused.' : 'Campaign scheduled.');
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.toasts.error(error);
      },
    });
  }

  protected onSaved(campaign: AdCampaign): void {
    this.editing.set(undefined);
    if (this.campaigns.data()?.some((c) => c.id === campaign.id)) this.replace(campaign);
    else this.campaigns.update((list) => [campaign, ...list]);
  }

  private replace(updated: AdCampaign): void {
    this.campaigns.update((list) => list.map((c) => (c.id === updated.id ? updated : c)));
  }
}
