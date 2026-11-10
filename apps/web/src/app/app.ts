import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NETWORK_STATUS } from '@core/platform/platform';
import { ConsentBanner } from '@ui/consent-banner';
import { Icon } from '@ui/icon';
import { ToastHost } from '@ui/primitives';

/** Application root: the routed layout plus the things that float above every page. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost, ConsentBanner, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!network.online()) {
      <div class="offline" role="status">
        <app-icon name="wifi-off" [size]="16" />
        You are offline. Pages you have already opened still work; new requests will wait.
      </div>
    }
    <router-outlet />
    <app-toast-host />
    <app-consent-banner />
  `,
  styles: `
    .offline {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.45rem 1rem;
      background: var(--ink-900);
      color: var(--marigold-300);
      font-size: var(--fs-sm);
      font-weight: 600;
      text-align: center;
    }
  `,
})
export class App {
  protected readonly network = inject(NETWORK_STATUS);
}
