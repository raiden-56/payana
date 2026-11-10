import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { Region, TourPackage, VehicleCategory } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { CatalogApi } from '@core/api/public.api';
import { MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { PackageArt } from '@ui/package-art';
import { StatePanel } from '@ui/primitives';
import { PackageForm } from './package-form';

/** Sightseeing packages offered to customers. */
@Component({
  selector: 'app-admin-packages',
  imports: [Icon, StatePanel, PackageArt, PackageForm, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing() !== undefined) {
      <app-admin-package-form
        [pkg]="editing() ?? null"
        [regions]="regions()"
        [categories]="categories()"
        (saved)="onSaved($event)"
        (cancelled)="editing.set(undefined)"
      />
    } @else {
      <header class="a-head">
        <div>
          <h1>Tour packages</h1>
          <p>Ready-made sightseeing routes. Customers request a package and drivers quote for it.</p>
        </div>
        <div class="a-head__actions">
          <button type="button" class="btn btn--dark" (click)="editing.set(null)"><app-icon name="plus" [size]="16" /> New package</button>
        </div>
      </header>

      @switch (packages.status()) {
        @case ('error') {
          <app-state-panel [error]="packages.error()" (retry)="packages.load()" />
        }
        @case ('ready') {
          @if (packages.data()!.length) {
            <ul class="a-cards">
              @for (p of packages.data(); track p.id) {
                <li class="a-card pkg" [class.is-inactive]="!p.isActive">
                  <app-package-art class="pkg__art" [artwork]="p.artwork" aria-hidden="true" />
                  <div class="top">
                    <h3>{{ p.title }}</h3>
                    <span class="badge" [class.badge--success]="p.isActive">{{ p.isActive ? 'Shown' : 'Hidden' }}</span>
                  </div>
                  <p class="a-sub">{{ p.regionSlug }} · {{ p.durationHours }} h · {{ p.distanceKm }} km · {{ p.stops.length }} stops</p>
                  <p class="summary">{{ p.summary }}</p>
                  @if (p.priceFrom[0]; as from) {
                    <p class="a-sub">from <strong class="tabular">{{ from.price | money }}</strong> · {{ from.categoryName }}</p>
                  }
                  <div class="a-card__foot">
                    <button type="button" class="btn btn--outline btn--sm" (click)="editing.set(p)">
                      <app-icon name="edit" [size]="15" /> Edit <span class="visually-hidden">{{ p.title }}</span>
                    </button>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <app-state-panel title="No packages yet" message="Create the first sightseeing route for customers to request." />
          }
        }
        @default {
          <div class="a-cards" aria-hidden="true">
            @for (n of [1, 2, 3]; track n) {
              <span class="skeleton" style="height: 22rem; border-radius: var(--r-md)"></span>
            }
          </div>
          <p class="visually-hidden" role="status">Loading packages…</p>
        }
      }
    }
  `,
  styles: `
    .pkg__art {
      aspect-ratio: 16 / 9;
      border-radius: var(--r-sm);
      border: var(--stroke) solid var(--ink-900);
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .summary {
      font-size: var(--fs-sm);
      color: var(--ink-700);
      display: -webkit-box;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `,
})
export class AdminPackages {
  private readonly api = inject(AdminApi);
  private readonly catalog = inject(CatalogApi);

  protected readonly packages = loader(() => this.api.packages());
  // Public reference data: a marketing manager may not hold catalog.manage.
  protected readonly regions = signal<Region[]>([]);
  protected readonly categories = signal<VehicleCategory[]>([]);
  /** undefined = list; null = creating; a package = editing it. */
  protected readonly editing = signal<TourPackage | null | undefined>(undefined);

  constructor() {
    this.packages.load();
    this.catalog.regions().subscribe({ next: (r) => this.regions.set(r), error: () => undefined });
    this.catalog.vehicleCategories().subscribe({ next: (c) => this.categories.set(c), error: () => undefined });
  }

  protected onSaved(pkg: TourPackage): void {
    this.editing.set(undefined);
    this.packages.update((list) =>
      (list.some((p) => p.id === pkg.id) ? list.map((p) => (p.id === pkg.id ? pkg : p)) : [...list, pkg]).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    );
  }
}
