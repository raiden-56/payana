import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@ui/icon';
import { VehicleArt } from '@ui/vehicle-art';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, Icon, VehicleArt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page container container--narrow lost">
      <div class="lost__art spin-wheels">
        <span class="lost__code" aria-hidden="true">4</span>
        <app-vehicle-art icon="auto" [moving]="true" />
        <span class="lost__code" aria-hidden="true">4</span>
      </div>
      <h1>This road does not go anywhere</h1>
      <p class="muted">The page you asked for is not here. It may have moved, or the link may be mistyped.</p>
      <div class="cluster lost__actions">
        <a routerLink="/" class="btn btn--accent">Back to the start <app-icon class="btn__arrow" name="arrow-right" [size]="18" /></a>
        <a routerLink="/explore" class="btn btn--outline">Find a ride</a>
      </div>
    </section>
  `,
  styles: `
    .lost {
      display: grid;
      justify-items: center;
      gap: var(--s-4);
      text-align: center;
      padding-top: clamp(2rem, 8vw, 6rem);
    }
    .lost__art {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: min(26rem, 90%);
    }
    .lost__code {
      font-size: clamp(5rem, 22vw, 9rem);
      font-weight: 800;
      font-stretch: 120%;
      line-height: 1;
      color: var(--laterite-600);
      letter-spacing: -0.05em;
    }
    .lost__actions {
      justify-content: center;
      margin-top: var(--s-2);
    }
  `,
})
export class NotFound {}
