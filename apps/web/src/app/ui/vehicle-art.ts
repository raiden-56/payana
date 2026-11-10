import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { VehicleIcon } from '@payana/contracts';
import { PHOTOS, VEHICLE_PHOTO, photoSrc } from '@core/media/photos';

/**
 * A photograph of the kind of vehicle, one per VehicleIcon.
 * (The name is kept from the earlier illustrated version so every screen that
 * shows a vehicle switched to photos without changes.)
 * Decorative: the category name is always printed next to it.
 */
@Component({
  selector: 'app-vehicle-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-moving]': 'moving()' },
  template: `<img [src]="src()" [srcset]="srcset()" sizes="(min-width: 64rem) 20vw, 50vw" alt="" loading="lazy" decoding="async" [attr.width]="w()" [attr.height]="h()" />`,
  styles: `
    :host {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      border-radius: var(--vehicle-radius, var(--r-md));
      background: #27221b;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 900ms var(--ease-out);
    }
    :host-context(a:hover) img,
    :host-context(button:hover) img,
    :host-context(.spin-wheels:hover) img {
      transform: scale(1.07);
    }
    /* "on the move": a slow push-in, like a camera following the vehicle */
    :host(.is-moving) img {
      animation: push-in 9s ease-in-out infinite alternate;
    }
    @keyframes push-in {
      to {
        transform: scale(1.12) translateX(-3%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      img {
        animation: none !important;
        transition: none;
      }
    }
  `,
})
export class VehicleArt {
  readonly icon = input.required<VehicleIcon | string>();
  readonly moving = input(false);

  private readonly key = computed(() => VEHICLE_PHOTO[this.icon()] ?? 'car-sedan');
  protected readonly src = computed(() => photoSrc(this.key(), 800));
  protected readonly srcset = computed(() => `${photoSrc(this.key(), 800)} 800w, ${photoSrc(this.key(), 1600)} 1600w`);
  protected readonly w = computed(() => PHOTOS[this.key()].width);
  protected readonly h = computed(() => PHOTOS[this.key()].height);
}
