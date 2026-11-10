import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from '@core/auth/auth.store';
import { ToastService } from '@core/util/toast.service';
import { Icon, type IconName } from '@ui/icon';
import { Avatar, Logo } from '@ui/primitives';

export interface ConsoleNavItem {
  label: string;
  icon: IconName;
  /** Router link, e.g. "/partner/requests". */
  link: string;
  /** Match the link exactly (use for the section's home). */
  exact?: boolean;
  /** Small count shown beside the label; hidden when 0 or undefined. */
  badge?: number;
  /** Starts a new group with this heading above the item. */
  group?: string;
}

/**
 * The shared frame of the two signed-in work areas - the partner dashboard
 * and the admin console: a sidebar on wide screens, a slide-in drawer on
 * phones, and the routed page beside it.
 *
 *   <app-console-shell area="Partner" [nav]="nav" tone="partner" />
 *
 * The shell contains the <router-outlet>; child routes render inside it.
 */
@Component({
  selector: 'app-console-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone()', '(document:keydown.escape)': 'drawerOpen.set(false)' },
  template: `
    <a class="skip-link" href="#console-main">Skip to content</a>

    <header class="topbar">
      <button
        type="button"
        class="btn btn--ghost btn--icon"
        aria-label="Menu"
        aria-controls="console-nav"
        [attr.aria-expanded]="drawerOpen()"
        (click)="drawerOpen.set(!drawerOpen())"
      >
        <app-icon [name]="drawerOpen() ? 'close' : 'menu'" [size]="22" />
      </button>
      <a routerLink="/" aria-label="Home"><app-logo [markOnly]="true" /></a>
      <strong class="topbar__area">{{ area() }}</strong>
      <ng-content select="[consoleTopbar]" />
    </header>

    @if (drawerOpen()) {
      <!-- Pointer-only dismiss area; keyboard users close it with Escape (handled on the host). -->
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
      <div class="scrim" (click)="drawerOpen.set(false)"></div>
    }

    <aside class="side" id="console-nav" [class.is-open]="drawerOpen()">
      <a routerLink="/" class="side__brand" aria-label="Back to the public site">
        <app-logo />
      </a>
      <p class="side__area">{{ area() }}</p>

      <nav [attr.aria-label]="area() + ' navigation'">
        <ul>
          @for (item of nav(); track item.link) {
            @if (item.group) {
              <li class="side__group" role="presentation">{{ item.group }}</li>
            }
            <li>
              <a
                class="side__link"
                [routerLink]="item.link"
                routerLinkActive="is-active"
                [routerLinkActiveOptions]="{ exact: !!item.exact }"
                ariaCurrentWhenActive="page"
              >
                <app-icon [name]="item.icon" [size]="19" />
                <span>{{ item.label }}</span>
                @if (item.badge) {
                  <span class="side__badge">{{ item.badge > 99 ? '99+' : item.badge }}</span>
                }
              </a>
            </li>
          }
        </ul>
      </nav>

      <div class="side__foot">
        <div class="side__user">
          <app-avatar [name]="auth.displayName()" [size]="38" />
          <div>
            <strong>{{ auth.displayName() }}</strong>
            <span>{{ roleLabel() }}</span>
          </div>
        </div>
        <button type="button" class="side__link" (click)="signOut()">
          <app-icon name="logout" [size]="19" /> <span>Sign out</span>
        </button>
      </div>
    </aside>

    <main class="main" id="console-main" tabindex="-1">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      --side-w: 16.5rem;
      --side-bg: var(--palm-900);
      --side-accent: var(--marigold-500);
      display: block;
      min-height: 100dvh;
      background: var(--sand-50);
    }
    :host([data-tone='admin']) {
      --side-bg: var(--ink-900);
      --side-accent: var(--laterite-500);
    }

    /* --- top bar (phones and tablets) --- */
    .topbar {
      position: sticky;
      top: 0;
      z-index: var(--z-header);
      display: flex;
      align-items: center;
      gap: 0.6rem;
      height: 3.75rem;
      padding-inline: 0.6rem 1rem;
      background: color-mix(in srgb, var(--sand-50) 92%, transparent);
      backdrop-filter: blur(10px);
      border-bottom: var(--stroke) solid var(--sand-300);
      --logo-size: 2rem;
    }
    .topbar__area {
      font-size: 1.05rem;
      font-stretch: 108%;
      margin-right: auto;
    }

    /* --- sidebar --- */
    .side {
      position: fixed;
      z-index: var(--z-drawer);
      inset: 0 auto 0 0;
      width: min(var(--side-w), 86vw);
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 1.1rem 0.8rem 0.9rem;
      background: var(--side-bg);
      color: var(--sand-200);
      overflow-y: auto;
      transform: translateX(-102%);
      transition: transform var(--dur-3) var(--ease-out);
    }
    .side.is-open {
      transform: none;
      box-shadow: var(--shadow-lg);
    }
    .side__brand {
      display: inline-flex;
      padding: 0.2rem 0.5rem;
      color: var(--sand-50);
      border-radius: var(--r-sm);
    }
    .side__area {
      margin: 0.35rem 0.6rem 0.9rem;
      padding: 0.15rem 0.6rem;
      align-self: flex-start;
      border-radius: var(--r-pill);
      background: var(--side-accent);
      color: var(--ink-900);
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    :host([data-tone='admin']) .side__area {
      color: #fff;
    }
    nav {
      flex: 1;
    }
    ul {
      display: grid;
      gap: 0.15rem;
    }
    .side__group {
      margin: 0.9rem 0.7rem 0.3rem;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: rgb(253 248 238 / 0.45);
    }
    .side__link {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      padding: 0.62rem 0.75rem;
      border-radius: var(--r-sm);
      color: var(--sand-200);
      font-weight: 600;
      text-align: left;
      transition:
        background-color var(--dur-2),
        color var(--dur-2),
        transform var(--dur-2) var(--ease-out);
    }
    .side__link span:first-of-type {
      flex: 1;
    }
    .side__link app-icon {
      opacity: 0.75;
    }
    .side__link:hover {
      background: rgb(253 248 238 / 0.09);
      color: #fff;
      transform: translateX(2px);
    }
    .side__link.is-active {
      background: var(--sand-50);
      color: var(--ink-900);
    }
    .side__link.is-active app-icon {
      opacity: 1;
      color: var(--laterite-600);
    }
    .side__link:focus-visible {
      outline-color: var(--marigold-300);
      box-shadow: none;
    }
    .side__badge {
      min-width: 1.4rem;
      padding: 0 0.35rem;
      border-radius: var(--r-pill);
      background: var(--side-accent);
      color: var(--ink-900);
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.4rem;
      text-align: center;
    }
    :host([data-tone='admin']) .side__badge {
      color: #fff;
    }
    .side__foot {
      display: grid;
      gap: 0.4rem;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid rgb(253 248 238 / 0.14);
    }
    .side__user {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      padding: 0.3rem 0.5rem;
      min-width: 0;
    }
    .side__user div {
      display: grid;
      min-width: 0;
      line-height: 1.25;
    }
    .side__user strong {
      color: var(--sand-50);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .side__user span {
      font-size: var(--fs-xs);
      color: rgb(253 248 238 / 0.6);
    }
    .scrim {
      position: fixed;
      inset: 0;
      z-index: calc(var(--z-drawer) - 1);
      background: rgb(31 26 20 / 0.5);
      animation: fade-in var(--dur-2) var(--ease-out);
    }

    /* --- content --- */
    .main {
      outline: none;
      padding: clamp(1rem, 0.6rem + 2vw, 2.25rem);
      padding-bottom: 4rem;
      max-width: 82rem;
    }

    /* --- wide screens: the sidebar is always there --- */
    @media (min-width: 64rem) {
      .topbar,
      .scrim {
        display: none;
      }
      .side {
        transform: none;
        width: var(--side-w);
        box-shadow: none;
      }
      .main {
        margin-left: var(--side-w);
      }
    }
  `,
})
export class ConsoleShell {
  /** Name of the work area, e.g. "Partner" or "Admin". */
  readonly area = input.required<string>();
  readonly nav = input.required<ConsoleNavItem[]>();
  readonly tone = input<'partner' | 'admin'>('partner');

  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly drawerOpen = signal(false);

  protected readonly roleLabel = computed(() => {
    const me = this.auth.me();
    if (me?.admin) return me.admin.adminRole.replace(/_/g, ' ');
    if (me?.driver) return 'Driver partner';
    return 'Signed in';
  });

  constructor() {
    const sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.drawerOpen.set(false));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  protected signOut(): void {
    this.auth.logout().subscribe(() => {
      this.toasts.info('You are signed out.');
      void this.router.navigateByUrl('/');
    });
  }
}
