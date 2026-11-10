import {
  ADMIN_LOGIN_POLICY,
  OTP_POLICY,
  REFRESH_REUSE_GRACE_SECONDS,
  attemptsRemaining,
  challengeState,
  decideRefresh,
  firstName,
  publicAuthorName,
  registerLoginFailure,
  secondsUntil,
} from './auth-rules.js';

const now = new Date('2026-11-10T10:00:00Z');
const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe('OTP policy', () => {
  const fresh = { expiresAt: at(OTP_POLICY.ttlSeconds), consumedAt: null, attempts: 0 };

  it('a new code is usable', () => {
    expect(challengeState(fresh, now)).toBe('usable');
  });

  it('expires exactly at its expiry time', () => {
    expect(challengeState({ ...fresh, expiresAt: at(1) }, now)).toBe('usable');
    expect(challengeState({ ...fresh, expiresAt: at(0) }, now)).toBe('expired');
    expect(challengeState({ ...fresh, expiresAt: at(-1) }, now)).toBe('expired');
  });

  it('cannot be used twice', () => {
    expect(challengeState({ ...fresh, consumedAt: at(-5) }, now)).toBe('consumed');
  });

  it('is dead after the maximum number of wrong guesses, even if not expired', () => {
    expect(challengeState({ ...fresh, attempts: OTP_POLICY.maxVerifyAttempts - 1 }, now)).toBe('usable');
    expect(challengeState({ ...fresh, attempts: OTP_POLICY.maxVerifyAttempts }, now)).toBe('attempts_exceeded');
  });

  it('counts remaining attempts down to zero and never below', () => {
    expect(attemptsRemaining(0)).toBe(5);
    expect(attemptsRemaining(4)).toBe(1);
    expect(attemptsRemaining(9)).toBe(0);
  });

  it('keeps the documented limits', () => {
    expect(OTP_POLICY).toMatchObject({ ttlSeconds: 300, maxVerifyAttempts: 5, resendCooldownSeconds: 30 });
  });
});

describe('refresh token rotation', () => {
  const live = { tokenExpiresAt: at(3600), tokenUsedAt: null, sessionExpiresAt: at(3600), sessionRevokedAt: null };

  it('rotates an unused token on a live session', () => {
    expect(decideRefresh(live, now)).toBe('rotate');
  });

  it('refuses when the session was signed out or has expired', () => {
    expect(decideRefresh({ ...live, sessionRevokedAt: at(-1) }, now)).toBe('expired');
    expect(decideRefresh({ ...live, sessionExpiresAt: at(-1) }, now)).toBe('expired');
    expect(decideRefresh({ ...live, tokenExpiresAt: at(-1) }, now)).toBe('expired');
  });

  it('treats a token retired moments ago as a concurrent refresh, not theft', () => {
    expect(decideRefresh({ ...live, tokenUsedAt: at(-2) }, now)).toBe('reuse_within_grace');
    expect(decideRefresh({ ...live, tokenUsedAt: at(-REFRESH_REUSE_GRACE_SECONDS) }, now)).toBe('reuse_within_grace');
  });

  it('treats a retired token coming back later as theft and ends the session', () => {
    expect(decideRefresh({ ...live, tokenUsedAt: at(-(REFRESH_REUSE_GRACE_SECONDS + 1)) }, now)).toBe('reuse_revoke_session');
    expect(decideRefresh({ ...live, tokenUsedAt: at(-86_400) }, now)).toBe('reuse_revoke_session');
  });

  it('a revoked session wins over reuse detection', () => {
    expect(decideRefresh({ ...live, tokenUsedAt: at(-600), sessionRevokedAt: at(-1) }, now)).toBe('expired');
  });
});

describe('administrator lockout', () => {
  it('counts failures and locks on the fifth', () => {
    expect(registerLoginFailure(0, now)).toEqual({ failedCount: 1, lockedUntil: null });
    expect(registerLoginFailure(3, now)).toEqual({ failedCount: 4, lockedUntil: null });
    const locked = registerLoginFailure(ADMIN_LOGIN_POLICY.maxFailedAttempts - 1, now);
    expect(locked.failedCount).toBe(0);
    expect(locked.lockedUntil).toEqual(at(ADMIN_LOGIN_POLICY.lockoutSeconds));
  });

  it('reports at least one second until unlock', () => {
    expect(secondsUntil(at(90), now)).toBe(90);
    expect(secondsUntil(at(-5), now)).toBe(1);
  });
});

describe('names shown to other people', () => {
  it('reduces a customer name to first name and initial', () => {
    expect(publicAuthorName('Anita Rao')).toBe('Anita R.');
    expect(publicAuthorName('  Thomas  Kurian Mathew ')).toBe('Thomas M.');
    expect(publicAuthorName('Priya')).toBe('Priya');
    expect(publicAuthorName(null)).toBe('Payana customer');
  });

  it('gives drivers only a first name before a booking exists', () => {
    expect(firstName('Anita Rao')).toBe('Anita');
    expect(firstName('')).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
