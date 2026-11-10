import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StatePanel } from '@ui/primitives';

/** Shown for an area whose screens are not built yet. Never used for a finished feature. */
@Component({
  selector: 'app-coming-soon',
  imports: [RouterLink, StatePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page container container--narrow">
      <app-state-panel kind="info" title="This area is still being built" message="The screens for this part of the product are not finished yet.">
        <a routerLink="/" class="btn btn--dark btn--sm">Back to the start</a>
      </app-state-panel>
    </section>
  `,
})
export class ComingSoon {}
