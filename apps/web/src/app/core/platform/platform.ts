import { InjectionToken, Signal, signal } from '@angular/core';
import type { LatLng } from '@payana/contracts';

/**
 * Platform ports.
 *
 * Shared application code never touches `window`, `navigator`, `localStorage`
 * or a native plugin directly - it asks for one of these interfaces. The
 * browser adapters below are what the PWA uses. A Capacitor build provides
 * native adapters for the same tokens (secure storage, native geolocation,
 * push) without any change to features or stores.
 */

// --- key/value storage ---------------------------------------------------------

export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** localStorage with an in-memory fallback (private mode, blocked storage, tests). */
export class BrowserStorage implements KeyValueStorage {
  private readonly memory = new Map<string, string>();

  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? this.memory.get(key) ?? null;
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Quota or access denied: the in-memory copy still serves this session.
    }
  }

  remove(key: string): void {
    this.memory.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Nothing to clean up.
    }
  }
}

export const KEY_VALUE_STORAGE = new InjectionToken<KeyValueStorage>('KEY_VALUE_STORAGE', {
  providedIn: 'root',
  factory: () => new BrowserStorage(),
});

// --- geolocation ----------------------------------------------------------------

export type GeolocationFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export class GeolocationError extends Error {
  constructor(readonly reason: GeolocationFailure) {
    super(`Geolocation failed: ${reason}`);
  }
}

export interface GeoFix {
  location: LatLng;
  accuracyMeters: number;
  recordedAt: Date;
}

export interface GeolocationPort {
  /** One position fix. Rejects with GeolocationError. */
  current(options?: { highAccuracy?: boolean; timeoutMs?: number }): Promise<GeoFix>;
  /**
   * Continuous fixes while the page is open. Returns a function that stops
   * watching. NOTE: a browser/PWA stops reporting when the tab is in the
   * background or the screen is off - only a native build can track in the
   * background, and the UI must not promise otherwise.
   */
  watch(onFix: (fix: GeoFix) => void, onError: (error: GeolocationError) => void): () => void;
}

export class BrowserGeolocation implements GeolocationPort {
  current(options?: { highAccuracy?: boolean; timeoutMs?: number }): Promise<GeoFix> {
    return new Promise((resolve, reject) => {
      const geo = globalThis.navigator?.geolocation;
      if (!geo) {
        reject(new GeolocationError('unsupported'));
        return;
      }
      geo.getCurrentPosition(
        (pos) => resolve(toFix(pos)),
        (err) => reject(toError(err)),
        {
          enableHighAccuracy: options?.highAccuracy ?? false,
          timeout: options?.timeoutMs ?? 10_000,
          maximumAge: 30_000,
        },
      );
    });
  }

  watch(onFix: (fix: GeoFix) => void, onError: (error: GeolocationError) => void): () => void {
    const geo = globalThis.navigator?.geolocation;
    if (!geo) {
      onError(new GeolocationError('unsupported'));
      return () => undefined;
    }
    const id = geo.watchPosition(
      (pos) => onFix(toFix(pos)),
      (err) => onError(toError(err)),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => geo.clearWatch(id);
  }
}

function toFix(pos: GeolocationPosition): GeoFix {
  return {
    location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
    accuracyMeters: pos.coords.accuracy,
    recordedAt: new Date(pos.timestamp),
  };
}

function toError(err: GeolocationPositionError): GeolocationError {
  if (err.code === err.PERMISSION_DENIED) return new GeolocationError('denied');
  if (err.code === err.TIMEOUT) return new GeolocationError('timeout');
  return new GeolocationError('unavailable');
}

export const GEOLOCATION = new InjectionToken<GeolocationPort>('GEOLOCATION', {
  providedIn: 'root',
  factory: () => new BrowserGeolocation(),
});

// --- connectivity ----------------------------------------------------------------

export interface NetworkStatus {
  readonly online: Signal<boolean>;
}

export class BrowserNetworkStatus implements NetworkStatus {
  private readonly state = signal(globalThis.navigator?.onLine ?? true);
  readonly online = this.state.asReadonly();

  constructor() {
    globalThis.addEventListener?.('online', () => this.state.set(true));
    globalThis.addEventListener?.('offline', () => this.state.set(false));
  }
}

export const NETWORK_STATUS = new InjectionToken<NetworkStatus>('NETWORK_STATUS', {
  providedIn: 'root',
  factory: () => new BrowserNetworkStatus(),
});

// --- environment facts --------------------------------------------------------------

/** True when the visitor asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** A short label for the session list, e.g. "Chrome on Android". No fingerprinting. */
export function describeDevice(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'device';
  return `${browser} on ${os}`;
}

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
