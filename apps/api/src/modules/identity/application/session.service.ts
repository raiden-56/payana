import { Inject, Injectable } from '@nestjs/common';
import type { SessionInfo } from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import { AccessTokenService } from '../../../common/auth/access-token.service.js';
import { randomToken, sha256Hex } from '../../../common/crypto.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { currentRequest } from '../../../common/http/request-context.js';
import { isoReq } from '../../../common/money.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { decideRefresh } from '../domain/auth-rules.js';

export interface IssuedTokens {
  userId: string;
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

interface RefreshRow {
  token_id: string;
  token_expires_at: Date;
  token_used_at: Date | null;
  session_id: string;
  user_id: string;
  session_expires_at: Date;
  session_revoked_at: Date | null;
}

/**
 * Sessions and rotating refresh tokens.
 *
 * A session is one sign-in on one device. Each refresh retires the presented
 * token and issues a new one; presenting a retired token later is treated as
 * theft and ends the session for everyone holding it.
 * Only SHA-256 hashes of refresh tokens are stored.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, deviceLabel: string | null): Promise<IssuedTokens> {
    const ctx = currentRequest();
    const expiresAt = new Date(Date.now() + this.config.auth.refreshTokenTtlDays * 86_400_000);
    return this.db.tx(async () => {
      const session = await this.db.insert<{ id: string }>('auth_sessions', {
        user_id: userId,
        device_label: deviceLabel?.slice(0, 120) ?? null,
        ip: ctx.ip,
        user_agent: ctx.userAgent,
        expires_at: expiresAt,
      });
      await this.db.exec(`UPDATE users SET last_login_at = now(), last_seen_at = now() WHERE id = $1`, [userId]);
      return this.issue(userId, session.id, expiresAt);
    });
  }

  async refresh(rawToken: string | undefined): Promise<IssuedTokens> {
    if (!rawToken) throw AppError.unauthenticated('No refresh token was presented.');
    const hash = sha256Hex(rawToken);
    const outcome = await this.db.tx(async () => {
      const row = await this.db.one<RefreshRow>(
        `SELECT t.id AS token_id, t.expires_at AS token_expires_at, t.used_at AS token_used_at,
                s.id AS session_id, s.user_id, s.expires_at AS session_expires_at, s.revoked_at AS session_revoked_at
           FROM refresh_tokens t JOIN auth_sessions s ON s.id = t.session_id
          WHERE t.token_hash = $1
          FOR UPDATE OF t`,
        [hash],
      );
      if (!row) return { kind: 'unknown' as const };
      const decision = decideRefresh(
        {
          tokenExpiresAt: row.token_expires_at,
          tokenUsedAt: row.token_used_at,
          sessionExpiresAt: row.session_expires_at,
          sessionRevokedAt: row.session_revoked_at,
        },
        new Date(),
      );
      if (decision === 'rotate') {
        await this.db.exec(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [row.token_id]);
        await this.db.exec(`UPDATE auth_sessions SET last_used_at = now() WHERE id = $1`, [row.session_id]);
        const issued = await this.issue(row.user_id, row.session_id, row.session_expires_at);
        return { kind: 'rotated' as const, issued };
      }
      if (decision === 'reuse_revoke_session') {
        await this.db.exec(
          `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'refresh_token_reuse'
            WHERE id = $1 AND revoked_at IS NULL`,
          [row.session_id],
        );
        await this.audit.record({
          actor: { id: row.user_id, label: 'user' },
          action: 'auth.refresh_token_reuse',
          targetType: 'session',
          targetId: row.session_id,
        });
      }
      return { kind: decision };
    });

    if (outcome.kind === 'rotated') return outcome.issued;
    if (outcome.kind === 'reuse_within_grace') {
      throw AppError.tokenExpired('This refresh token was just used. Retry with the new one.');
    }
    throw AppError.tokenExpired('The session has ended. Sign in again.');
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db.exec(
      `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    );
  }

  /** Revokes a session only if it belongs to the user. */
  async revokeOwned(userId: string, sessionId: string): Promise<void> {
    const n = await this.db.exec(
      `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'user_revoked'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
    if (n === 0) throw AppError.notFound('Session');
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.db.exec(
      `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, reason],
    );
  }

  async list(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await this.db.query<{ id: string; device_label: string | null; created_at: Date; last_used_at: Date }>(
      `SELECT id, device_label, created_at, last_used_at FROM auth_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_used_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.device_label,
      createdAt: isoReq(r.created_at),
      lastUsedAt: isoReq(r.last_used_at),
      current: r.id === currentSessionId,
    }));
  }

  private async issue(userId: string, sessionId: string, sessionExpiresAt: Date): Promise<IssuedTokens> {
    const refreshToken = randomToken(48);
    await this.db.insert('refresh_tokens', {
      session_id: sessionId,
      token_hash: sha256Hex(refreshToken),
      expires_at: sessionExpiresAt,
    });
    const access = await this.tokens.sign({ sub: userId, sid: sessionId });
    return {
      userId,
      sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: sessionExpiresAt,
    };
  }
}
