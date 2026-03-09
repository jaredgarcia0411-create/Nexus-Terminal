export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const DEFAULT_LIMIT_PER_HOUR = 30;
const WINDOW_MS = 3_600_000;

const requestsByUser = new Map<string, number[]>();

function getLimitPerHour() {
  const parsed = Number(process.env.JARVIS_RATE_LIMIT_PER_HOUR);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT_PER_HOUR;
  return Math.floor(parsed);
}

export function checkRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const limit = getLimitPerHour();
  const existing = requestsByUser.get(userId) ?? [];
  const inWindow = existing.filter((timestamp) => now - timestamp < WINDOW_MS);

  if (inWindow.length >= limit) {
    const oldest = inWindow[0] ?? now;
    requestsByUser.set(userId, inWindow);
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldest + WINDOW_MS,
    };
  }

  inWindow.push(now);
  requestsByUser.set(userId, inWindow);
  return {
    allowed: true,
    remaining: limit - inWindow.length,
    resetAt: now + WINDOW_MS,
  };
}

export function getRateLimitState(userId: string): { requestCount: number; windowMs: number; limit: number } {
  const now = Date.now();
  const limit = getLimitPerHour();
  const existing = requestsByUser.get(userId) ?? [];
  const inWindow = existing.filter((timestamp) => now - timestamp < WINDOW_MS);
  requestsByUser.set(userId, inWindow);

  return {
    requestCount: inWindow.length,
    windowMs: WINDOW_MS,
    limit,
  };
}

export function resetRateLimits(): void {
  requestsByUser.clear();
}
