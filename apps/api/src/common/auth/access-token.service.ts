import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id - lets a revoked session be rejected before the token expires. */
  sid: string;
}

const ISSUER = 'payana-api';
const AUDIENCE = 'payana-clients';

/**
 * Short-lived signed access tokens. They identify a user and a session and
 * nothing else: roles, status and permissions are read from the database on
 * every request so that a suspension or a role change takes effect at once.
 */
@Injectable()
export class AccessTokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async sign(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const ttl = this.config.auth.accessTokenTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const token = await new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.config.auth.accessTokenSecret);
    return { token, expiresAt };
  }

  /** Returns the claims, or a reason the token cannot be used. */
  async verify(token: string): Promise<AccessTokenClaims | 'expired' | 'invalid'> {
    try {
      const { payload } = await jwtVerify(token, this.config.auth.accessTokenSecret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return 'invalid';
      return { sub: payload.sub, sid: payload.sid };
    } catch (err) {
      return (err as { code?: string }).code === 'ERR_JWT_EXPIRED' ? 'expired' : 'invalid';
    }
  }
}
