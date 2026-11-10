import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ADMIN_ROLE_PERMISSIONS,
  AccountRole,
  ErrorCode,
  UserStatus,
  type AdminRole,
  type Permission,
  type VerificationStatus,
} from '@payana/contracts';
import type { Redis } from 'ioredis';
import { Db } from '../db/db.service.js';
import { AppError } from '../errors/app-error.js';
import { REDIS } from '../redis/redis.module.js';
import { AccessTokenService } from './access-token.service.js';
import { IS_PUBLIC, PERMISSIONS, ROLES, type AuthUser, type AuthedRequest } from './auth.types.js';

interface AuthRow {
  id: string;
  roles: AccountRole[];
  status: UserStatus;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  admin_role: AdminRole | null;
  session_revoked_at: Date | null;
  session_expires_at: Date;
  driver_profile_id: string | null;
  driver_verification_status: VerificationStatus | null;
}

/**
 * Authentication. Registered globally, so every route is protected unless it
 * is explicitly marked @Public().
 *
 * The access token only proves "this is user U on session S". The account's
 * status, roles and the session's validity are read from the database on each
 * request, which makes sign-out, suspension and role changes immediate.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw AppError.unauthenticated();

    const claims = await this.tokens.verify(header.slice(7).trim());
    if (claims === 'expired') throw AppError.tokenExpired();
    if (claims === 'invalid') throw AppError.unauthenticated('The access token is not valid.');

    const row = await this.db.one<AuthRow>(
      `SELECT u.id, u.roles, u.status, u.display_name, u.phone, u.email, u.admin_role,
              s.revoked_at AS session_revoked_at, s.expires_at AS session_expires_at,
              dp.id AS driver_profile_id, dp.verification_status AS driver_verification_status
         FROM users u
         JOIN auth_sessions s ON s.id = $2 AND s.user_id = u.id
         LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.id = $1`,
      [claims.sub, claims.sid],
    );
    if (!row || row.session_revoked_at || row.session_expires_at.getTime() < Date.now()) {
      throw AppError.tokenExpired('This session has ended. Sign in again.');
    }
    if (row.status === UserStatus.Suspended) {
      throw AppError.forbidden('This account is suspended. Contact support.', ErrorCode.AccountSuspended);
    }
    if (row.status === UserStatus.Deleted) throw AppError.unauthenticated('This account no longer exists.');

    const isAdmin = row.roles.includes(AccountRole.Admin) && row.admin_role !== null;
    const user: AuthUser = {
      id: row.id,
      sessionId: claims.sid,
      roles: row.roles,
      status: row.status,
      displayName: row.display_name,
      phone: row.phone,
      email: row.email,
      adminRole: isAdmin ? row.admin_role : null,
      permissions: isAdmin && row.admin_role ? [...ADMIN_ROLE_PERMISSIONS[row.admin_role]] : [],
      driverProfileId: row.driver_profile_id,
      driverVerificationStatus: row.driver_verification_status,
    };
    req.user = user;
    void this.touchLastSeen(user.id);
    return true;
  }

  /** Records activity at most once every five minutes per user. */
  private async touchLastSeen(userId: string): Promise<void> {
    try {
      const first = await this.redis.set(`seen:${userId}`, '1', 'EX', 300, 'NX');
      if (first === 'OK') await this.db.exec(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]);
    } catch {
      // Activity tracking must never fail a request.
    }
  }
}

/** Enforces @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AccountRole[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw AppError.unauthenticated();
    if (!required.some((r) => user.roles.includes(r))) {
      throw AppError.forbidden('Your account does not have access to this area.');
    }
    return true;
  }
}

/** Enforces @RequirePermission(...): administrators only, and only with the named permissions. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw AppError.unauthenticated();
    if (!user.adminRole || !required.every((p) => user.permissions.includes(p))) {
      throw AppError.forbidden('Your administrator role does not include this permission.');
    }
    return true;
  }
}
