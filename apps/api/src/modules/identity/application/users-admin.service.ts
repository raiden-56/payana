import { Injectable } from '@nestjs/common';
import {
  AccountRole,
  AdminRole,
  UserStatus,
  type AdminUserQuery,
  type AdminUserRow,
  type CreateStaffRequest,
  type Paginated,
  type StaffMember,
  type UpdateStaffRequest,
} from '@payana/contracts';
import argon2 from 'argon2';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { iso, isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import type { UserRow } from './account.service.js';
import { SessionService } from './session.service.js';

export const USER_SUSPENDED_EVENT = 'user.suspended';
export interface UserSuspendedEvent {
  userId: string;
}

/** Account administration: customer / driver accounts and staff members. */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxService,
  ) {}

  async list(q: AdminUserQuery): Promise<Paginated<AdminUserRow>> {
    const w = pageWindow(q);
    const where: string[] = [`status <> 'deleted'`];
    const params: unknown[] = [];
    if (q.q) {
      params.push(`%${q.q.trim().replace(/[%_]/g, '\\$&')}%`);
      where.push(`(phone ILIKE $${params.length} OR email::text ILIKE $${params.length} OR display_name ILIKE $${params.length})`);
    }
    if (q.role) {
      params.push(q.role);
      where.push(`$${params.length} = ANY(roles)`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    const cond = `WHERE ${where.join(' AND ')}`;
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM users ${cond}`, params);
    const rows = await this.db.query<UserRow>(
      `SELECT * FROM users ${cond} ORDER BY created_at DESC, id LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );
    return paginated(rows.map(toAdminUserRow), total?.n ?? 0, w);
  }

  async suspend(userId: string, reason: string, actor: AuthUser): Promise<AdminUserRow> {
    if (userId === actor.id) throw AppError.conflict('You cannot suspend your own account.');
    return this.db.tx(async () => {
      const user = await this.db.one<UserRow>(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (!user || user.status === UserStatus.Deleted) throw AppError.notFound('User');
      // Staff accounts are managed through the staff endpoints, which need a stronger permission.
      if (user.roles.includes(AccountRole.Admin)) {
        throw AppError.forbidden('Staff accounts are managed from the staff screen by a super administrator.');
      }
      const updated = await this.db.one<UserRow>(
        `UPDATE users SET status = 'suspended', suspended_reason = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [userId, reason],
      );
      await this.sessions.revokeAllForUser(userId, 'suspended');
      // Search already hides listings of non-active accounts; the marketplace also takes the driver offline.
      await this.outbox.publish(USER_SUSPENDED_EVENT, { userId } satisfies UserSuspendedEvent);
      await this.audit.record({ actor, action: 'user.suspended', targetType: 'user', targetId: userId, metadata: { reason } });
      return toAdminUserRow(updated!);
    });
  }

  async reinstate(userId: string, actor: AuthUser): Promise<AdminUserRow> {
    return this.db.tx(async () => {
      const user = await this.db.one<UserRow>(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (!user || user.status === UserStatus.Deleted) throw AppError.notFound('User');
      if (user.roles.includes(AccountRole.Admin)) {
        throw AppError.forbidden('Staff accounts are managed from the staff screen by a super administrator.');
      }
      if (user.status !== UserStatus.Suspended) throw AppError.conflict('This account is not suspended.');
      const updated = await this.db.one<UserRow>(
        `UPDATE users SET status = 'active', suspended_reason = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
        [userId],
      );
      await this.audit.record({ actor, action: 'user.reinstated', targetType: 'user', targetId: userId });
      return toAdminUserRow(updated!);
    });
  }

  async customerCounts(): Promise<{ total: number; newLast7Days: number }> {
    const r = await this.db.one<{ total: number; recent: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS recent
         FROM users WHERE $1 = ANY(roles) AND status <> 'deleted'`,
      [AccountRole.Customer],
    );
    return { total: r?.total ?? 0, newLast7Days: r?.recent ?? 0 };
  }

  // --- staff (super_admin only) ----------------------------------------------------

  async listStaff(): Promise<StaffMember[]> {
    const rows = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE $1 = ANY(roles) AND admin_role IS NOT NULL AND status <> 'deleted' ORDER BY created_at`,
      [AccountRole.Admin],
    );
    return rows.map(toStaff);
  }

  async createStaff(input: CreateStaffRequest, actor: AuthUser): Promise<StaffMember> {
    const email = input.email.trim().toLowerCase();
    return this.db.tx(async () => {
      const exists = await this.db.one(`SELECT 1 FROM users WHERE email = $1`, [email]);
      if (exists) throw AppError.conflict('An account with this email address already exists.');
      const row = await this.db.insert<UserRow>('users', {
        email,
        display_name: input.displayName.trim(),
        roles: [AccountRole.Admin],
        admin_role: input.adminRole,
        password_hash: await argon2.hash(input.temporaryPassword),
      });
      await this.audit.record({
        actor,
        action: 'staff.created',
        targetType: 'user',
        targetId: row.id,
        metadata: { email, adminRole: input.adminRole },
      });
      return toStaff(row);
    });
  }

  async updateStaff(userId: string, input: UpdateStaffRequest, actor: AuthUser): Promise<StaffMember> {
    return this.db.tx(async () => {
      const user = await this.db.one<UserRow>(
        `SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles) AND admin_role IS NOT NULL FOR UPDATE`,
        [userId, AccountRole.Admin],
      );
      if (!user || user.status === UserStatus.Deleted) throw AppError.notFound('Staff member');
      if (userId === actor.id) {
        throw AppError.conflict('You cannot change your own role or status. Ask another super administrator.');
      }
      const demoting = input.adminRole !== undefined && input.adminRole !== AdminRole.SuperAdmin;
      const disabling = input.status === UserStatus.Suspended;
      if (user.admin_role === AdminRole.SuperAdmin && (demoting || disabling)) {
        const others = await this.db.one<{ n: number }>(
          `SELECT count(*)::int AS n FROM users
            WHERE admin_role = $1 AND status = 'active' AND id <> $2`,
          [AdminRole.SuperAdmin, userId],
        );
        if ((others?.n ?? 0) === 0) throw AppError.conflict('At least one active super administrator must remain.');
      }
      const updated = await this.db.update<UserRow>(
        'users',
        { id: userId },
        { admin_role: input.adminRole, status: input.status, updated_at: new Date() },
      );
      // A changed role or a suspension must take effect on the next request.
      if (disabling) await this.sessions.revokeAllForUser(userId, 'staff_suspended');
      await this.audit.record({
        actor,
        action: 'staff.updated',
        targetType: 'user',
        targetId: userId,
        metadata: { adminRole: input.adminRole, status: input.status, previousRole: user.admin_role, previousStatus: user.status },
      });
      return toStaff(updated!);
    });
  }
}

function toAdminUserRow(r: UserRow): AdminUserRow {
  return {
    id: r.id,
    phone: r.phone,
    email: r.email,
    displayName: r.display_name,
    roles: r.roles,
    status: r.status,
    createdAt: isoReq(r.created_at),
    lastSeenAt: iso(r.last_seen_at),
  };
}

function toStaff(r: UserRow): StaffMember {
  return {
    id: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? '',
    adminRole: r.admin_role as AdminRole,
    status: r.status,
    mfaEnabled: r.mfa_enabled,
    lastLoginAt: iso(r.last_login_at),
    createdAt: isoReq(r.created_at),
  };
}
