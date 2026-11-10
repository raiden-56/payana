import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { RatingSummary } from '@payana/contracts';
import { BRAND } from '@core/brand';
import { ApiError } from '@core/api/api-error';
import { NETWORK_STATUS } from '@core/platform/platform';
import { ToastService } from '@core/util/toast.service';
import { initials } from '@core/util/format';
import { Icon, type IconName } from './icon';

// ---------------------------------------------------------------------------
// Logo: a marigold sun setting into a green sea, which also reads as a wheel.
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="mark" aria-hidden="true">{{ brand.name.charAt(0) }}</span>
    @if (!markOnly()) {
      <span class="word">
        {{ brand.name }}
        <span class="word__local kn" aria-hidden="true">{{ brand.nameLocal }}</span>
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      color: inherit;
    }
    .mark {
      display: grid;
      place-items: center;
      width: var(--logo-size, 2.25rem);
      height: var(--logo-size, 2.25rem);
      border-radius: 0.7rem;
      background: linear-gradient(135deg, var(--marigold-500), var(--laterite-500));
      color: var(--on-accent);
      font-size: calc(var(--logo-size, 2.25rem) * 0.58);
      font-weight: 800;
      font-stretch: 115%;
      line-height: 1;
      box-shadow: 0 6px 20px -6px rgb(242 168 29 / 0.7);
      transition: transform var(--dur-3) var(--ease-spring);
    }
    :host-context(a:hover) .mark {
      transform: rotate(-8deg) scale(1.06);
    }
    .word {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4rem;
      font-size: 1.5rem;
      font-weight: 800;
      font-stretch: 112%;
      letter-spacing: -0.03em;
      line-height: 1;
    }
    .word__local {
      font-size: 0.95rem;
      font-weight: 600;
      letter-spacing: 0;
      opacity: 0.6;
    }
  `,
})
export class Logo {
  readonly markOnly = input(false);
  protected readonly brand = BRAND;
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-rating',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rating().average !== null) {
      <app-icon name="star" [size]="size()" [filled]="true" />
      <span class="value">{{ rating().average!.toFixed(1) }}</span>
      <span class="count">({{ rating().count }})</span>
      <span class="visually-hidden">rated {{ rating().average!.toFixed(1) }} out of 5 from {{ rating().count }} reviews</span>
    } @else {
      <span class="new">New on {{ brand }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: var(--fs-sm);
      white-space: nowrap;
    }
    app-icon {
      color: var(--marigold-500);
      stroke: var(--ink-900);
    }
    .value {
      font-weight: 750;
    }
    .count,
    .new {
      color: var(--color-text-subtle);
    }
  `,
})
export class Rating {
  readonly rating = input.required<RatingSummary>();
  readonly size = input(16);
  protected readonly brand = BRAND.name;
}

// ---------------------------------------------------------------------------
// Avatar: photo when there is one, otherwise initials on a stable warm colour.
// ---------------------------------------------------------------------------

const AVATAR_TONES = [
  ['var(--marigold-300)', 'var(--on-accent)'],
  ['var(--laterite-300)', 'var(--on-accent)'],
  ['var(--palm-300)', 'var(--on-accent)'],
  ['#e3cfa6', 'var(--on-accent)'],
  ['var(--coral-300)', 'var(--on-accent)'],
] as const;

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--size]': 'size() + "px"',
    '[style.background]': 'tone()[0]',
    '[style.color]': 'tone()[1]',
  },
  template: `
    @if (photoUrl()) {
      <img [src]="photoUrl()" alt="" loading="lazy" decoding="async" />
    } @else {
      <span aria-hidden="true">{{ letters() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: var(--size);
      height: var(--size);
      border-radius: 50%;
      border: var(--stroke) solid var(--ink-900);
      overflow: hidden;
      font-weight: 750;
      font-size: calc(var(--size) * 0.38);
      letter-spacing: 0.02em;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class Avatar {
  readonly name = input<string | null>('');
  readonly photoUrl = input<string | null>(null);
  readonly size = input(48);

  protected readonly letters = computed(() => initials(this.name()));
  protected readonly tone = computed(() => {
    const name = this.name() ?? '';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_TONES[hash % AVATAR_TONES.length]!;
  });
}

// ---------------------------------------------------------------------------
// State panel: the empty / error / offline message every async screen shares.
// ---------------------------------------------------------------------------

export type StateKind = 'empty' | 'error' | 'offline' | 'info';

@Component({
  selector: 'app-state-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.role]': 'resolvedKind() === "empty" || resolvedKind() === "info" ? "status" : "alert"' },
  template: `
    <span class="art" [attr.data-kind]="resolvedKind()" aria-hidden="true">
      <app-icon [name]="artIcon()" [size]="30" />
    </span>
    <h3 class="title">{{ resolvedTitle() }}</h3>
    @if (resolvedMessage(); as text) {
      <p class="message">{{ text }}</p>
    }
    @if (error()?.traceId; as trace) {
      <p class="trace">Reference: {{ trace }}</p>
    }
    <div class="actions">
      @if (showRetry()) {
        <button type="button" class="btn btn--dark btn--sm" (click)="retry.emit()">
          <app-icon name="refresh" [size]="16" /> Try again
        </button>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: grid;
      justify-items: center;
      gap: var(--s-2);
      padding: clamp(1.5rem, 1rem + 3vw, 3rem) var(--s-4);
      text-align: center;
      border: var(--stroke) dashed var(--color-border);
      border-radius: var(--r-lg);
      background: var(--sand-0);
      animation: rise-in var(--dur-3) var(--ease-out);
    }
    .art {
      display: grid;
      place-items: center;
      width: 4.5rem;
      height: 4.5rem;
      margin-bottom: var(--s-2);
      border-radius: 50%;
      background: rgb(242 168 29 / 0.12);
      color: var(--marigold-500);
      box-shadow: 0 0 0 8px rgb(242 168 29 / 0.06), 0 0 40px rgb(242 168 29 / 0.25);
    }
    .art[data-kind='error'],
    .art[data-kind='offline'] {
      background: rgb(226 100 58 / 0.14);
      color: var(--laterite-600);
      box-shadow: 0 0 0 8px rgb(226 100 58 / 0.06), 0 0 40px rgb(226 100 58 / 0.25);
    }
    .title {
      font-size: var(--fs-h4);
    }
    .message {
      max-width: 30rem;
      color: var(--color-text-muted);
    }
    .trace {
      font-size: var(--fs-xs);
      color: var(--color-text-subtle);
      font-variant-numeric: tabular-nums;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--s-3);
      margin-top: var(--s-3);
    }
    .actions:empty {
      display: none;
    }
  `,
})
export class StatePanel {
  readonly kind = input<StateKind>('empty');
  readonly title = input('');
  readonly message = input('');
  /** When given, the panel words itself from the error and offers a retry if it makes sense. */
  readonly error = input<ApiError | null>(null);
  readonly retry = output<void>();

  private readonly network = inject(NETWORK_STATUS);

  protected readonly resolvedKind = computed<StateKind>(() => {
    const error = this.error();
    if (error?.isTransport && !this.network.online()) return 'offline';
    return error ? 'error' : this.kind();
  });

  protected readonly artIcon = computed<IconName>(() => {
    switch (this.resolvedKind()) {
      case 'offline':
        return 'wifi-off';
      case 'error':
        return 'alert';
      case 'info':
        return 'info';
      default:
        return 'compass';
    }
  });

  protected readonly resolvedTitle = computed(() => {
    if (this.title()) return this.title();
    switch (this.resolvedKind()) {
      case 'offline':
        return 'You are offline';
      case 'error':
        return 'That did not load';
      default:
        return 'Nothing here yet';
    }
  });

  protected readonly resolvedMessage = computed(() => {
    if (this.message()) return this.message();
    if (this.resolvedKind() === 'offline') {
      return 'Check your mobile data or Wi-Fi. This page will work again once you are back online.';
    }
    return this.error()?.message ?? '';
  });

  protected readonly showRetry = computed(() => {
    const error = this.error();
    return !!error && (error.isRetryable || this.resolvedKind() === 'offline');
  });
}

// ---------------------------------------------------------------------------
// Toast host
// ---------------------------------------------------------------------------

const TOAST_ICON: Record<string, IconName> = {
  success: 'check-circle',
  error: 'alert-circle',
  info: 'info',
};

@Component({
  selector: 'app-toast-host',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="host" aria-live="polite" aria-atomic="false">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast" [class]="'toast toast--' + toast.tone" [attr.role]="toast.tone === 'error' ? 'alert' : 'status'">
          <app-icon [name]="icon(toast.tone)" [size]="20" />
          <span>{{ toast.message }}</span>
          <button type="button" class="toast__close" (click)="toasts.dismiss(toast.id)" aria-label="Dismiss">
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .host {
      position: fixed;
      z-index: var(--z-toast);
      left: 50%;
      bottom: max(1rem, env(safe-area-inset-bottom));
      transform: translateX(-50%);
      display: grid;
      gap: 0.5rem;
      width: min(28rem, calc(100vw - 1.5rem));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      padding: 0.8rem 0.9rem 0.8rem 1rem;
      border-radius: var(--r-md);
      background: var(--ink-900);
      color: var(--sand-50);
      box-shadow: var(--shadow-lg);
      font-size: var(--fs-sm);
      font-weight: 550;
      animation: toast-in var(--dur-3) var(--ease-spring);
    }
    .toast span {
      flex: 1;
      padding-top: 0.05rem;
    }
    .toast--success app-icon:first-child {
      color: var(--palm-300);
    }
    .toast--error app-icon:first-child {
      color: var(--coral-400);
    }
    .toast--info app-icon:first-child {
      color: var(--marigold-300);
    }
    .toast__close {
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 50%;
      color: var(--sand-300);
    }
    .toast__close:hover {
      background: rgb(255 255 255 / 0.12);
      color: #fff;
    }
    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(16px) scale(0.96);
      }
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
  protected icon(tone: string): IconName {
    return TOAST_ICON[tone] ?? 'info';
  }
}

// ---------------------------------------------------------------------------
// Modal: a native <dialog>, so focus trapping, Escape and the top layer are
// handled by the browser. A bottom sheet on phones (see .dialog styles).
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-modal',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Click on the native <dialog> backdrop; Escape closes it natively. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog #dialog class="dialog" [attr.aria-labelledby]="titleId" (close)="closed.emit()" (click)="onBackdrop($event)">
      <header class="dialog__head">
        <h2 [id]="titleId">{{ title() }}</h2>
        <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="dialog.close()" aria-label="Close">
          <app-icon name="close" />
        </button>
      </header>
      <div class="dialog__body">
        <ng-content />
      </div>
      <footer class="dialog__foot">
        <ng-content select="[modalActions]" />
      </footer>
    </dialog>
  `,
  styles: `
    .dialog__foot:empty {
      display: none;
    }
  `,
})
export class Modal {
  private static nextId = 0;

  readonly open = input(false);
  readonly title = input.required<string>();
  /** Fires when the dialog closes for any reason (button, Escape, backdrop). */
  readonly closed = output<void>();

  protected readonly titleId = `modal-title-${Modal.nextId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.open() && !el.open) el.showModal();
      else if (!this.open() && el.open) el.close();
    });
  }

  protected onBackdrop(event: MouseEvent): void {
    // A click on the <dialog> element itself (not its children) is the backdrop.
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
