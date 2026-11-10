import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegionStatus, type Region } from '@payana/contracts';
import { REGION_PHOTO } from '@core/media/photos';
import { Reveal, Tilt } from '@ui/motion';
import { Photo } from '@ui/photo';

/**
 * The towns we serve, north to south along the coast, as photo cards.
 * New regions appear here by themselves (they are data, not code).
 */
@Component({
  selector: 'app-coast-map',
  imports: [RouterLink, Photo, Reveal, Tilt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="towns" aria-label="Towns, north to south">
      @for (r of ordered(); track r.id; let i = $index) {
        <li appReveal [revealDelay]="i * 80">
          <a
            class="town tilt spot"
            appTilt="5"
            [class.town--live]="r.status === 'live'"
            [routerLink]="r.status === 'live' ? '/explore' : '/drive'"
            [queryParams]="r.status === 'live' ? { region: r.slug } : null"
          >
            <app-photo [key]="photo(r.slug)" sizes="(min-width: 64rem) 20vw, 60vw" />
            <span class="town__n" aria-hidden="true">{{ (i + 1).toString().padStart(2, '0') }}</span>
            <span class="town__status">
              @if (r.status === 'live') {
                <span class="dot dot--live"></span> Live now
              } @else {
                Coming soon
              }
            </span>
            <span class="town__text">
              <strong>{{ r.name }}</strong>
              @if (r.nameLocal) {
                <span class="kn" lang="kn">{{ r.nameLocal }}</span>
              }
              @if (r.tagline) {
                <small>{{ r.tagline }}</small>
              }
            </span>
          </a>
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      display: block;
    }
    .towns {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: min(72%, 17rem);
      gap: var(--s-4);
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      margin-inline: calc(var(--gutter) * -1);
      padding: 0.5rem var(--gutter) 1rem;
      scrollbar-width: none;
    }
    .towns::-webkit-scrollbar {
      display: none;
    }
    @media (min-width: 64rem) {
      .towns {
        grid-auto-flow: row;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        overflow: visible;
        margin-inline: 0;
        padding: 0;
      }
    }
    .towns li {
      scroll-snap-align: start;
    }
    .town {
      position: relative;
      display: block;
      aspect-ratio: 3 / 4;
      border-radius: var(--r-lg);
      overflow: hidden;
      border: 1px solid var(--color-border);
      color: var(--fx-paper);
    }
    .town app-photo {
      position: absolute;
      inset: 0;
    }
    .town:not(.town--live) app-photo {
      filter: saturate(0.55) brightness(0.8);
    }
    .town--live {
      border-color: rgb(var(--glow) / 0.55);
      box-shadow: var(--shadow-hard);
    }
    .town__n {
      position: absolute;
      top: 0.8rem;
      left: 0.9rem;
      z-index: 1;
      font-size: 0.8rem;
      font-weight: 800;
      letter-spacing: 0.14em;
      color: rgb(253 248 238 / 0.7);
    }
    .town__status {
      position: absolute;
      top: 0.65rem;
      right: 0.7rem;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.15rem 0.6rem;
      border-radius: var(--r-pill);
      background: rgb(14 12 9 / 0.55);
      backdrop-filter: blur(8px);
      font-size: 0.72rem;
      font-weight: 700;
    }
    .town--live .town__status {
      background: var(--marigold-500);
      color: var(--on-accent);
    }
    .town__text {
      position: absolute;
      z-index: 1;
      left: 1rem;
      right: 1rem;
      bottom: 1rem;
      display: grid;
      gap: 0.1rem;
    }
    .town__text strong {
      font-size: 1.5rem;
      font-weight: 800;
      font-stretch: 110%;
      letter-spacing: -0.02em;
    }
    .town__text .kn {
      font-size: 0.9rem;
      color: rgb(253 248 238 / 0.75);
    }
    .town__text small {
      margin-top: 0.3rem;
      font-size: var(--fs-xs);
      color: rgb(253 248 238 / 0.72);
    }
  `,
})
export class CoastMap {
  readonly regions = input.required<Region[]>();

  protected readonly ordered = computed(() =>
    [...this.regions()].filter((r) => r.status !== RegionStatus.Hidden).sort((a, b) => b.center.lat - a.center.lat),
  );

  protected photo(slug: string) {
    return REGION_PHOTO[slug] ?? 'cliff-sea';
  }
}
