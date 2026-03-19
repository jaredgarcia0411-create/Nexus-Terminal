import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a relay auth token (HMAC-SHA256 JWT).
 *
 * Token format: base64url(header).base64url(payload).base64url(signature)
 * Payload: { sub: userId, exp: epochSeconds }
 *
 * Returns { valid: true, userId } on success, { valid: false } on any error.
 * Never throws.
 */
export function validateRelayToken(token: string): { valid: boolean; userId?: string } {
  try {
    const secret = process.env.RELAY_WS_SECRET;
    if (!secret) return { valid: false };

    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [header, payload, signature] = parts;

    const expectedSig = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSig, 'base64url');

    if (sigBuffer.length !== expectedBuffer.length) return { valid: false };
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) return { valid: false };

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
    };

    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    if (!decoded.sub || typeof decoded.sub !== 'string') {
      return { valid: false };
    }

    return { valid: true, userId: decoded.sub };
  } catch {
    return { valid: false };
  }
}
