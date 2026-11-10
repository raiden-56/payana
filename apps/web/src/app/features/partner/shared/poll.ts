import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject } from '@angular/core';
import { NETWORK_STATUS } from '@core/platform/platform';

/**
 * Calls `refresh` every `everyMs` while the page is on screen and online, and
 * once more the moment the tab comes back into view. Hidden tabs and offline
 * phones do not poll: it would only burn battery and mobile data.
 *
 * Call from a constructor or field initialiser; it stops with the component.
 */
export function pollWhileVisible(refresh: () => void, everyMs: number): void {
  const document = inject(DOCUMENT);
  const network = inject(NETWORK_STATUS);
  const destroyRef = inject(DestroyRef);

  const visible = () => document.visibilityState === 'visible';
  const tick = () => {
    if (visible() && network.online()) refresh();
  };
  const onVisibility = () => {
    if (visible()) tick();
  };

  const timer = setInterval(tick, everyMs);
  document.addEventListener('visibilitychange', onVisibility);
  destroyRef.onDestroy(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  });
}
