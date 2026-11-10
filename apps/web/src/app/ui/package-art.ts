import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PackageArtwork } from '@payana/contracts';
import { packagePhoto, photoSrc } from '@core/media/photos';

/** The photograph for a sightseeing package, chosen by its artwork key. */
@Component({
  selector: 'app-package-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img [src]="src()" [srcset]="srcset()" sizes="(min-width: 64rem) 30vw, 90vw" alt="" loading="lazy" decoding="async" />`,
  styles: `
    :host {
      display: block;
      overflow: hidden;
      background: #27221b;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 1200ms var(--ease-out);
    }
    :host-context(a:hover) img {
      transform: scale(1.06);
    }
  `,
})
export class PackageArt {
  readonly artwork = input.required<PackageArtwork | string>();
  private readonly key = computed(() => packagePhoto(this.artwork()));
  protected readonly src = computed(() => photoSrc(this.key(), 800));
  protected readonly srcset = computed(() => `${photoSrc(this.key(), 800)} 800w, ${photoSrc(this.key(), 1600)} 1600w`);
}
