import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { PlaceKind, type Place, type PlaceSuggestion } from '@payana/contracts';
import { CatalogApi } from '@core/api/public.api';
import { GEOLOCATION, GeolocationError } from '@core/platform/platform';
import { Icon, type IconName } from './icon';

const KIND_ICON: Record<PlaceKind, IconName> = {
  [PlaceKind.Transport]: 'route',
  [PlaceKind.Beach]: 'sun',
  [PlaceKind.Temple]: 'home',
  [PlaceKind.Town]: 'map',
  [PlaceKind.Landmark]: 'flag',
};

const GEO_MESSAGES: Record<string, string> = {
  denied: 'Location access is blocked. Allow it in your browser settings, or pick a place from the list.',
  unavailable: 'We could not get your position. Pick a place from the list instead.',
  timeout: 'Finding your position took too long. Try again, or pick a place from the list.',
  unsupported: 'This device cannot share its location. Pick a place from the list instead.',
};

let nextId = 0;

/**
 * Pickup / drop chooser. People choose from well-known places curated per
 * region (bus stands, stations, beaches, temples) or share their current
 * position. Typing filters the list.
 *
 * It is an ARIA combobox: arrow keys move through options, Enter selects,
 * Escape closes. The chosen place is a two-way `value` model.
 */
@Component({
  selector: 'app-location-picker',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)' },
  template: `
    <div class="field">
      <label class="field__label" [for]="inputId">{{ label() }}</label>
      <div class="control" [class.control--open]="open()">
        <app-icon class="lead" [name]="leadIcon()" [size]="18" />
        <input
          class="input"
          [id]="inputId"
          type="text"
          role="combobox"
          autocomplete="off"
          autocapitalize="words"
          spellcheck="false"
          [placeholder]="placeholder()"
          [value]="text()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="listId"
          [attr.aria-activedescendant]="activeOptionId()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-describedby]="hintId"
          aria-autocomplete="list"
          (focus)="openList()"
          (input)="onInput($event)"
          (keydown)="onKeydown($event)"
        />
        @if (value()) {
          <button type="button" class="clear" (click)="clear()" aria-label="Clear {{ label() }}">
            <app-icon name="close" [size]="16" />
          </button>
        }
        @if (open()) {
          <ul class="list" role="listbox" [id]="listId" [attr.aria-label]="label() + ' suggestions'">
            @if (allowCurrentLocation()) {
              <!-- Combobox option: keyboard selection is handled on the input (arrow keys + Enter, aria-activedescendant). -->
              <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
              <li
                class="option option--geo"
                role="option"
                [id]="optionId(0)"
                [attr.aria-selected]="activeIndex() === 0"
                [class.is-active]="activeIndex() === 0"
                (pointerdown)="$event.preventDefault()"
                (click)="useCurrentLocation()"
              >
                <span class="option__icon option__icon--geo"><app-icon name="locate" [size]="17" /></span>
                <span class="option__text">
                  <strong>{{ locating() ? 'Finding you…' : 'Use my current location' }}</strong>
                  <small>Shared only to find drivers near you</small>
                </span>
              </li>
            }
            @if (loading()) {
              <li class="empty" role="presentation">Loading places…</li>
            } @else if (loadFailed()) {
              <li class="empty" role="presentation">
                Places could not be loaded.
                <button type="button" class="link" (pointerdown)="$event.preventDefault()" (click)="loadPlaces()">Try again</button>
              </li>
            } @else {
              @for (place of filtered(); track place.id; let i = $index) {
                <!-- Combobox option: keyboard selection is handled on the input (arrow keys + Enter, aria-activedescendant). -->
                <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
                <li
                  class="option"
                  role="option"
                  [id]="optionId(i + offset())"
                  [attr.aria-selected]="activeIndex() === i + offset()"
                  [class.is-active]="activeIndex() === i + offset()"
                  (pointerdown)="$event.preventDefault()"
                  (click)="choose(place)"
                >
                  <span class="option__icon"><app-icon [name]="iconFor(place.kind)" [size]="16" /></span>
                  <span class="option__text">
                    <strong>{{ place.label }}</strong>
                    @if (place.address) {
                      <small>{{ place.address }}</small>
                    }
                  </span>
                </li>
              } @empty {
                <li class="empty" role="presentation">No place matches “{{ text() }}”. Try a nearby landmark.</li>
              }
            }
          </ul>
        }
      </div>


      <p class="field__hint" [id]="hintId" [class.field__error]="!!problem()">
        {{ problem() || hint() }}
      </p>
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      min-width: 0;
    }
    .control {
      position: relative;
      display: flex;
      align-items: center;
    }
    .lead {
      position: absolute;
      left: 0.8rem;
      color: var(--ink-500);
      pointer-events: none;
    }
    .input {
      padding-left: 2.5rem;
      padding-right: 2.5rem;
      text-overflow: ellipsis;
    }
    .control--open .input {
      border-color: var(--ink-900);
    }
    .clear {
      position: absolute;
      right: 0.45rem;
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      color: var(--ink-500);
    }
    .clear:hover {
      background: var(--sand-200);
      color: var(--ink-900);
    }
    .list {
      position: absolute;
      z-index: 30;
      left: 0;
      right: 0;
      top: calc(100% + 0.3rem);
      max-height: 18.5rem;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.35rem;
      background: var(--sand-0);
      border: var(--stroke) solid var(--ink-900);
      border-radius: var(--r-md);
      box-shadow: var(--shadow-lg);
      animation: rise-in var(--dur-2) var(--ease-out);
    }
    .option {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      padding: 0.55rem 0.6rem;
      border-radius: var(--r-sm);
      cursor: pointer;
    }
    .option:hover,
    .option.is-active {
      background: var(--marigold-50);
    }
    .option.is-active {
      box-shadow: inset 0 0 0 1.5px var(--ink-900);
    }
    .option__icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 2.1rem;
      height: 2.1rem;
      border-radius: 50%;
      background: var(--sand-200);
      color: var(--ink-700);
    }
    .option__icon--geo {
      background: var(--palm-100);
      color: var(--palm-700);
    }
    .option__text {
      display: grid;
      min-width: 0;
      line-height: 1.25;
    }
    .option__text strong {
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .option__text small {
      font-size: var(--fs-xs);
      color: var(--color-text-subtle);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .option--geo {
      border-bottom: 1px dashed var(--color-border);
      border-radius: var(--r-sm) var(--r-sm) 0 0;
      margin-bottom: 0.25rem;
    }
    .empty {
      padding: 0.9rem 0.7rem;
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .field__hint {
      min-height: 1.15rem;
    }
  `,
})
export class LocationPicker {
  readonly label = input.required<string>();
  readonly placeholder = input('Search a place');
  readonly hint = input('');
  readonly regionSlug = input<string | undefined>(undefined);
  readonly allowCurrentLocation = input(true);
  /** Shows the field as invalid (the parent decides when, e.g. after a submit attempt). */
  readonly invalid = input(false);
  readonly errorText = input('');

  /** The chosen place. Two-way: `[(value)]`. */
  readonly value = model<Place | null>(null);

  private readonly catalog = inject(CatalogApi);
  private readonly geolocation = inject(GEOLOCATION);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly uid = nextId++;
  protected readonly inputId = `loc-${this.uid}`;
  protected readonly listId = `loc-${this.uid}-list`;
  protected readonly hintId = `loc-${this.uid}-hint`;

  protected readonly open = signal(false);
  protected readonly query = signal<string | null>(null);
  protected readonly places = signal<PlaceSuggestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly locating = signal(false);
  protected readonly geoProblem = signal('');
  protected readonly activeIndex = signal(-1);
  private loaded = false;

  /** While typing, show what was typed; otherwise the chosen place. */
  protected readonly text = computed(() => this.query() ?? this.value()?.label ?? '');
  protected readonly offset = computed(() => (this.allowCurrentLocation() ? 1 : 0));

  protected readonly filtered = computed(() => {
    const q = (this.query() ?? '').trim().toLowerCase();
    const all = this.places();
    if (!q) return all;
    return all.filter(
      (p) => p.label.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q),
    );
  });

  protected readonly optionCount = computed(() => this.filtered().length + this.offset());
  protected readonly activeOptionId = computed(() =>
    this.open() && this.activeIndex() >= 0 ? this.optionId(this.activeIndex()) : null,
  );
  protected readonly leadIcon = computed<IconName>(() => (this.value() ? 'pin' : 'search'));
  protected readonly problem = computed(
    () => this.geoProblem() || (this.invalid() ? this.errorText() || 'Choose a place from the list.' : ''),
  );

  protected optionId(index: number): string {
    return `loc-${this.uid}-opt-${index}`;
  }

  protected iconFor(kind: PlaceKind): IconName {
    return KIND_ICON[kind] ?? 'pin';
  }

  protected openList(): void {
    this.open.set(true);
    if (!this.loaded) this.loadPlaces();
  }

  protected loadPlaces(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.catalog.places({ regionSlug: this.regionSlug(), limit: 100 }).subscribe({
      next: (places) => {
        this.places.set(places);
        this.loaded = true;
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadFailed.set(true);
      },
    });
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.geoProblem.set('');
    this.activeIndex.set(-1);
    this.open.set(true);
    // Editing the text means the earlier choice no longer stands.
    if (this.value()) this.value.set(null);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.optionCount();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) this.openList();
        this.activeIndex.set(count ? (this.activeIndex() + 1) % count : -1);
        this.scrollActiveIntoView();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.set(count ? (this.activeIndex() - 1 + count) % count : -1);
        this.scrollActiveIntoView();
        break;
      case 'Enter': {
        if (!this.open() || this.activeIndex() < 0) return;
        event.preventDefault();
        const index = this.activeIndex();
        if (this.allowCurrentLocation() && index === 0) this.useCurrentLocation();
        else {
          const place = this.filtered()[index - this.offset()];
          if (place) this.choose(place);
        }
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.close();
        }
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  protected choose(place: PlaceSuggestion): void {
    this.value.set({
      label: place.label,
      address: place.address ?? undefined,
      location: place.location,
      regionSlug: place.regionSlug,
    });
    this.close();
  }

  protected useCurrentLocation(): void {
    if (this.locating()) return;
    this.locating.set(true);
    this.geoProblem.set('');
    this.geolocation
      .current({ highAccuracy: true, timeoutMs: 12_000 })
      .then((fix) => {
        this.value.set({ label: 'My current location', location: fix.location });
        this.close();
      })
      .catch((error: unknown) => {
        const reason = error instanceof GeolocationError ? error.reason : 'unavailable';
        this.geoProblem.set(GEO_MESSAGES[reason] ?? GEO_MESSAGES['unavailable']!);
      })
      .finally(() => this.locating.set(false));
  }

  protected clear(): void {
    this.value.set(null);
    this.query.set('');
    this.geoProblem.set('');
    this.host.querySelector('input')?.focus();
  }

  protected onOutside(event: Event): void {
    if (this.open() && !this.host.contains(event.target as Node)) this.close();
  }

  private close(): void {
    this.open.set(false);
    this.query.set(null);
    this.activeIndex.set(-1);
  }

  private scrollActiveIntoView(): void {
    queueMicrotask(() =>
      this.host.querySelector(`#${CSS.escape(this.optionId(this.activeIndex()))}`)?.scrollIntoView({ block: 'nearest' }),
    );
  }
}
