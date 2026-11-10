import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { FeatureFlag } from '@payana/contracts';
import { ConsentStore } from '@core/analytics/consent.store';
import { NotificationsApi } from '@core/api/customer.api';
import { AuthStore } from '@core/auth/auth.store';
import { BRAND } from '@core/brand';
import { AppConfigService } from '@core/config/app-config.service';
import { formatPhone } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Avatar, Logo } from '@ui/primitives';

/** Header, page outlet and footer for every public and customer page. */
@Component({
  selector: 'app-site-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './site-layout.html',
  styleUrl: './site-layout.scss',
  host: { '(document:keydown.escape)': 'closeMenus()' },
})
export class SiteLayout {
  protected readonly auth = inject(AuthStore);
  protected readonly config = inject(AppConfigService);
  protected readonly consent = inject(ConsentStore);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly notifications = inject(NotificationsApi);

  protected readonly brand = BRAND;
  protected readonly year = new Date().getFullYear();
  protected readonly scrolled = signal(false);
  protected readonly drawerOpen = signal(false);
  protected readonly accountOpen = signal(false);
  protected readonly unread = signal(0);

  protected readonly showPackages = computed(() => this.config.isEnabled(FeatureFlag.Packages));
  protected readonly showDrive = computed(() => this.config.isEnabled(FeatureFlag.DriverSignUp));

  protected readonly supportPhone = computed(() => formatPhone(this.config.support().phone));
  protected readonly whatsappLink = computed(() => {
    const n = this.config.support().whatsapp.replace(/\D/g, '');
    return n ? `https://wa.me/${n}` : '';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    const sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.closeMenus();
      this.refreshUnread();
    });
    destroyRef.onDestroy(() => sub.unsubscribe());

    afterNextRender(() => {
      const onScroll = () => this.scrolled.set(window.scrollY > 12);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
      this.refreshUnread();
    });
  }

  protected closeMenus(): void {
    this.drawerOpen.set(false);
    this.accountOpen.set(false);
  }

  protected signOut(): void {
    this.closeMenus();
    this.auth.logout().subscribe(() => {
      this.toasts.info('You are signed out.');
      void this.router.navigateByUrl('/');
    });
  }

  private refreshUnread(): void {
    if (!this.auth.isAuthenticated()) {
      this.unread.set(0);
      return;
    }
    this.notifications.list(true).subscribe({
      next: (list) => this.unread.set(list.unreadCount),
      // The badge is a nicety; a failure here must never surface as an error.
      error: () => undefined,
    });
  }
}
