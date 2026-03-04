import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SCHWAB_OAUTH_STATE_COOKIE = 'schwab_oauth_state';
export const SCHWAB_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function generateSchwabOAuthState() {
  return randomBytes(24).toString('base64url');
}

export function statesMatch(expected: string | null | undefined, provided: string | null | undefined) {
  if (!expected || !provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
