import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NotificationType, type AppNotification } from '@payana/contracts';
import { NotificationsApi } from '@core/api/customer.api';
import { safeReturnUrl } from '@core/auth/guards';
import { RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon, type IconName } from '@ui/icon';
import { StatePanel } from '@ui/primitives';

const ICONS: Partial<Record<NotificationType, IconName>> = {
  [NotificationType.QuoteReceived]: 'tag',
  [NotificationType.NewRideRequest]: 'route',
  [NotificationType.QuoteAccepted]: 'check-circle',
  [NotificationType.QuoteNotChosen]: 'close',
  [NotificationType.RequestExpired]: 'clock',
  [NotificationType.BookingStatusChanged]: 'car',
  [NotificationType.BookingCancelled]: 'alert-circle',
  [NotificationType.DocumentReviewed]: 'document',
  [NotificationType.DocumentExpiring]: 'alert',
  [NotificationType.VerificationDecided]: 'shield-check',
  [NotificationType.AuthorizationInvite]: 'users',
  [NotificationType.SubscriptionChanged]: 'card',
  [NotificationType.ReviewReceived]: 'star',
  [NotificationType.TicketUpdated]: 'message',
};

/** In-app notifications: newest first, unread marked, each one opens what it is about. */
@Component({
  selector: 'app-notifications',
  imports: [RouterLink, Icon, StatePanel, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="container container--narrow">
        <a routerLink="/account" class="back"><app-icon name="arrow-left" [size]="16" /> Account</a>
        <header class="page-head spread">
          <div class="stack" style="--stack-gap: 0.4rem">
            <span class="eyebrow">Notifications</span>
            <h1>What has changed.</h1>
          </div>
          @if (unread() > 0) {
            <button type="button" class="btn btn--outline btn--sm" [disabled]="busy()" (click)="markAll()"><app-icon name="check" [size]="15" /> Mark all read</button>
          }
        </header>

        @switch (list.status()) {
          @case ('error') {
            <app-state-panel [error]="list.error()" (retry)="list.load()" />
          }
          @case ('ready') {
            @if (list.data()!.items.length) {
              <ul class="items">
                @for (n of list.data()!.items; track n.id) {
                  <li>
                    <button type="button" class="item" [class.item--unread]="!n.readAt" (click)="open(n)">
                      <span class="item__icon"><app-icon [name]="icon(n)" [size]="20" /></span>
                      <span class="item__text">
                        <strong>{{ n.title }}</strong>
                        <span>{{ n.body }}</span>
                        <small>{{ n.createdAt | relativeTime }}</small>
                      </span>
                      @if (!n.readAt) {
                        <span class="item__dot" aria-label="Unread"></span>
                      }
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <app-state-panel kind="empty" title="Nothing new" message="Quotes, booking updates and messages from support will appear here." />
            }
          }
          @default {
            <div class="stack" aria-hidden="true">
              @for (i of [1, 2, 3, 4]; track i) {
                <span class="skeleton" style="height: 4.5rem; border-radius: var(--r-md)"></span>
              }
            </div>
          }
        }
      </div>
    </section>
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: 0.4rem; margin-bottom: var(--s-4); font-weight: 650; color: var(--ink-700); }
    .items { display: grid; border: var(--stroke) solid var(--color-border); border-radius: var(--r-lg); background: var(--sand-0); overflow: hidden; }
    .items li + li { border-top: 1px solid var(--sand-200); }
    .item { display: grid; grid-template-columns: auto 1fr auto; gap: 0.9rem; align-items: center; width: 100%; padding: 0.9rem 1.1rem; text-align: left; transition: background-color var(--dur-2); }
    .item:hover { background: var(--sand-100); }
    .item--unread { background: var(--marigold-50); }
    .item__icon { display: grid; place-items: center; width: 2.6rem; height: 2.6rem; border-radius: 50%; background: var(--sand-200); color: var(--ink-700); }
    .item--unread .item__icon { background: var(--marigold-500); color: var(--ink-900); }
    .item__text { display: grid; min-width: 0; line-height: 1.35; }
    .item__text span { font-size: var(--fs-sm); color: var(--color-text-muted); }
    .item__text small { font-size: var(--fs-xs); color: var(--color-text-subtle); }
    .item__dot { width: 0.65rem; height: 0.65rem; border-radius: 50%; background: var(--laterite-600);
  color: var(--on-accent); }
  `,
})
export class Notifications {
  private readonly api = inject(NotificationsApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly list = loader(() => this.api.list());
  protected readonly busy = signal(false);
  protected readonly unread = computed(() => this.list.data()?.unreadCount ?? 0);

  constructor() {
    this.list.load();
  }

  protected icon(n: AppNotification): IconName {
    return ICONS[n.type] ?? 'bell';
  }

  protected open(n: AppNotification): void {
    if (!n.readAt) {
      this.api.markRead(n.id).subscribe({ error: () => undefined });
      this.list.update((l) => ({
        unreadCount: Math.max(0, l.unreadCount - 1),
        items: l.items.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)),
      }));
    }
    // Links come from the server, but only in-app paths are ever followed.
    const target = safeReturnUrl(n.link);
    if (target) void this.router.navigateByUrl(target);
  }

  protected markAll(): void {
    this.busy.set(true);
    this.api.markAllRead().subscribe({
      next: () => {
        this.busy.set(false);
        const now = new Date().toISOString();
        this.list.update((l) => ({ unreadCount: 0, items: l.items.map((i) => ({ ...i, readAt: i.readAt ?? now })) }));
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }
}
