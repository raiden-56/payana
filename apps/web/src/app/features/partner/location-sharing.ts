import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { AvailabilityStatus } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import {
  GEOLOCATION,
  KEY_VALUE_STORAGE,
  NETWORK_STATUS,
  type GeoFix,
  type GeolocationError,
} from '@core/platform/platform';
import { PingThrottle } from './partner-logic';
import { PartnerStore } from './partner.store';

/** At most one position goes to the server in this many milliseconds. */
export const PING_INTERVAL_MS = 20_000;

const PREFERENCE_KEY = 'payana.partner.shareLocation';

const GEO_PROBLEMS: Record<GeolocationError['reason'], string> = {
  denied: 'Location access is blocked for this site. Allow it in your browser settings to appear in “near me” searches.',
  unavailable: 'Your phone could not work out where it is. Check that location (GPS) is switched on.',
  timeout: 'Getting a position is taking too long. It will keep trying.',
  unsupported: 'This device cannot share its location.',
};

export type SharingState = 'off' | 'waiting' | 'sharing' | 'paused' | 'blocked';

/**
 * Shares the driver's position while they are marked available.
 *
 * What it can and cannot do, stated plainly because the product promises to:
 * this is a web app, so the browser only reports positions while the app is
 * open and on screen. Lock the phone or switch apps and updates stop; the
 * last position then ages and customers are shown it as "not current". Only a
 * native app can track in the background.
 *
 * Provided by PartnerLayout: sharing continues across partner screens and
 * stops when the partner area is left.
 */
@Injectable()
export class LocationSharing {
  private readonly geolocation = inject(GEOLOCATION);
  private readonly api = inject(PartnerApi);
  private readonly network = inject(NETWORK_STATUS);
  private readonly storage = inject(KEY_VALUE_STORAGE);
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(PartnerStore);

  private readonly throttle = new PingThrottle(PING_INTERVAL_MS);
  private stopWatching: (() => void) | null = null;

  /** The driver's own choice; on by default, remembered on this device. */
  readonly enabled = signal(this.storage.get(PREFERENCE_KEY) !== '0');
  readonly lastSentAt = signal<string | null>(null);
  readonly accuracyMeters = signal<number | null>(null);
  readonly problem = signal('');
  private readonly watching = signal(false);
  private readonly blocked = signal(false);

  private readonly shouldShare = computed(
    () => this.enabled() && this.store.profile.data()?.availability === AvailabilityStatus.Available,
  );

  readonly state = computed<SharingState>(() => {
    if (!this.shouldShare()) return 'off';
    if (this.blocked()) return 'blocked';
    if (!this.network.online()) return 'paused';
    if (!this.watching() || !this.lastSentAt()) return 'waiting';
    return 'sharing';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      if (this.shouldShare()) this.start();
      else this.stop();
    });

    // Coming back to the app: send a fresh position straight away.
    const onVisible = () => {
      if (this.document.visibilityState === 'visible') this.throttle.reset();
    };
    this.document.addEventListener('visibilitychange', onVisible);

    destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisible);
      this.stop();
    });
  }

  setEnabled(enabled: boolean): void {
    this.storage.set(PREFERENCE_KEY, enabled ? '1' : '0');
    this.enabled.set(enabled);
  }

  /** Ask again after the driver has fixed a permission or GPS problem. */
  retry(): void {
    this.stop();
    if (this.shouldShare()) this.start();
  }

  private start(): void {
    if (this.stopWatching) return;
    this.blocked.set(false);
    this.problem.set('');
    this.throttle.reset();
    this.watching.set(true);
    this.stopWatching = this.geolocation.watch(
      (fix) => this.onFix(fix),
      (error) => this.onGeoError(error),
    );
  }

  private stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.watching.set(false);
  }

  private onFix(fix: GeoFix): void {
    this.blocked.set(false);
    this.accuracyMeters.set(Math.round(fix.accuracyMeters));
    if (!this.network.online()) return;
    if (!this.throttle.tryAcquire(Date.now())) return;

    this.api
      .sendLocation({
        location: fix.location,
        accuracyMeters: Math.round(fix.accuracyMeters),
        recordedAt: fix.recordedAt.toISOString(),
      })
      .subscribe({
        next: () => {
          this.lastSentAt.set(new Date().toISOString());
          this.problem.set('');
        },
        error: (error: unknown) => {
          const apiError = toApiError(error);
          // A dropped connection is not worth a message: let the next fix try again at once.
          if (apiError.isTransport) this.throttle.reset();
          else this.problem.set(apiError.fieldErrors[0]?.message ?? apiError.message);
        },
      });
  }

  private onGeoError(error: GeolocationError): void {
    this.problem.set(GEO_PROBLEMS[error.reason]);
    // "denied" and "unsupported" will not fix themselves; a timeout might.
    if (error.reason === 'denied' || error.reason === 'unsupported') {
      this.blocked.set(true);
      this.stop();
    }
  }
}
