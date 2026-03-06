const ITERATIONS = 120_000;
const KEY_LENGTH = 32;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex input');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    material,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS);
  return `v1:${ITERATIONS}:${bytesToHex(salt)}:${bytesToHex(key)}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [version, iterationText, saltHex, keyHex] = String(storedHash ?? '').split(':');
  if (version !== 'v1' || !iterationText || !saltHex || !keyHex) return false;

  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const salt = hexToBytes(saltHex);
  const expected = hexToBytes(keyHex);
  const derived = await deriveKey(password, salt, iterations);
  return timingSafeEqual(expected, derived);
}
