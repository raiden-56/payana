import { Injectable, computed, inject, signal } from '@angular/core';
import { KEY_VALUE_STORAGE } from '../platform/platform';

export interface ConsentChoice {
  /** Usage measurement - Google Analytics. */
  analytics: boolean;
  /** Advertising measurement and personalisation - Google Ads / AdSense. */
  advertising: boolean;
}

interface StoredConsent extends ConsentChoice {
  v: 1;
  decidedAt: string;
}

const STORAGE_KEY = 'payana.consent.v1';

/**
 * The visitor's privacy choice. Nothing is granted until they decide, and
 * the choice is remembered on this device. Signed-in accounts also record it
 * on the server (see AccountPrivacy), which is the durable evidence of consent.
 */
@Injectable({ providedIn: 'root' })
export class ConsentStore {
  private readonly storage = inject(KEY_VALUE_STORAGE);
  private readonly stored = signal<StoredConsent | null>(this.read());

  /** True once the visitor has made any choice (including "reject all"). */
  readonly decided = computed(() => this.stored() !== null);
  readonly analytics = computed(() => this.stored()?.analytics ?? false);
  readonly advertising = computed(() => this.stored()?.advertising ?? false);
  readonly decidedAt = computed(() => this.stored()?.decidedAt ?? null);

  /** Whether the "Privacy choices" dialog is open. */
  readonly preferencesOpen = signal(false);

  acceptAll(): void {
    this.save({ analytics: true, advertising: true });
  }

  rejectAll(): void {
    this.save({ analytics: false, advertising: false });
  }

  save(choice: ConsentChoice): void {
    const next: StoredConsent = {
      v: 1,
      analytics: choice.analytics,
      advertising: choice.advertising,
      decidedAt: new Date().toISOString(),
    };
    this.storage.set(STORAGE_KEY, JSON.stringify(next));
    this.stored.set(next);
    this.preferencesOpen.set(false);
  }

  /** Adopt a choice recorded on the server when this device has none yet. */
  adoptIfUndecided(choice: ConsentChoice): void {
    if (!this.decided()) this.save(choice);
  }

  private read(): StoredConsent | null {
    const raw = this.storage.get(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredConsent>;
      if (parsed.v !== 1 || typeof parsed.analytics !== 'boolean' || typeof parsed.advertising !== 'boolean') {
        return null;
      }
      return {
        v: 1,
        analytics: parsed.analytics,
        advertising: parsed.advertising,
        decidedAt: typeof parsed.decidedAt === 'string' ? parsed.decidedAt : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
