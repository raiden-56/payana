import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PHOTOS, type PhotoKey } from '@core/media/photos';
import { Photo } from '@ui/photo';

/**
 * Photo credits. Every photograph on the site is openly licensed (Creative
 * Commons BY or BY-SA) and the licence requires this attribution.
 */
@Component({
  selector: 'app-credits',
  imports: [Photo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="container">
        <header class="page-head">
          <span class="eyebrow">Photo credits</span>
          <h1>The people behind the pictures.</h1>
          <p>
            Every photograph on this site is shared by its author under a Creative Commons licence on Wikimedia Commons.
            Photos are resized for the web and otherwise unchanged. Illustrations are original work.
          </p>
        </header>
        <ul class="grid grid--3">
          @for (key of keys; track key) {
            @let p = photos[key];
            <li class="credit">
              <app-photo [key]="key" sizes="(min-width: 64rem) 30vw, 90vw" />
              <div class="credit__text">
                <p class="credit__alt">{{ p.alt }}</p>
                <p>
                  <a class="link" [href]="p.credit.source" target="_blank" rel="noopener noreferrer">“{{ p.credit.title }}”</a>
                  by {{ p.credit.author }},
                  <a class="link" [href]="p.credit.licenceUrl" target="_blank" rel="noopener noreferrer license">{{ p.credit.licence }}</a>.
                </p>
              </div>
            </li>
          }
        </ul>
      </div>
    </section>
  `,
  styles: `
    .credit {
      display: grid;
      grid-template-rows: auto 1fr;
      border: 1px solid var(--color-border);
      border-radius: var(--r-lg);
      background: var(--sand-0);
      overflow: hidden;
    }
    .credit app-photo {
      aspect-ratio: 16 / 10;
    }
    .credit__text {
      display: grid;
      gap: 0.4rem;
      padding: 0.9rem 1.1rem 1.1rem;
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
      overflow-wrap: anywhere;
    }
    .credit__alt {
      color: var(--ink-900);
      font-weight: 650;
    }
  `,
})
export class Credits {
  protected readonly photos = PHOTOS;
  protected readonly keys = Object.keys(PHOTOS) as PhotoKey[];
}
