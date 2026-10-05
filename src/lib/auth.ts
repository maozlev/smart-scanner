// Session = a signed expiry timestamp in an httpOnly cookie. Web Crypto only, so the same code
// runs in the proxy and in route handlers.

export const SESSION_COOKIE = 'scanner_session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

async function key(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const toHex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^([0-9a-f]{2})+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function createSessionToken(): Promise<string> {
  const expires = String(Date.now() + SESSION_MAX_AGE_S * 1000);
  const signature = await crypto.subtle.sign('HMAC', await key(), encoder.encode(expires));
  return `${expires}.${toHex(signature)}`;
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token || !process.env.AUTH_SECRET) return false;
  const [expires, signature] = token.split('.');
  const bytes = signature ? fromHex(signature) : null;
  if (!expires || !bytes || !(Number(expires) > Date.now())) return false;
  return crypto.subtle.verify('HMAC', await key(), bytes, encoder.encode(expires));
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE_S,
};
