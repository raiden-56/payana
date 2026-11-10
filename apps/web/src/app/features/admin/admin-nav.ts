import { Permission } from '@payana/contracts';
import type { ConsoleNavItem } from '@layout/console-shell';
import type { IconName } from '@ui/icon';

export interface AdminNavEntry {
  label: string;
  icon: IconName;
  link: string;
  /** The permission the screen's read endpoint requires. */
  permission: Permission;
  /** Sidebar group heading. Empty for the ungrouped items at the top. */
  group: string;
  exact?: boolean;
  /** Which live count, if any, is shown beside the label. */
  badge?: 'pendingVerifications' | 'openTickets' | 'disputes';
}

/**
 * The whole console in one table. The sidebar, the route guards and the
 * overview's shortcuts all read it, so a screen cannot be reachable for a role
 * in one place and hidden in another.
 */
export const ADMIN_NAV: readonly AdminNavEntry[] = [
  { label: 'Overview', icon: 'grid', link: '/admin', permission: Permission.OverviewRead, group: '', exact: true },

  { label: 'Verifications', icon: 'shield-check', link: '/admin/verifications', permission: Permission.VerificationRead, group: 'Marketplace', badge: 'pendingVerifications' },
  { label: 'Users', icon: 'users', link: '/admin/users', permission: Permission.UsersRead, group: 'Marketplace' },
  { label: 'Bookings', icon: 'ticket', link: '/admin/bookings', permission: Permission.BookingsRead, group: 'Marketplace', badge: 'disputes' },
  { label: 'Support', icon: 'message', link: '/admin/support', permission: Permission.SupportManage, group: 'Marketplace', badge: 'openTickets' },

  { label: 'Regions & vehicles', icon: 'map', link: '/admin/catalog', permission: Permission.CatalogManage, group: 'Catalogue' },
  { label: 'Tour packages', icon: 'compass', link: '/admin/packages', permission: Permission.PackagesManage, group: 'Catalogue' },

  { label: 'Plans', icon: 'card', link: '/admin/plans', permission: Permission.PlansManage, group: 'Revenue' },
  { label: 'Advertisements', icon: 'megaphone', link: '/admin/ads', permission: Permission.AdsManage, group: 'Revenue' },

  { label: 'Settings', icon: 'sliders', link: '/admin/settings', permission: Permission.SettingsRead, group: 'Platform' },
  { label: 'Audit log', icon: 'history', link: '/admin/audit', permission: Permission.AuditRead, group: 'Platform' },
  { label: 'Staff', icon: 'key', link: '/admin/staff', permission: Permission.StaffManage, group: 'Platform' },
];

export type AdminBadgeCounts = Partial<Record<NonNullable<AdminNavEntry['badge']>, number>>;

/**
 * The sidebar for one administrator: only the screens their role may open,
 * with each group heading attached to the first item of that group that is
 * actually shown.
 *
 * This decides what is *offered*. It is not access control - the API checks
 * the permission on every request.
 */
export function visibleAdminNav(
  has: (permission: Permission) => boolean,
  counts: AdminBadgeCounts = {},
  entries: readonly AdminNavEntry[] = ADMIN_NAV,
): ConsoleNavItem[] {
  const seenGroups = new Set<string>();
  const items: ConsoleNavItem[] = [];
  for (const entry of entries) {
    if (!has(entry.permission)) continue;
    const item: ConsoleNavItem = { label: entry.label, icon: entry.icon, link: entry.link };
    if (entry.exact) item.exact = true;
    if (entry.group && !seenGroups.has(entry.group)) {
      seenGroups.add(entry.group);
      item.group = entry.group;
    }
    const count = entry.badge ? counts[entry.badge] : undefined;
    if (count) item.badge = count;
    items.push(item);
  }
  return items;
}
