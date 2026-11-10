import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { AccountRole, AdminRole, ErrorCode, UserStatus, type AdminLoginResponse } from '@payana/contracts';
import argon2 from 'argon2';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import { AuditService } from '../../../common/audit/audit.service.js';
import { decrypt, encrypt, randomToken, signPayload, verifyPayload } from '../../../common/crypto.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { ADMIN_LOGIN_POLICY, registerLoginFailure, secondsUntil } from '../domain/auth-rules.js';
import type { UserRow } from './account.service.js';
import { SessionService, type IssuedTokens } from './session.service.js';

interface MfaTokenPayload {
  sub: string;
  purpose: 'admin_mfa';
  exp: number;
}


export type AdminLoginOutcome =
  | { status: 'authenticated'; tokens: IssuedTokens }
  | Exclude<AdminLoginResponse, { status: 'authenticated' }>;

/**
 * Administrator sign-in: email + password, then a TOTP code.
 * MFA is mandatory for `super_admin` (and for every role when
 * ADMIN_MFA_ENFORCE_ALL is on); other roles use it once it is enrolled.
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  /** Verified when the email is unknown, so response time does not reveal which emails exist. */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(randomToken(16));
  }

  constructor(
    private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string): Promise<AdminLoginOutcome> {
    const user = await this.db.one<UserRow>(
      `SELECT * FROM users WHERE email = $1 AND $2 = ANY(roles) AND admin_role IS NOT NULL`,
      [email.trim().toLowerCase(), AccountRole.Admin],
    );
    if (!user || !user.password_hash) {
      await argon2.verify(this.dummyHash, password).catch(() => false);
      await this.audit.record({ actor: { id: null, label: 'unknown' }, action: 'auth.admin_login_failed', metadata: { reason: 'unknown_account' } });
      throw this.invalidCredentials();
    }
    this.assertNotLocked(user);

    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) {
      await this.recordFailure(user, 'bad_password');
      throw this.invalidCredentials();
    }
    if (user.status !== UserStatus.Active) {
      await this.audit.record({ actor: { id: user.id, label: user.email ?? 'admin' }, action: 'auth.admin_login_failed', metadata: { reason: 'suspended' } });
      throw AppError.forbidden('This staff account is suspended.', ErrorCode.AccountSuspended);
    }

    const mfaToken = signPayload(
      { sub: user.id, purpose: 'admin_mfa', exp: Date.now() + ADMIN_LOGIN_POLICY.mfaTokenTtlSeconds * 1000 } satisfies MfaTokenPayload,
      this.config.auth.signingSecret,
    );

    if (user.mfa_enabled && user.mfa_secret_enc) return { status: 'mfa_required', mfaToken };

    if (this.mfaMandatory(user.admin_role)) {
      // Enrolment: issue (or re-issue) a secret; MFA switches on at the first correct code.
      const secret = generateSecret();
      await this.db.exec(`UPDATE users SET mfa_secret_enc = $2, mfa_enabled = false, mfa_last_step = NULL WHERE id = $1`, [
        user.id,
        encrypt(secret, this.config.auth.dataEncryptionKey),
      ]);
      const otpauthUrl = generateURI({ issuer: this.config.appName, label: user.email ?? 'admin', secret });
      return { status: 'mfa_enrollment_required', mfaToken, otpauthUrl, secret };
    }

    await this.db.exec(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [user.id]);
    const tokens = await this.sessions.create(user.id, 'Admin console');
    await this.audit.record({ actor: { id: user.id, label: user.email ?? 'admin' }, action: 'auth.admin_login', metadata: { mfa: false } });
    return { status: 'authenticated', tokens };
  }

  async verifyMfa(mfaToken: string, code: string): Promise<IssuedTokens> {
    const payload = verifyPayload<MfaTokenPayload>(mfaToken, this.config.auth.signingSecret);
    if (!payload || payload.purpose !== 'admin_mfa') {
      throw AppError.tokenExpired('The sign-in attempt has expired. Start again with your email and password.');
    }
    const user = await this.db.one<UserRow>(`SELECT * FROM users WHERE id = $1`, [payload.sub]);
    if (!user || !user.admin_role || !user.mfa_secret_enc) throw AppError.unauthenticated();
    if (user.status !== UserStatus.Active) {
      throw AppError.forbidden('This staff account is suspended.', ErrorCode.AccountSuspended);
    }
    this.assertNotLocked(user);

    const secret = decrypt(user.mfa_secret_enc, this.config.auth.dataEncryptionKey);
    const lastStep = user.mfa_last_step === null ? undefined : Number(user.mfa_last_step);
    const result = await verifyTotp({
      secret,
      token: code,
      // One 30-second step either side for clock drift; `afterTimeStep` blocks replay of a used code.
      epochTolerance: 30,
      ...(lastStep !== undefined ? { afterTimeStep: lastStep } : {}),
    }).catch(() => ({ valid: false as const }));

    if (!result.valid) {
      await this.recordFailure(user, 'bad_mfa_code');
      throw new AppError(401, ErrorCode.MfaInvalid, 'Incorrect code', 'That authenticator code is not correct.');
    }

    const enrolling = !user.mfa_enabled;
    await this.db.exec(
      `UPDATE users SET mfa_enabled = true, mfa_last_step = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1`,
      [user.id, (result as { timeStep: number }).timeStep],
    );
    const tokens = await this.sessions.create(user.id, 'Admin console');
    await this.audit.record({
      actor: { id: user.id, label: user.email ?? 'admin' },
      action: enrolling ? 'auth.admin_mfa_enrolled' : 'auth.admin_login',
      metadata: { mfa: true },
    });
    return tokens;
  }

  private mfaMandatory(role: AdminRole | null): boolean {
    return role === AdminRole.SuperAdmin || this.config.auth.enforceMfaForAllAdmins;
  }

  private assertNotLocked(user: UserRow): void {
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw new AppError(429, ErrorCode.AccountLocked, 'Account locked', 'Too many failed sign-in attempts. Try again later.', {
        retryAfterSeconds: secondsUntil(user.locked_until, new Date()),
      });
    }
  }

  private async recordFailure(user: UserRow, reason: string): Promise<void> {
    const outcome = registerLoginFailure(user.failed_login_count, new Date());
    await this.db.exec(`UPDATE users SET failed_login_count = $2, locked_until = $3 WHERE id = $1`, [
      user.id,
      outcome.failedCount,
      outcome.lockedUntil,
    ]);
    await this.audit.record({
      actor: { id: user.id, label: user.email ?? 'admin' },
      action: outcome.lockedUntil ? 'auth.admin_locked' : 'auth.admin_login_failed',
      metadata: { reason },
    });
  }

  private invalidCredentials(): AppError {
    return new AppError(401, ErrorCode.InvalidCredentials, 'Sign-in failed', 'The email or password is not correct.');
  }
}
