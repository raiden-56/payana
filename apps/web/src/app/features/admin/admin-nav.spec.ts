import { ADMIN_ROLE_PERMISSIONS, AdminRole, Permission } from '@payana/contracts';
import { ADMIN_NAV, visibleAdminNav } from './admin-nav';

const navFor = (role: AdminRole) => {
  const granted = new Set<Permission>(ADMIN_ROLE_PERMISSIONS[role]);
  return visibleAdminNav((p) => granted.has(p));
};
const labels = (role: AdminRole) => navFor(role).map((item) => item.label);

describe('visibleAdminNav', () => {
  it('shows a super admin every screen', () => {
    expect(labels(AdminRole.SuperAdmin)).toEqual(ADMIN_NAV.map((e) => e.label));
  });

  it('shows a verification officer only their work', () => {
    expect(labels(AdminRole.VerificationOfficer)).toEqual(['Overview', 'Verifications', 'Users']);
  });

  it('never offers Staff or the audit log to non-privileged roles', () => {
    for (const role of [AdminRole.VerificationOfficer, AdminRole.SupportAgent, AdminRole.FinanceManager]) {
      expect(labels(role)).not.toContain('Staff');
      expect(labels(role)).not.toContain('Audit log');
      expect(labels(role)).not.toContain('Settings');
    }
    expect(labels(AdminRole.MarketingManager)).toContain('Settings');
    expect(labels(AdminRole.MarketingManager)).not.toContain('Staff');
  });

  it('puts each group heading on the first item actually shown', () => {
    // Finance sees Bookings (Marketplace) but not Verifications, the first entry of that group.
    const finance = navFor(AdminRole.FinanceManager);
    expect(finance.find((i) => i.label === 'Bookings')?.group).toBe('Marketplace');
    expect(finance.filter((i) => i.group === 'Marketplace')).toHaveLength(1);
    expect(finance.find((i) => i.label === 'Plans')?.group).toBe('Revenue');
  });

  it('shows nothing to an account with no permissions', () => {
    expect(visibleAdminNav(() => false)).toEqual([]);
  });

  it('adds badges only for non-zero counts', () => {
    const nav = visibleAdminNav(() => true, { pendingVerifications: 4, openTickets: 0 });
    expect(nav.find((i) => i.label === 'Verifications')?.badge).toBe(4);
    expect(nav.find((i) => i.label === 'Support')?.badge).toBeUndefined();
  });
});
