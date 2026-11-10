import { Inject, Injectable } from '@nestjs/common';
import {
  AccountRole,
  ErrorCode,
  FeatureFlag,
  OTP_LENGTH,
  UserStatus,
  type OtpChallenge,
  type SignInIntent,
} from '@payana/contracts';
import argon2 from 'argon2';
import { AuditService } from '../../../common/audit/audit.service.js';
import { maskPhone, randomDigits } from '../../../common/crypto.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { currentRequest } from '../../../common/http/request-context.js';
import { RateLimiter } from '../../../common/redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { SettingsService } from '../../platform/application/settings.service.js';
import { OTP_POLICY, challengeState } from '../domain/auth-rules.js';
import type { UserRow } from './account.service.js';
import { SMS_SENDER, type SmsSender } from './ports.js';
import { SessionService, type IssuedTokens } from './session.service.js';

interface ChallengeRow {
  id: string;
  phone: string;
  code_hash: string;
  intent: SignInIntent;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}

export interface OtpSignInResult {
  tokens: IssuedTokens;
  isNewAccount: boolean;
}

/** Phone one-time-code sign-in for customers and drivers. */
@Injectable()
export class OtpAuthService {
  constructor(
    private readonly db: Db,
    private readonly limiter: RateLimiter,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async request(phone: string, intent: SignInIntent): Promise<OtpChallenge> {
    const ip = currentRequest().ip ?? 'unknown';
    await this.assertNotLocked(phone);

    const cooldown = await this.limiter.hit(`otp:cooldown:${phone}`, 1, OTP_POLICY.resendCooldownSeconds);
    if (!cooldown.allowed) {
      throw AppError.rateLimited(cooldown.retryAfterSeconds, 'A code was sent a moment ago. Wait before asking for another.');
    }
    const perPhone = await this.limiter.hit(`otp:phone:${phone}`, this.config.otp.maxRequestsPerPhonePerHour, 3600);
    if (!perPhone.allowed) {
      await this.audit.record({
        actor: { id: null, label: maskPhone(phone) },
        action: 'auth.otp_request_limited',
        metadata: { scope: 'phone' },
      });
      throw AppError.rateLimited(perPhone.retryAfterSeconds, 'Too many codes requested for this number. Try again later.');
    }
    const perIp = await this.limiter.hit(`otp:ip:${ip}`, this.config.otp.maxRequestsPerIpPerHour, 3600);
    if (!perIp.allowed) {
      await this.audit.record({ actor: { id: null, label: 'anonymous' }, action: 'auth.otp_request_limited', metadata: { scope: 'ip' } });
      throw AppError.rateLimited(perIp.retryAfterSeconds, 'Too many codes requested from this network. Try again later.');
    }

    const code = randomDigits(OTP_LENGTH);
    const challenge = await this.db.insert<ChallengeRow>('otp_challenges', {
      phone,
      code_hash: await argon2.hash(code),
      intent,
      expires_at: new Date(Date.now() + OTP_POLICY.ttlSeconds * 1000),
      ip,
    });
    await this.sms.sendOtp(phone, code, OTP_POLICY.ttlSeconds);

    return {
      challengeId: challenge.id,
      expiresInSeconds: OTP_POLICY.ttlSeconds,
      resendAfterSeconds: OTP_POLICY.resendCooldownSeconds,
      ...(this.sms.echoesCodes ? { devCode: code } : {}),
    };
  }

  async verify(input: {
    challengeId: string;
    code: string;
    intent?: SignInIntent;
    deviceLabel?: string;
  }): Promise<OtpSignInResult> {
    const challenge = await this.db.one<ChallengeRow>(`SELECT * FROM otp_challenges WHERE id = $1`, [input.challengeId]);
    if (!challenge) throw new AppError(400, ErrorCode.OtpExpired, 'Code expired', 'Request a new code.');
    await this.assertNotLocked(challenge.phone);

    // Count the attempt first, atomically, so parallel guesses cannot exceed the limit.
    const counted = await this.db.one<ChallengeRow>(
      `UPDATE otp_challenges SET attempts = attempts + 1
        WHERE id = $1 AND consumed_at IS NULL AND attempts < $2 AND expires_at > now()
        RETURNING *`,
      [challenge.id, OTP_POLICY.maxVerifyAttempts],
    );
    if (!counted) {
      const state = challengeState(
        { expiresAt: challenge.expires_at, consumedAt: challenge.consumed_at, attempts: challenge.attempts },
        new Date(),
      );
      if (state === 'attempts_exceeded') {
        throw new AppError(429, ErrorCode.OtpAttemptsExceeded, 'Too many attempts', 'Too many wrong codes. Request a new code.');
      }
      throw new AppError(400, ErrorCode.OtpExpired, 'Code expired', 'This code can no longer be used. Request a new one.');
    }

    const matches = await argon2.verify(counted.code_hash, input.code);
    if (!matches) {
      const failures = await this.limiter.hit(`otp:fail:${challenge.phone}`, OTP_POLICY.lockoutFailedAttempts, OTP_POLICY.lockoutWindowSeconds);
      await this.audit.record({
        actor: { id: null, label: maskPhone(challenge.phone) },
        action: failures.allowed ? 'auth.otp_failed' : 'auth.otp_locked',
        metadata: { attemptsOnCode: counted.attempts },
      });
      if (!failures.allowed) {
        throw new AppError(429, ErrorCode.AccountLocked, 'Sign-in locked', 'Too many wrong codes. Sign-in for this number is paused.', {
          retryAfterSeconds: failures.retryAfterSeconds,
        });
      }
      if (counted.attempts >= OTP_POLICY.maxVerifyAttempts) {
        throw new AppError(429, ErrorCode.OtpAttemptsExceeded, 'Too many attempts', 'Too many wrong codes. Request a new code.');
      }
      throw new AppError(400, ErrorCode.OtpInvalid, 'Incorrect code', 'That code is not correct.');
    }

    const consumed = await this.db.exec(
      `UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
      [challenge.id],
    );
    if (consumed === 0) throw new AppError(400, ErrorCode.OtpExpired, 'Code expired', 'This code was already used.');
    await this.limiter.reset(`otp:fail:${challenge.phone}`);

    const intent = input.intent ?? challenge.intent;
    const { user, isNewAccount } = await this.findOrCreate(challenge.phone, intent);
    if (user.status === UserStatus.Suspended) {
      await this.audit.record({ actor: { id: user.id, label: maskPhone(user.phone) }, action: 'auth.suspended_sign_in_blocked' });
      throw AppError.forbidden('This account is suspended. Contact support.', ErrorCode.AccountSuspended);
    }
    const tokens = await this.sessions.create(user.id, input.deviceLabel ?? null);
    return { tokens, isNewAccount };
  }

  private async assertNotLocked(phone: string): Promise<void> {
    const state = await this.limiter.peek(`otp:fail:${phone}`);
    if (state.hits > OTP_POLICY.lockoutFailedAttempts) {
      throw new AppError(429, ErrorCode.AccountLocked, 'Sign-in locked', 'Too many wrong codes. Sign-in for this number is paused.', {
        retryAfterSeconds: Math.max(state.ttl, 1),
      });
    }
  }

  private async findOrCreate(phone: string, intent: SignInIntent): Promise<{ user: UserRow; isNewAccount: boolean }> {
    return this.db.tx(async () => {
      const existing = await this.db.one<UserRow>(`SELECT * FROM users WHERE phone = $1 FOR UPDATE`, [phone]);
      const wantsDriver = intent === 'driver';
      if (existing) {
        const missing: AccountRole[] = [];
        if (wantsDriver && !existing.roles.includes(AccountRole.Driver)) {
          await this.settings.requireFeature(FeatureFlag.DriverSignUp);
          missing.push(AccountRole.Driver);
        }
        if (!wantsDriver && !existing.roles.includes(AccountRole.Customer)) missing.push(AccountRole.Customer);
        if (missing.length === 0 || existing.status === UserStatus.Suspended) return { user: existing, isNewAccount: false };
        const updated = await this.db.one<UserRow>(
          `UPDATE users SET roles = roles || $2::text[], updated_at = now() WHERE id = $1 RETURNING *`,
          [existing.id, missing],
        );
        await this.audit.record({
          actor: { id: existing.id, label: maskPhone(phone) },
          action: 'account.role_added',
          targetType: 'user',
          targetId: existing.id,
          metadata: { roles: missing },
        });
        return { user: updated!, isNewAccount: false };
      }
      if (wantsDriver) await this.settings.requireFeature(FeatureFlag.DriverSignUp);
      const roles = wantsDriver ? [AccountRole.Customer, AccountRole.Driver] : [AccountRole.Customer];
      // Two verifications racing for a brand-new number: the loser reads the winner's row.
      const created = await this.db.one<UserRow>(
        `INSERT INTO users (phone, roles) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING RETURNING *`,
        [phone, roles],
      );
      if (!created) {
        const row = await this.db.one<UserRow>(`SELECT * FROM users WHERE phone = $1`, [phone]);
        return { user: row!, isNewAccount: false };
      }
      await this.audit.record({
        actor: { id: created.id, label: maskPhone(phone) },
        action: 'account.created',
        targetType: 'user',
        targetId: created.id,
        metadata: { roles },
      });
      return { user: created, isNewAccount: true };
    });
  }
}
