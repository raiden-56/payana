import { ChangeDetectionStrategy, Component, Injectable, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { Permission } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { AuthStore } from '@core/auth/auth.store';
import { ConsoleShell } from '@layout/console-shell';
import { visibleAdminNav, type AdminBadgeCounts } from './admin-nav';

/**
 * The live counts shown beside sidebar items (pending verifications, open
 * tickets, disputes). Screens call refresh() after an action that changes one,
 * so the badge is right without waiting for a reload.
 */
@Injectable()
export class AdminCounts {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthStore);
  private readonly state = signal<AdminBadgeCounts>({});
  readonly counts = this.state.asReadonly();

  refresh(): void {
    if (!this.auth.hasPermission(Permission.OverviewRead)) return;
    this.api.overview().subscribe({
      next: (o) =>
        this.state.set({
          pendingVerifications: o.drivers.pendingVerification,
          openTickets: o.support.openTickets,
          disputes: o.bookings.disputed,
        }),
      // Badges are a convenience; a failure here must not disturb the page.
      error: () => undefined,
    });
  }
}

/** Frame of the admin console: the shared shell with a sidebar built for this administrator's role. */
@Component({
  selector: 'app-admin-layout',
  imports: [ConsoleShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Carries the shared .a-* classes for every admin screen (see admin.scss).
  encapsulation: ViewEncapsulation.None,
  styleUrl: './admin.scss',
  template: `<app-console-shell area="Admin" tone="admin" [nav]="nav()" />`,
})
export class AdminLayout {
  private readonly auth = inject(AuthStore);
  private readonly counts = inject(AdminCounts);

  protected readonly nav = computed(() =>
    visibleAdminNav((permission) => this.auth.hasPermission(permission), this.counts.counts()),
  );

  constructor() {
    this.counts.refresh();
  }
}
