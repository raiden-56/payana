import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { ConsentStore } from '@core/analytics/consent.store';
import { MeApi } from '@core/api/customer.api';
import { AuthStore } from '@core/auth/auth.store';
import { BRAND } from '@core/brand';
import { Modal } from './primitives';

/**
 * Privacy choice.
 *
 * The banner appears only when a Google integration is actually configured
 * and the visitor has not decided yet - if nothing would be loaded, there is
 * nothing to ask. "Only essential" is as easy to reach as "Accept all".
 * The same preferences dialog is reachable any time from the footer.
 */
@Component({
  selector: 'app-consent-banner',
  imports: [RouterLink, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showBanner()) {
      <section class="banner" role="region" aria-label="Privacy choices">
        <div class="banner__text">
          <h2>Your privacy, your call</h2>
          <p>
            {{ brand }} works without any tracking. With your OK we also use Google Analytics to see which
            pages help people, and Google Ads to measure our advertising.
            <a class="link" routerLink="/legal/privacy">Privacy notice</a>
          </p>
        </div>
        <div class="banner__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="consent.preferencesOpen.set(true)">Choose</button>
          <button type="button" class="btn btn--outline btn--sm" (click)="decide(false, false)">Only essential</button>
          <button type="button" class="btn btn--dark btn--sm" (click)="decide(true, true)">Accept all</button>
        </div>
      </section>
    }

    <app-modal title="Privacy choices" [open]="consent.preferencesOpen()" (closed)="consent.preferencesOpen.set(false)">
      <div class="prefs">
        <div class="pref">
          <div>
            <h3>Essential</h3>
            <p>Signing in, keeping you signed in, and remembering this choice. Always on.</p>
          </div>
          <span class="badge badge--success">Always on</span>
        </div>
        <label class="pref">
          <div>
            <h3>Analytics</h3>
            <p>Google Analytics, to count visits and see which pages are useful. No names or phone numbers are sent.</p>
          </div>
          <span class="switch">
            <input type="checkbox" role="switch" [checked]="draftAnalytics()" (change)="draftAnalytics.set($any($event.target).checked)" />
            <span></span>
          </span>
        </label>
        <label class="pref">
          <div>
            <h3>Advertising</h3>
            <p>Google Ads and AdSense, to measure our adverts and show relevant ones.</p>
          </div>
          <span class="switch">
            <input type="checkbox" role="switch" [checked]="draftAdvertising()" (change)="draftAdvertising.set($any($event.target).checked)" />
            <span></span>
          </span>
        </label>
        @if (!analytics.anyConfigured()) {
          <p class="subtle">Neither is switched on for this site at the moment, so nothing is collected whatever you choose.</p>
        }
      </div>
      <ng-container modalActions>
        <button type="button" class="btn btn--ghost" (click)="decide(false, false)">Only essential</button>
        <button type="button" class="btn btn--dark" (click)="decide(draftAnalytics(), draftAdvertising())">Save choices</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .banner {
      position: fixed;
      z-index: var(--z-drawer);
      left: 50%;
      bottom: max(0.75rem, env(safe-area-inset-bottom));
      transform: translateX(-50%);
      width: min(58rem, calc(100vw - 1.5rem));
      display: grid;
      gap: 0.9rem 1.5rem;
      align-items: center;
      padding: 1.1rem 1.25rem;
      background: var(--sand-0);
      border: var(--stroke) solid var(--ink-900);
      border-radius: var(--r-lg);
      box-shadow: var(--shadow-hard), var(--shadow-lg);
      animation: banner-in var(--dur-4) var(--ease-out) 600ms both;
    }
    @media (min-width: 52rem) {
      .banner {
        grid-template-columns: 1fr auto;
      }
    }
    .banner h2 {
      font-size: 1.1rem;
      margin-bottom: 0.2rem;
    }
    .banner p {
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .banner__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: flex-end;
    }
    .prefs {
      display: grid;
      gap: 0.25rem;
    }
    .pref {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.25rem;
      padding: 0.9rem 0;
      border-bottom: 1px solid var(--sand-200);
      cursor: default;
    }
    label.pref {
      cursor: pointer;
    }
    .pref h3 {
      font-size: 1.02rem;
      margin-bottom: 0.15rem;
    }
    .pref p {
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .prefs .subtle {
      padding-top: 0.75rem;
    }
    @keyframes banner-in {
      from {
        opacity: 0;
        transform: translate(-50%, 24px);
      }
    }
  `,
})
export class ConsentBanner {
  protected readonly consent = inject(ConsentStore);
  protected readonly analytics = inject(AnalyticsService);
  private readonly auth = inject(AuthStore);
  private readonly meApi = inject(MeApi);

  protected readonly brand = BRAND.name;
  protected readonly draftAnalytics = signal(false);
  protected readonly draftAdvertising = signal(false);

  protected readonly showBanner = computed(
    () => this.analytics.anyConfigured() && !this.consent.decided() && !this.consent.preferencesOpen(),
  );

  constructor() {
    // Opening the dialog starts from the current choice.
    effect(() => {
      if (this.consent.preferencesOpen()) {
        this.draftAnalytics.set(this.consent.analytics());
        this.draftAdvertising.set(this.consent.advertising());
      }
    });
  }

  protected decide(analytics: boolean, advertising: boolean): void {
    this.consent.save({ analytics, advertising });

    // Signed-in accounts keep a server-side record of the choice as well.
    if (this.auth.isAuthenticated()) {
      this.meApi.consents().subscribe({
        next: (current) =>
          this.meApi
            .saveConsents({ analytics, advertising, marketingMessages: current.marketingMessages })
            .subscribe({ error: () => undefined }),
        error: () => undefined,
      });
    }
  }
}
