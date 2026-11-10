import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { Region, VehicleCategory } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { CatalogApi } from '@core/api/public.api';
import { MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { VehicleArt } from '@ui/vehicle-art';
import { CategoryForm } from './category-form';
import { RegionForm } from './region-form';

type Tab = 'regions' | 'categories';

/** Service areas and vehicle categories: the reference data the whole marketplace runs on. */
@Component({
  selector: 'app-admin-catalog',
  imports: [Icon, StatePanel, StatusBadge, VehicleArt, RegionForm, CategoryForm, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editingCategory() !== undefined) {
      <app-admin-category-form [category]="editingCategory() ?? null" (saved)="onCategorySaved($event)" (cancelled)="editingCategory.set(undefined)" />
    } @else {
      <header class="a-head">
        <div>
          <h1>Regions &amp; vehicles</h1>
          <p>Towns we serve and the kinds of vehicle on offer. Changes here take effect for everyone straight away.</p>
        </div>
        <div class="a-head__actions">
          @if (tab() === 'regions') {
            <button type="button" class="btn btn--dark" (click)="openRegion(null)"><app-icon name="plus" [size]="16" /> Add region</button>
          } @else {
            <button type="button" class="btn btn--dark" (click)="editingCategory.set(null)"><app-icon name="plus" [size]="16" /> Add category</button>
          }
        </div>
      </header>

      <div class="segmented tabs" role="tablist" aria-label="Catalogue">
        <button type="button" role="tab" id="tab-regions" class="segmented__item" [attr.aria-selected]="tab() === 'regions'" aria-controls="panel-catalog" (click)="tab.set('regions')">
          <app-icon name="map" [size]="16" /> Regions
        </button>
        <button type="button" role="tab" id="tab-categories" class="segmented__item" [attr.aria-selected]="tab() === 'categories'" aria-controls="panel-catalog" (click)="tab.set('categories')">
          <app-icon name="car" [size]="16" /> Vehicle categories
        </button>
      </div>

      <div id="panel-catalog" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
        @if (tab() === 'regions') {
          @switch (regions.status()) {
            @case ('error') {
              <app-state-panel [error]="regions.error()" (retry)="regions.load()" />
            }
            @case ('ready') {
              @if (regions.data()!.length) {
                <div class="table-wrap table-wrap--stack">
                  <table class="table">
                    <caption class="visually-hidden">Regions</caption>
                    <thead>
                      <tr>
                        <th scope="col">Region</th>
                        <th scope="col">Status</th>
                        <th scope="col">Centre</th>
                        <th scope="col" class="num">Radius</th>
                        <th scope="col">Tagline</th>
                        <th scope="col"><span class="visually-hidden">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of regions.data(); track r.id) {
                        <tr>
                          <td data-label="Region">
                            <strong>{{ r.name }}</strong>
                            @if (r.nameLocal) {
                              <span class="kn" lang="kn"> {{ r.nameLocal }}</span>
                            }
                            <small class="a-mono">{{ r.slug }} · {{ r.state }}</small>
                          </td>
                          <td data-label="Status"><app-status-badge kind="region" [value]="r.status" /></td>
                          <td data-label="Centre" class="tabular">{{ r.center.lat.toFixed(4) }}, {{ r.center.lng.toFixed(4) }}</td>
                          <td data-label="Radius" class="num">{{ r.radiusKm }} km</td>
                          <td data-label="Tagline">{{ r.tagline || '—' }}</td>
                          <td data-label="">
                            <div class="a-row-actions">
                              <button type="button" class="btn btn--outline btn--sm" (click)="openRegion(r)">
                                <app-icon name="edit" [size]="15" /> Edit <span class="visually-hidden">{{ r.name }}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <app-state-panel title="No regions yet" message="Add the first town to start taking sign-ups there." />
              }
            }
            @default {
              <div class="a-skeleton-rows" aria-hidden="true">
                @for (n of [1, 2, 3, 4]; track n) {
                  <span class="skeleton"></span>
                }
              </div>
            }
          }
        } @else {
          @switch (categories.status()) {
            @case ('error') {
              <app-state-panel [error]="categories.error()" (retry)="categories.load()" />
            }
            @case ('ready') {
              @if (categories.data()!.length) {
                <ul class="a-cards">
                  @for (c of categories.data(); track c.id) {
                    <li class="a-card" [class.is-inactive]="!c.isActive">
                      <div class="art" aria-hidden="true"><app-vehicle-art [icon]="c.icon" /></div>
                      <div class="title">
                        <h3>{{ c.name }}</h3>
                        <span class="badge" [class.badge--success]="c.isActive">{{ c.isActive ? 'Offered' : 'Switched off' }}</span>
                      </div>
                      <p class="a-sub"><span class="a-mono">{{ c.code }}</span> · {{ c.seats }} seats · {{ c.luggageCapacity }} bags</p>
                      <dl class="kv">
                        <dt>Base fare</dt>
                        <dd class="tabular">{{ c.pricing.baseFare | money }}</dd>
                        <dt>Typical per km</dt>
                        <dd class="tabular">{{ c.pricing.perKm | money }}</dd>
                        <dt>Allowed range</dt>
                        <dd class="tabular">{{ c.pricing.minPerKm | money }} – {{ c.pricing.maxPerKm | money }}</dd>
                        <dt>Waiting per hour</dt>
                        <dd class="tabular">{{ c.pricing.perHourWaiting | money }}</dd>
                      </dl>
                      <div class="a-card__foot">
                        <button type="button" class="btn btn--outline btn--sm" (click)="editingCategory.set(c)">
                          <app-icon name="edit" [size]="15" /> Edit <span class="visually-hidden">{{ c.name }}</span>
                        </button>
                      </div>
                    </li>
                  }
                </ul>
              } @else {
                <app-state-panel title="No vehicle categories yet" message="Add a category so drivers can list their vehicles." />
              }
            }
            @default {
              <div class="a-cards" aria-hidden="true">
                @for (n of [1, 2, 3]; track n) {
                  <span class="skeleton" style="height: 19rem; border-radius: var(--r-md)"></span>
                }
              </div>
            }
          }
        }
      </div>

      <app-admin-region-form [open]="regionOpen()" [region]="editingRegion()" (saved)="onRegionSaved($event)" (closed)="regionOpen.set(false)" />
    }
  `,
  styles: `
    .tabs {
      margin-bottom: 1.1rem;
    }
    .art {
      display: grid;
      place-items: center;
      padding: 0.4rem 1.5rem 0;
      border-radius: var(--r-sm);
      background: var(--marigold-50);
    }
    .art app-vehicle-art {
      width: min(11rem, 80%);
    }
    .title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
  `,
})
export class AdminCatalog {
  private readonly api = inject(AdminApi);
  private readonly publicCatalog = inject(CatalogApi);

  protected readonly tab = signal<Tab>('regions');
  protected readonly regions = loader(() => this.api.regions());
  protected readonly categories = loader(() => this.api.vehicleCategories());

  protected readonly regionOpen = signal(false);
  protected readonly editingRegion = signal<Region | null>(null);
  /** undefined = list view; null = creating; a category = editing it. */
  protected readonly editingCategory = signal<VehicleCategory | null | undefined>(undefined);

  constructor() {
    this.regions.load();
    this.categories.load();
  }

  protected openRegion(region: Region | null): void {
    this.editingRegion.set(region);
    this.regionOpen.set(true);
  }

  protected onRegionSaved(region: Region): void {
    this.regionOpen.set(false);
    this.regions.update((list) =>
      list.some((r) => r.id === region.id) ? list.map((r) => (r.id === region.id ? region : r)) : [...list, region],
    );
    // The public pages cache reference data for the session; let them refetch.
    this.publicCatalog.invalidate();
  }

  protected onCategorySaved(category: VehicleCategory): void {
    this.editingCategory.set(undefined);
    this.categories.update((list) =>
      (list.some((c) => c.id === category.id) ? list.map((c) => (c.id === category.id ? category : c)) : [...list, category]).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    );
    this.publicCatalog.invalidate();
  }
}
