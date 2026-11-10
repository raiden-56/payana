import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '@core/api/public.api';
import { DurationPipe, MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { Reveal } from '@ui/motion';
import { packagePhoto } from '@core/media/photos';
import { Tilt } from '@ui/motion';
import { Photo } from '@ui/photo';
import { StatePanel } from '@ui/primitives';

/** All sightseeing packages, filterable by town. */
@Component({
  selector: 'app-packages',
  imports: [RouterLink, Icon, Photo, StatePanel, Reveal, Tilt, MoneyPipe, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="container">
        <header class="page-head">
          <span class="eyebrow">Sightseeing</span>
          <h1>Days out, with someone who knows the road.</h1>
          <p>Routes put together with local drivers. Pick one, ask for quotes, and the driver takes care of the order and the timing.</p>
        </header>

        @if (regionOptions().length > 1) {
          <div class="filters" role="group" aria-label="Town">
            <button type="button" class="chip" [attr.aria-pressed]="!region()" (click)="region.set('')">Everywhere</button>
            @for (r of regionOptions(); track r.slug) {
              <button type="button" class="chip" [attr.aria-pressed]="region() === r.slug" (click)="region.set(r.slug)">{{ r.name }}</button>
            }
          </div>
        }

        @switch (packages.status()) {
          @case ('error') {
            <app-state-panel [error]="packages.error()" (retry)="packages.load()" />
          }
          @case ('ready') {
            @if (visible().length) {
              <ul class="grid grid--3 tours">
                @for (tour of visible(); track tour.id; let i = $index) {
                  <li appReveal [revealDelay]="(i % 3) * 80">
                    <a class="tour tilt spot" appTilt="4" [routerLink]="['/packages', tour.slug]">
                      <app-photo class="tour__art" [key]="photoFor(tour.artwork, tour.slug)" sizes="(min-width: 64rem) 30vw, 90vw" />
                      <div class="tour__body">
                        <p class="tour__meta">
                          <span><app-icon name="clock" [size]="14" /> {{ tour.durationHours * 60 | duration }}</span>
                          <span><app-icon name="route" [size]="14" /> {{ tour.distanceKm }} km</span>
                          <span><app-icon name="flag" [size]="14" /> {{ tour.stops.length }} stops</span>
                        </p>
                        <h2>{{ tour.title }}</h2>
                        <p class="tour__summary">{{ tour.summary }}</p>
                        <ul class="tour__stops">
                          @for (stop of tour.stops.slice(0, 4); track stop.name) {
                            <li>{{ stop.name }}</li>
                          }
                          @if (tour.stops.length > 4) {
                            <li class="more">+{{ tour.stops.length - 4 }} more</li>
                          }
                        </ul>
                        <p class="tour__price">
                          @if (tour.priceFrom[0]; as from) {
                            <span>from <strong>{{ from.price | money }}</strong> · {{ from.categoryName }}</span>
                          }
                          <span class="tour__go">See the route <app-icon name="arrow-right" [size]="16" /></span>
                        </p>
                      </div>
                    </a>
                  </li>
                }
              </ul>
            } @else {
              <app-state-panel kind="empty" title="No tours here yet" message="We have not published a sightseeing route for this town yet. You can still ask for a driver for the day.">
                <a routerLink="/request" [queryParams]="{ type: 'sightseeing' }" class="btn btn--accent btn--sm">Ask for a day trip</a>
              </app-state-panel>
            }
          }
          @default {
            <ul class="grid grid--3" aria-hidden="true">
              @for (n of [1, 2, 3]; track n) {
                <li><span class="skeleton" style="height: 27rem; border-radius: var(--r-lg)"></span></li>
              }
            </ul>
          }
        }
      </div>
    </section>
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: var(--s-6);
    }
    .tours > li {
      display: flex;
    }
    .tour {
      display: grid;
      grid-template-rows: auto 1fr;
      width: 100%;
      border: 1px solid var(--color-border);
      border-radius: var(--r-lg);
      background: var(--sand-0);
      overflow: hidden;
      transition: transform 500ms var(--ease-out), box-shadow var(--dur-3) var(--ease-out), border-color var(--dur-2);
    }
    @media (hover: hover) and (pointer: fine) {
      .tour:hover {
        border-color: rgb(var(--glow) / 0.45);
        box-shadow: var(--shadow-hard);
      }
      .tour:hover .tour__go app-icon {
        transform: translateX(4px);
      }
    }
    .tour__art {
      aspect-ratio: 16 / 10;
    }
    .tour__body {
      display: grid;
      gap: 0.6rem;
      align-content: start;
      padding: 1.1rem 1.25rem 1.25rem;
    }
    .tour__body h2 {
      font-size: 1.45rem;
    }
    .tour__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.9rem;
      font-size: var(--fs-xs);
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--laterite-700);
    }
    .tour__meta span {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .tour__summary {
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .tour__stops {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .tour__stops li {
      padding: 0.1rem 0.6rem;
      border-radius: var(--r-pill);
      background: var(--sand-200);
      font-size: var(--fs-xs);
      font-weight: 650;
    }
    .tour__stops .more {
      background: transparent;
      color: var(--color-text-subtle);
    }
    .tour__price {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      margin-top: auto;
      padding-top: 0.8rem;
      border-top: 1px dashed var(--color-border);
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .tour__price strong {
      font-size: 1.3rem;
      font-weight: 800;
      color: var(--ink-900);
    }
    .tour__go {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-weight: 700;
      color: var(--laterite-600);
      white-space: nowrap;
    }
    .tour__go app-icon {
      transition: transform var(--dur-2) var(--ease-out);
    }
  `,
})
export class Packages {
  private readonly catalog = inject(CatalogApi);

  protected readonly photoFor = packagePhoto;
  protected readonly region = signal('');
  protected readonly packages = loader(() => this.catalog.packages());
  private readonly regions = toSignal(this.catalog.regions(), { initialValue: [] });

  /** Only towns that actually have a tour are offered as filters. */
  protected readonly regionOptions = computed(() => {
    const used = new Set((this.packages.data() ?? []).map((p) => p.regionSlug));
    return this.regions().filter((r) => used.has(r.slug));
  });

  protected readonly visible = computed(() => {
    const all = this.packages.data() ?? [];
    return this.region() ? all.filter((p) => p.regionSlug === this.region()) : all;
  });

  constructor() {
    this.packages.load();
  }
}
