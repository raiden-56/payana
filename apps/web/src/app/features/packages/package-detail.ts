import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tap } from 'rxjs';
import { AdPlacement } from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { CatalogApi } from '@core/api/public.api';
import { DurationPipe, MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { AdSlot } from '@ui/ad-slot';
import { Icon } from '@ui/icon';
import { Reveal, ScrollProgress } from '@ui/motion';
import { PHOTOS, packagePhoto } from '@core/media/photos';
import { Photo } from '@ui/photo';
import { StatePanel } from '@ui/primitives';

/** One sightseeing package: the route stop by stop, indicative prices, and the way to request it. */
@Component({
  selector: 'app-package-detail',
  imports: [RouterLink, Icon, Photo, StatePanel, AdSlot, Reveal, ScrollProgress, MoneyPipe, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="container">
        <a routerLink="/packages" class="back"><app-icon name="arrow-left" [size]="16" /> All tours</a>

        @switch (tour.status()) {
          @case ('error') {
            <app-state-panel [error]="tour.error()" (retry)="tour.load()">
              <a routerLink="/packages" class="btn btn--outline btn--sm">Browse tours</a>
            </app-state-panel>
          }
          @case ('ready') {
            @let t = tour.data()!;
            <header class="head zoom-art">
              <app-photo class="head__art" [key]="photoKey()" [priority]="true" sizes="(min-width: 64rem) 55vw, 100vw" />
              <div class="head__text">
                <span class="eyebrow">Sightseeing route</span>
                <h1>{{ t.title }}</h1>
                <p>{{ t.summary }}</p>
                <ul class="facts">
                  <li><app-icon name="clock" [size]="18" /> <strong>{{ t.durationHours * 60 | duration }}</strong> door to door</li>
                  <li><app-icon name="route" [size]="18" /> <strong>{{ t.distanceKm }} km</strong> of driving</li>
                  <li><app-icon name="flag" [size]="18" /> <strong>{{ t.stops.length }}</strong> stops</li>
                  @if (t.bestTime) {
                    <li><app-icon name="sun" [size]="18" /> Best: <strong>{{ t.bestTime }}</strong></li>
                  }
                </ul>
              </div>
            </header>

            <div class="layout">
              <div class="main">
                <section appReveal>
                  <h2>The route</h2>
                  <!-- the line beside the stops draws itself as you scroll down the list -->
                  <ol class="stops" appScrollProgress>
                    @for (stop of t.stops; track stop.name; let i = $index) {
                      <li class="stop" appReveal="left" [revealDelay]="i * 60">
                        <span class="stop__n">{{ i + 1 }}</span>
                        <div>
                          <h3>{{ stop.name }}</h3>
                          @if (stop.description) {
                            <p>{{ stop.description }}</p>
                          }
                          <span class="stop__time"><app-icon name="clock" [size]="13" /> about {{ stop.durationMinutes | duration }} here</span>
                        </div>
                      </li>
                    }
                  </ol>
                </section>

                @if (t.highlights.length) {
                  <section appReveal>
                    <h2>Worth knowing</h2>
                    <ul class="highlights">
                      @for (h of t.highlights; track h) {
                        <li><app-icon name="check" [size]="16" /> {{ h }}</li>
                      }
                    </ul>
                  </section>
                }

                <app-ad-slot [placement]="adPlacement" [regionSlug]="t.regionSlug" />
              </div>

              <aside class="side">
                <div class="card card--poster prices">
                  <h2>Typical prices</h2>
                  @if (t.priceFrom.length) {
                    <dl>
                      @for (p of t.priceFrom; track p.categoryCode) {
                        <div>
                          <dt>{{ p.categoryName }}</dt>
                          <dd>from {{ p.price | money }}</dd>
                        </div>
                      }
                    </dl>
                  }
                  <p class="subtle">For the whole vehicle, not per person. A guide — each driver sends their own quote, and entry tickets are not included.</p>
                  <a class="btn btn--accent btn--lg btn--block" routerLink="/request" [queryParams]="requestParams()">
                    Ask drivers for this tour <app-icon class="btn__arrow" name="arrow-right" [size]="18" />
                  </a>
                </div>
              </aside>
            </div>
          }
          @default {
            <span class="skeleton" style="height: 22rem; border-radius: var(--r-xl)"></span>
          }
        }
      </div>
    </section>
  `,
  styles: `
    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: var(--s-4);
      font-weight: 650;
      color: var(--ink-700);
    }
    .back:hover {
      color: var(--laterite-600);
    }
    .head {
      display: grid;
      border: 1px solid rgb(var(--glow) / 0.3);
      border-radius: var(--r-xl);
      background: var(--sand-0);
      box-shadow: var(--shadow-hard);
      overflow: hidden;
      animation: rise-in var(--dur-4) var(--ease-out) both;
    }
    .head__art {
      aspect-ratio: 16 / 9;
    }
    .head__art::after {
      display: none;
    }
    .head__text {
      display: grid;
      gap: 0.8rem;
      align-content: center;
      padding: clamp(1.25rem, 1rem + 2vw, 2.5rem);
    }
    .head__text > p {
      font-size: var(--fs-lg);
      color: var(--ink-700);
      max-width: 36rem;
    }
    @media (min-width: 64rem) {
      .head {
        grid-template-columns: 1.05fr 1fr;
      }
      .head__art {
        aspect-ratio: auto;
        min-height: 24rem;
      }
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: 0.5rem 1rem;
      margin-top: 0.4rem;
    }
    .facts li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--fs-sm);
      color: var(--ink-700);
    }
    .facts app-icon {
      color: var(--laterite-600);
    }
    .layout {
      display: grid;
      gap: var(--s-8);
      align-items: start;
      margin-top: var(--s-10);
    }
    @media (min-width: 64rem) {
      .layout {
        grid-template-columns: minmax(0, 1fr) 21rem;
        gap: var(--s-12);
      }
      .side {
        position: sticky;
        top: calc(var(--header-h) + 1.25rem);
      }
    }
    .main {
      display: grid;
      gap: var(--s-10);
      min-width: 0;
    }
    .main h2 {
      font-size: var(--fs-h3);
      margin-bottom: var(--s-5);
    }
    .stops {
      position: relative;
      display: grid;
      gap: var(--s-5);
    }
    /* dashed guide, with a solid line drawn over it by scroll progress */
    .stops::before,
    .stops::after {
      content: '';
      position: absolute;
      left: 1.28rem;
      top: 1.4rem;
      bottom: 1.4rem;
      width: 0;
    }
    .stops::before {
      border-left: 3px dashed var(--sand-300);
    }
    .stops::after {
      border-left: 3px solid var(--laterite-600);
      transform-origin: top;
      transform: scaleY(clamp(0, (var(--p, 1) - 0.12) * 1.9, 1));
    }
    .stop {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: 2.75rem 1fr;
      gap: 1rem;
      align-items: start;
    }
    .stop__n {
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      border: var(--stroke) solid var(--ink-900);
      border-radius: 50%;
      background: var(--marigold-500);
  color: var(--on-accent);
      font-size: 1.15rem;
      font-weight: 800;
    }
    .stop > div {
      display: grid;
      gap: 0.3rem;
      padding: 0.9rem 1.1rem;
      border: var(--stroke) solid var(--color-border);
      border-radius: var(--r-md);
      background: var(--sand-0);
    }
    .stop h3 {
      font-size: 1.2rem;
    }
    .stop p {
      color: var(--color-text-muted);
    }
    .stop__time {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: var(--fs-xs);
      font-weight: 650;
      color: var(--ink-600);
    }
    .highlights {
      display: grid;
      gap: 0.6rem;
    }
    .highlights li {
      display: flex;
      gap: 0.6rem;
      align-items: flex-start;
    }
    .highlights app-icon {
      flex: none;
      margin-top: 0.2rem;
      padding: 0.1rem;
      border-radius: 50%;
      background: var(--palm-100);
      color: var(--palm-700);
    }
    .prices {
      display: grid;
      gap: 0.9rem;
    }
    .prices h2 {
      font-size: 1.3rem;
    }
    .prices dl > div {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1rem;
      padding: 0.55rem 0;
      border-bottom: 1px dashed var(--color-border);
    }
    .prices dt {
      color: var(--color-text-muted);
    }
    .prices dd {
      font-size: 1.15rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class PackageDetail {
  /** Route parameter. */
  readonly slug = input.required<string>();

  private readonly catalog = inject(CatalogApi);
  private readonly analytics = inject(AnalyticsService);

  protected readonly adPlacement = AdPlacement.PackageDetail;
  protected readonly tour = loader(() =>
    this.catalog.package(this.slug()).pipe(tap((t) => this.analytics.track('view_package', { package_slug: t.slug }))),
  );

  protected readonly photoKey = computed(() => {
    const t = this.tour.data();
    return packagePhoto(t?.artwork ?? '', t?.slug ?? '');
  });
  protected readonly photoCredit = computed(() => PHOTOS[this.photoKey()].credit);

  protected readonly requestParams = computed(() => {
    const t = this.tour.data();
    return { type: 'sightseeing', package: t?.slug, category: t?.priceFrom[0]?.categoryCode };
  });

  constructor() {
    effect(() => {
      this.slug();
      untracked(() => this.tour.load());
    });
  }
}
