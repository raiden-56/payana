/**
 * Pure authentication rules. No I/O: every function takes the facts it needs
 * and returns a decision, so the policy can be unit-tested exhaustively.
 */

export const OTP_POLICY = {
  /** A code is valid for five minutes. */
  ttlSeconds: 300,
  /** Wrong guesses allowed against one code before it is dead. */
  maxVerifyAttempts: 5,
  /** Minimum gap between two codes sent to the same number. */
  resendCooldownSeconds: 30,
  /** Wrong guesses across all codes for one number before the number is locked. */
  lockoutFailedAttempts: 10,
  lockoutWindowSeconds: 900,
} as const;

export const ADMIN_LOGIN_POLICY = {
  maxFailedAttempts: 5,
  lockoutSeconds: 900,
  mfaTokenTtlSeconds: 300,
} as const;

/** Two tabs refreshing at the same instant must not be mistaken for token theft. */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

export interface ChallengeFacts {
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
}

export type ChallengeState = 'usable' | 'expired' | 'consumed' | 'attempts_exceeded';

export function challengeState(c: ChallengeFacts, now: Date): ChallengeState {
  if (c.consumedAt) return 'consumed';
  if (c.attempts >= OTP_POLICY.maxVerifyAttempts) return 'attempts_exceeded';
  if (c.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'usable';
}

export function attemptsRemaining(attemptsSoFar: number): number {
  return Math.max(0, OTP_POLICY.maxVerifyAttempts - attemptsSoFar);
}

export interface RefreshFacts {
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
  sessionExpiresAt: Date;
  sessionRevokedAt: Date | null;
}

export type RefreshDecision =
  /** Issue a new token pair and retire this token. */
  | 'rotate'
  /** Token or session is past its lifetime, or the session was signed out. */
  | 'expired'
  /** Token was retired moments ago by a concurrent refresh: refuse, but do not treat as theft. */
  | 'reuse_within_grace'
  /** A retired token came back: assume it leaked and end the whole session. */
  | 'reuse_revoke_session';

export function decideRefresh(f: RefreshFacts, now: Date): RefreshDecision {
  if (f.sessionRevokedAt) return 'expired';
  if (f.sessionExpiresAt.getTime() <= now.getTime()) return 'expired';
  if (f.tokenUsedAt) {
    const ageSeconds = (now.getTime() - f.tokenUsedAt.getTime()) / 1000;
    return ageSeconds <= REFRESH_REUSE_GRACE_SECONDS ? 'reuse_within_grace' : 'reuse_revoke_session';
  }
  if (f.tokenExpiresAt.getTime() <= now.getTime()) return 'expired';
  return 'rotate';
}

export interface LoginFailureOutcome {
  failedCount: number;
  lockedUntil: Date | null;
}

/** Applies one failed administrator sign-in to the running count. */
export function registerLoginFailure(previousFailures: number, now: Date): LoginFailureOutcome {
  const failedCount = previousFailures + 1;
  if (failedCount >= ADMIN_LOGIN_POLICY.maxFailedAttempts) {
    return { failedCount: 0, lockedUntil: new Date(now.getTime() + ADMIN_LOGIN_POLICY.lockoutSeconds * 1000) };
  }
  return { failedCount, lockedUntil: null };
}

export function secondsUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

/** First name plus the initial of the last name: "Anita Rao" -> "Anita R." */
export function publicAuthorName(displayName: string | null): string {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Payana customer';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

export function firstName(displayName: string | null): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}
