import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, isDevMode } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
  ADSENSE_PUBLISHER_ID_PATTERN,
  GA4_MEASUREMENT_ID_PATTERN,
  GOOGLE_ADS_ID_PATTERN,
  type AnalyticsSettings,
  type ConversionEvent,
} from '@payana/contracts';
import { AppConfigService } from '../config/app-config.service';
import { ConsentStore } from './consent.store';

/**
 * Google Analytics 4, Google Ads conversion tracking and AdSense, behind one
 * service.
 *
 * How it behaves:
 *  - An integration with no ID configured is OFF: no script is requested and
 *    nothing is queued or sent.
 *  - With an ID configured, the Google tag is still not loaded until the
 *    visitor grants the matching consent (unless `requireConsent` was
 *    explicitly switched off). Consent Mode v2 signals are set before the tag
 *    loads and updated whenever the visitor changes their mind.
 *  - Page views are sent on every route change using the route *template*
 *    ("/bookings/:id"), never the real URL, so IDs do not leak into reports.
 *  - Events carry no personal data. `track()` drops any parameter whose key
 *    looks like a name, phone number or e-mail.
 *
 * To switch it on, the owner pastes their IDs in Admin -> Settings ->
 * Analytics & Ads (or public/app-config.json). No code change is needed.
 */

export type IntegrationState = 'not_configured' | 'invalid_id' | 'waiting_for_consent' | 'active';

export interface AnalyticsStatus {
  ga4: IntegrationState;
  googleAds: IntegrationState;
  adsense: IntegrationState;
}

/** The custom and recommended GA4 events this app sends. */
export type AnalyticsEventName =
  | 'search'
  | 'view_driver'
  | 'view_package'
  | 'begin_ride_request'
  | 'ride_requested'
  | 'quote_accepted'
  | 'booking_cancelled'
  | 'review_submitted'
  | 'login'
  | 'sign_up'
  | 'driver_onboarding_step'
  | 'subscription_checkout'
  | 'ad_impression'
  | 'ad_click'
  | 'contact_support'
  | 'install_prompt';

export type EventParams = Record<string, string | number | boolean | null | undefined>;

type GtagFn = (...args: unknown[]) => void;

interface AnalyticsWindow {
  dataLayer?: unknown[];
  gtag?: GtagFn;
  adsbygoogle?: unknown[];
  [key: `ga-disable-${string}`]: boolean | undefined;
}

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=';
const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=';
const PII_KEY = /(phone|mobile|email|e_mail|name|address|otp|token)/i;

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly config = inject(AppConfigService);
  private readonly consent = inject(ConsentStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  private started = false;
  private gtagBootstrapped = false;
  private gtagScriptRequested = false;
  private adsenseScriptRequested = false;
  private readonly configuredIds = new Set<string>();
  private currentPage: { path: string; title: string } | null = null;
  private lastSentPage: string | null = null;

  /** What each integration is doing right now - shown in Admin -> Settings. */
  readonly status = computed<AnalyticsStatus>(() => {
    const s = this.config.analytics();
    const needConsent = s.requireConsent;
    return {
      ga4: stateOf(s.ga4MeasurementId, GA4_MEASUREMENT_ID_PATTERN, !needConsent || this.consent.analytics()),
      googleAds: stateOf(s.googleAdsId, GOOGLE_ADS_ID_PATTERN, !needConsent || this.consent.advertising()),
      adsense: stateOf(
        s.adsensePublisherId,
        ADSENSE_PUBLISHER_ID_PATTERN,
        !needConsent || this.consent.advertising(),
      ),
    };
  });

  /** True when at least one Google integration has an ID, i.e. a consent choice is needed. */
  readonly anyConfigured = computed(() => {
    const st = this.status();
    return [st.ga4, st.googleAds, st.adsense].some((x) => x === 'waiting_for_consent' || x === 'active');
  });

  constructor() {
    // Re-evaluates whenever settings or the visitor's consent change.
    effect(() => {
      const settings = this.config.analytics();
      const status = this.status();
      const choice = { analytics: this.consent.analytics(), advertising: this.consent.advertising() };
      if (this.started) this.sync(settings, status, choice);
    });
  }

  /** Called once at start-up, after configuration has loaded. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.currentPage = {
        path: routeTemplate(this.router.routerState.snapshot.root),
        title: this.document.title,
      };
      this.sendPageView();
    });

    this.sync(this.config.analytics(), this.status(), {
      analytics: this.consent.analytics(),
      advertising: this.consent.advertising(),
    });
  }

  /** Send a GA4 event. Silently does nothing while analytics is off. */
  track(name: AnalyticsEventName, params: EventParams = {}): void {
    const clean = stripPersonalData(params);
    if (this.status().ga4 !== 'active') {
      this.debug('event (not sent - analytics off)', name, clean);
      return;
    }
    this.gtag('event', name, clean);
    this.debug('event', name, clean);
  }

  /**
   * Report a business conversion. Goes to GA4 as an event of the same name
   * and, when a conversion label is configured for it, to Google Ads.
   */
  conversion(
    event: ConversionEvent,
    details: { valueMinor?: number; currency?: string; transactionId?: string } = {},
  ): void {
    const value = details.valueMinor === undefined ? undefined : details.valueMinor / 100;
    const status = this.status();

    if (status.ga4 === 'active') {
      this.gtag('event', event, { value, currency: details.currency });
    }

    const settings = this.config.analytics();
    const label = settings.googleAdsConversionLabels[event];
    if (status.googleAds === 'active' && label) {
      this.gtag('event', 'conversion', {
        send_to: `${settings.googleAdsId}/${label}`,
        value,
        currency: details.currency,
        transaction_id: details.transactionId,
      });
    }
    this.debug('conversion', event, { value, sentToAds: status.googleAds === 'active' && !!label });
  }

  /** Whether an AdSense unit may be rendered for this visitor right now. */
  adsenseActive(): boolean {
    return this.status().adsense === 'active';
  }

  /** Loads the AdSense library once and asks it to fill the newest <ins> slot. */
  requestAdsenseFill(): void {
    if (!this.adsenseActive()) return;
    const win = this.window();
    if (!win) return;
    if (!this.adsenseScriptRequested) {
      this.adsenseScriptRequested = true;
      const script = this.document.createElement('script');
      script.async = true;
      script.src = ADSENSE_SRC + encodeURIComponent(this.config.analytics().adsensePublisherId);
      script.crossOrigin = 'anonymous';
      this.document.head.appendChild(script);
    }
    try {
      (win.adsbygoogle = win.adsbygoogle ?? []).push({});
    } catch {
      // AdSense throws when a slot is already filled; nothing to do.
    }
  }

  // ---------------------------------------------------------------------------

  private sync(
    settings: AnalyticsSettings,
    status: AnalyticsStatus,
    choice: { analytics: boolean; advertising: boolean },
  ): void {
    const win = this.window();
    if (!win) return;

    const gaActive = status.ga4 === 'active';
    const adsActive = status.googleAds === 'active';

    // Google's documented kill-switch: honours a withdrawal even though a
    // script that has already loaded cannot be unloaded.
    if (settings.ga4MeasurementId && status.ga4 !== 'invalid_id') {
      win[`ga-disable-${settings.ga4MeasurementId}`] = !gaActive;
    }

    if (!gaActive && !adsActive) {
      if (this.gtagBootstrapped) this.gtag('consent', 'update', consentSignals(settings, choice));
      return;
    }

    if (!this.gtagBootstrapped) {
      this.gtagBootstrapped = true;
      win.dataLayer = win.dataLayer ?? [];
      // gtag.js only understands `arguments` objects in the data layer, not
      // arrays, so this has to be a classic function that forwards `arguments`.
      win.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        win.dataLayer!.push(arguments);
      };
      this.gtag('consent', 'default', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
      });
      this.gtag('consent', 'update', consentSignals(settings, choice));
      this.gtag('js', new Date());
    } else {
      this.gtag('consent', 'update', consentSignals(settings, choice));
    }

    if (gaActive && !this.configuredIds.has(settings.ga4MeasurementId)) {
      this.configuredIds.add(settings.ga4MeasurementId);
      this.gtag('config', settings.ga4MeasurementId, {
        // Page views are sent by hand on each route change (single-page app).
        send_page_view: false,
        ...(settings.debugMode ? { debug_mode: true } : {}),
      });
    }
    if (adsActive && !this.configuredIds.has(settings.googleAdsId)) {
      this.configuredIds.add(settings.googleAdsId);
      this.gtag('config', settings.googleAdsId);
    }

    if (!this.gtagScriptRequested) {
      this.gtagScriptRequested = true;
      const script = this.document.createElement('script');
      script.async = true;
      script.src = GTAG_SRC + encodeURIComponent(gaActive ? settings.ga4MeasurementId : settings.googleAdsId);
      this.document.head.appendChild(script);
    }

    // Covers the page the visitor was on when they accepted.
    this.sendPageView();
  }

  private sendPageView(): void {
    if (!this.currentPage || this.status().ga4 !== 'active') return;
    const key = this.currentPage.path;
    if (key === this.lastSentPage) return;
    this.lastSentPage = key;
    this.gtag('event', 'page_view', {
      page_path: this.currentPage.path,
      page_title: this.currentPage.title,
      page_location: this.document.location.origin + this.currentPage.path,
    });
    this.debug('page_view', this.currentPage.path);
  }

  private gtag(...args: unknown[]): void {
    this.window()?.gtag?.(...args);
  }

  private window(): AnalyticsWindow | null {
    return (this.document.defaultView as unknown as AnalyticsWindow | null) ?? null;
  }

  private debug(...args: unknown[]): void {
    if (isDevMode() || this.config.analytics().debugMode) {
      console.debug('[analytics]', ...args);
    }
  }
}

function stateOf(id: string, pattern: RegExp, consentOk: boolean): IntegrationState {
  if (!id) return 'not_configured';
  if (!pattern.test(id)) return 'invalid_id';
  return consentOk ? 'active' : 'waiting_for_consent';
}

function consentSignals(
  settings: AnalyticsSettings,
  choice: { analytics: boolean; advertising: boolean },
): Record<string, 'granted' | 'denied'> {
  const analytics = !settings.requireConsent || choice.analytics;
  const advertising = !settings.requireConsent || choice.advertising;
  return {
    analytics_storage: analytics ? 'granted' : 'denied',
    ad_storage: advertising ? 'granted' : 'denied',
    ad_user_data: advertising ? 'granted' : 'denied',
    ad_personalization: advertising ? 'granted' : 'denied',
  };
}

/** "/bookings/:id" rather than "/bookings/3f2a..." - stable, low-cardinality, no IDs. */
export function routeTemplate(root: ActivatedRouteSnapshot): string {
  const parts: string[] = [];
  let node: ActivatedRouteSnapshot | null = root;
  while (node) {
    const path = node.routeConfig?.path;
    if (path) parts.push(path);
    node = node.firstChild;
  }
  return '/' + parts.join('/');
}

export function stripPersonalData(params: EventParams): EventParams {
  const out: EventParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (PII_KEY.test(key)) continue;
    out[key] = value;
  }
  return out;
}
