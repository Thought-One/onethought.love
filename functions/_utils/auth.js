const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = 'ot_session';
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60;

function toBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  let str = value.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionToken(secret, maxAgeSeconds = DEFAULT_MAX_AGE) {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ exp: Date.now() + maxAgeSeconds * 1000 })),
  );
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(token, secret) {
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  try {
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return false;
    const data = JSON.parse(decoder.decode(fromBase64Url(payload)));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch (err) {
    return false;
  }
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = header.match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token, maxAgeSeconds = DEFAULT_MAX_AGE) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function isAuthenticated(request, env) {
  if (!env.SESSION_SECRET) return false;
  const token = readCookie(request, SESSION_COOKIE);
  return verifySessionToken(token, env.SESSION_SECRET);
}
