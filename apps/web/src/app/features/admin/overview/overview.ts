import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Permission } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { AuthStore } from '@core/auth/auth.store';
import { DateTimePipe, MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon, type IconName } from '@ui/icon';
import { CountUp, Reveal } from '@ui/motion';
import { StatePanel } from '@ui/primitives';
import { TrendChart } from './trend-chart';

interface Attention {
  label: string;
  count: number;
  icon: IconName;
  link: string;
  query?: Record<string, string>;
  /** Shown only to roles that can open the target screen. */
  permission: Permission;
  urgent?: boolean;
}

/** Console home: what needs attention now, the headline numbers, and the 14-day trend. */
@Component({
  selector: 'app-admin-overview',
  imports: [RouterLink, Icon, StatePanel, TrendChart, CountUp, Reveal, MoneyPipe, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class AdminOverviewPage {
  private readonly api = inject(AdminApi);
  protected readonly auth = inject(AuthStore);

  protected readonly canRead = this.auth.hasPermission(Permission.OverviewRead);
  protected readonly overview = loader(() => this.api.overview());

  protected readonly attention = computed<Attention[]>(() => {
    const o = this.overview.data();
    if (!o) return [];
    const all: Attention[] = [
      {
        label: 'Drivers waiting for verification',
        count: o.drivers.pendingVerification,
        icon: 'shield-check',
        link: '/admin/verifications',
        query: { status: 'pending' },
        permission: Permission.VerificationRead,
      },
      {
        label: 'Urgent support tickets',
        count: o.support.urgentTickets,
        icon: 'alert',
        link: '/admin/support',
        permission: Permission.SupportManage,
        urgent: true,
      },
      {
        label: 'Bookings under dispute',
        count: o.bookings.disputed,
        icon: 'flag',
        link: '/admin/bookings',
        query: { status: 'disputed' },
        permission: Permission.BookingsRead,
        urgent: true,
      },
      {
        label: 'Documents expiring within 30 days',
        count: o.documents.expiringIn30Days,
        icon: 'document',
        link: '/admin/verifications',
        query: { status: 'approved' },
        permission: Permission.VerificationRead,
      },
    ];
    return all.filter((item) => this.auth.hasPermission(item.permission));
  });

  protected readonly quotedShare = computed(() => {
    const share = this.overview.data()?.requests.quotedShare;
    return share === null || share === undefined ? null : Math.round(share * 100);
  });

  constructor() {
    if (this.canRead) this.overview.load();
  }
}
