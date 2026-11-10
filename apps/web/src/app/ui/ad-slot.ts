import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FeatureFlag, type AdCreative, type AdPlacement } from '@payana/contracts';
import { AdsApi } from '@core/api/public.api';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { AppConfigService } from '@core/config/app-config.service';
import { Icon } from './icon';

/**
 * One advertising position on a page.
 *
 * Order of preference:
 *  1. A local-business campaign from the platform's own inventory (GET /ads).
 *  2. Otherwise a Google AdSense unit - only if a publisher ID and a slot ID
 *     for this placement are configured AND the visitor consented to
 *     advertising.
 *  3. Otherwise nothing: the slot collapses and leaves no gap.
 *
 * Everything shown here is labelled "Sponsored".
 */
@Component({
  selector: 'app-ad-slot',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[hidden]': '!ad() && !showAdsense()' },
  template: `
    @if (ad(); as a) {
      <aside class="ad" aria-label="Sponsored">
        <span class="tag">Sponsored</span>
        @if (a.imageUrl) {
          <img class="ad__image" [src]="a.imageUrl" alt="" loading="lazy" decoding="async" />
        } @else {
          <span class="ad__mark" aria-hidden="true"><app-icon name="megaphone" [size]="26" /></span>
        }
        <div class="ad__text">
          <p class="ad__by">{{ a.advertiserName }}</p>
          <h3>{{ a.title }}</h3>
          <p>{{ a.body }}</p>
        </div>
        <a
          class="btn btn--outline btn--sm"
          [href]="a.ctaUrl"
          target="_blank"
          rel="sponsored noopener noreferrer"
          (click)="onClick(a)"
        >
          {{ a.ctaLabel }} <app-icon name="arrow-up-right" [size]="15" />
        </a>
      </aside>
    } @else if (showAdsense()) {
      <aside class="adsense" aria-label="Advertisement">
        <span class="tag">Advertisement</span>
        <ins
          class="adsbygoogle"
          style="display:block"
          [attr.data-ad-client]="settings().adsensePublisherId"
          [attr.data-ad-slot]="adsenseSlot()"
          data-ad-format="auto"
          data-full-width-responsive="true"
        ></ins>
      </aside>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .ad {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 0.9rem 1.1rem;
      padding: 1.5rem 1.15rem 1.15rem;
      border: var(--stroke) dashed var(--ink-400);
      border-radius: var(--r-lg);
      background:
        repeating-linear-gradient(-45deg, transparent 0 10px, rgb(240 226 197 / 0.35) 10px 20px),
        var(--sand-0);
    }
    @media (min-width: 48rem) {
      .ad {
        grid-template-columns: auto 1fr auto;
        padding: 1.35rem 1.5rem;
      }
    }
    .tag {
      position: absolute;
      top: -0.6rem;
      left: 1rem;
      padding: 0.05rem 0.6rem;
      border-radius: var(--r-pill);
      background: var(--ink-900);
      color: var(--sand-50);
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .ad__image,
    .ad__mark {
      width: 4rem;
      height: 4rem;
      border-radius: var(--r-md);
      border: var(--stroke) solid var(--ink-900);
      object-fit: cover;
    }
    .ad__mark {
      display: grid;
      place-items: center;
      background: var(--marigold-300);
  color: var(--on-accent);
    }
    .ad__text {
      min-width: 0;
    }
    .ad__by {
      font-size: var(--fs-xs);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--color-text-subtle);
    }
    h3 {
      font-size: 1.1rem;
      margin-block: 0.1rem 0.15rem;
    }
    .ad__text p:last-child {
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .ad .btn {
      grid-column: 1 / -1;
    }
    @media (min-width: 48rem) {
      .ad .btn {
        grid-column: auto;
      }
    }
    .adsense {
      position: relative;
      padding-top: 0.9rem;
      min-height: 6rem;
    }
  `,
})
export class AdSlot {
  readonly placement = input.required<AdPlacement>();
  readonly regionSlug = input<string | undefined>(undefined);

  private readonly ads = inject(AdsApi);
  private readonly analytics = inject(AnalyticsService);
  private readonly config = inject(AppConfigService);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly settings = this.config.analytics;
  protected readonly ad = signal<AdCreative | null>(null);
  private readonly localLoaded = signal(false);
  private adsenseRequested = false;

  protected readonly adsenseSlot = computed(() => this.settings().adsenseSlots[this.placement()] ?? '');

  /** Only once we know there is no local campaign for this position. */
  protected readonly showAdsense = computed(
    () => this.localLoaded() && !this.ad() && !!this.adsenseSlot() && this.analytics.adsenseActive(),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      if (!this.config.isEnabled(FeatureFlag.LocalAds)) {
        this.localLoaded.set(true);
        return;
      }
      const sub = this.ads.list(this.placement(), this.regionSlug()).subscribe({
        next: (creatives) => {
          // Spread impressions across campaigns competing for this position.
          const pick = creatives.length ? creatives[Math.floor(Math.random() * creatives.length)]! : null;
          this.ad.set(pick);
          this.localLoaded.set(true);
          if (pick) this.reportWhenSeen(pick, destroyRef);
        },
        // Advertising is never allowed to break a page.
        error: () => this.localLoaded.set(true),
      });
      destroyRef.onDestroy(() => sub.unsubscribe());
    });

    effect(() => {
      if (this.showAdsense() && !this.adsenseRequested) {
        this.adsenseRequested = true;
        // The <ins> element has to be in the DOM before AdSense is asked to fill it.
        queueMicrotask(() => this.analytics.requestAdsenseFill());
      }
    });
  }

  protected onClick(ad: AdCreative): void {
    this.ads.click(ad.id).subscribe({ error: () => undefined });
    this.analytics.track('ad_click', { placement: ad.placement, campaign_id: ad.id });
  }

  /** An impression counts only when the advertisement was actually on screen. */
  private reportWhenSeen(ad: AdCreative, destroyRef: DestroyRef): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
          observer.disconnect();
          this.ads.impression(ad.id).subscribe({ error: () => undefined });
          this.analytics.track('ad_impression', { placement: ad.placement, campaign_id: ad.id });
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(this.el);
    destroyRef.onDestroy(() => observer.disconnect());
  }
}
