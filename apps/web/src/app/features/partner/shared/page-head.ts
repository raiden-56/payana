import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@ui/icon';

/** The heading block at the top of every partner screen: title, one line of help, actions on the right. */
@Component({
  selector: 'app-partner-head',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (back(); as link) {
      <a class="back" [routerLink]="link"><app-icon name="arrow-left" [size]="16" /> {{ backLabel() }}</a>
    }
    <div class="row">
      <div class="text">
        <h1>{{ heading() }}</h1>
        @if (lead()) {
          <p>{{ lead() }}</p>
        }
      </div>
      <div class="actions"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.6rem;
      margin-bottom: clamp(1.1rem, 0.8rem + 1.4vw, 1.9rem);
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      justify-self: start;
      min-height: 2rem;
      font-size: var(--fs-sm);
      font-weight: 650;
      color: var(--ink-700);
    }
    .back:hover {
      color: var(--laterite-600);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem 1.5rem;
    }
    .text {
      display: grid;
      gap: 0.3rem;
      min-width: 0;
    }
    h1 {
      font-size: clamp(1.65rem, 1.3rem + 1.4vw, 2.25rem);
      letter-spacing: -0.025em;
    }
    p {
      max-width: 42rem;
      color: var(--color-text-muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .actions:empty {
      display: none;
    }
  `,
})
export class PartnerHead {
  readonly heading = input.required<string>();
  readonly lead = input('');
  /** Router link for a "back" control above the title. */
  readonly back = input<string | null>(null);
  readonly backLabel = input('Back');
}
