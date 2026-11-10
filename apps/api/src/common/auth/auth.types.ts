import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccountRole, AdminRole, Permission, UserStatus, VerificationStatus } from '@payana/contracts';
import type { Request } from 'express';

/** The authenticated caller, resolved by JwtAuthGuard on every protected request. */
export interface AuthUser {
  id: string;
  sessionId: string;
  roles: AccountRole[];
  status: UserStatus;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  adminRole: AdminRole | null;
  /** Derived server-side from ADMIN_ROLE_PERMISSIONS; never read from the token. */
  permissions: Permission[];
  driverProfileId: string | null;
  driverVerificationStatus: VerificationStatus | null;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'payana:isPublic';
export const ROLES = 'payana:roles';
export const PERMISSIONS = 'payana:permissions';

/** Marks a route as reachable without authentication. Everything else is denied by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Caller must hold at least one of the listed account roles. */
export const Roles = (...roles: AccountRole[]) => SetMetadata(ROLES, roles);
/** Caller must be an administrator whose role grants every listed permission. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
