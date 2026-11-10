import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { PHOTOS, photoSrc, type PhotoKey } from '@core/media/photos';

/**
 * A responsive, lazily loaded photograph from the curated set.
 * Fades in once decoded; until then the frame shows a warm placeholder.
 *
 *   <app-photo key="kudle-beach" sizes="(min-width: 64rem) 33vw, 100vw" />
 *
 * `priority` loads it eagerly (for the hero, so it counts towards LCP).
 */
@Component({
  selector: 'app-photo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'photo-frame', '[class.is-loaded]': 'loaded()' },
  template: `
    <img
      [src]="src()"
      [srcset]="srcset()"
      [sizes]="sizes()"
      [alt]="decorative() ? '' : photo().alt"
      [attr.width]="photo().width"
      [attr.height]="photo().height"
      [attr.loading]="priority() ? 'eager' : 'lazy'"
      [attr.fetchpriority]="priority() ? 'high' : null"
      decoding="async"
      (load)="loaded.set(true)"
    />
  `,
  styles: `
    :host {
      display: block;
    }
    img {
      opacity: 0;
      transition:
        opacity 700ms var(--ease-out),
        transform 1200ms var(--ease-out);
    }
    :host(.is-loaded) img {
      opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
      img {
        opacity: 1;
      }
    }
  `,
})
export class Photo {
  readonly key = input.required<PhotoKey>();
  readonly sizes = input('100vw');
  readonly priority = input(false);
  /** Hide from assistive tech when the photo only decorates nearby text. */
  readonly decorative = input(false);

  protected readonly loaded = signal(false);
  protected readonly photo = computed(() => PHOTOS[this.key()]);
  protected readonly src = computed(() => photoSrc(this.key(), 1600));
  protected readonly srcset = computed(() => `${photoSrc(this.key(), 800)} 800w, ${photoSrc(this.key(), 1600)} 1600w`);
}
