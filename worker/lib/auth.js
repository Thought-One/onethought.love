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

// 创建签名令牌。支持两种调用：
//   createSessionToken(secret, 3600)                        旧式：仅过期时间
//   createSessionToken(secret, { role: 'user', uid }, 3600) 新式：自定义载荷
export async function createSessionToken(secret, payload = {}, maxAgeSeconds = DEFAULT_MAX_AGE) {
  if (typeof payload === 'number') {
    maxAgeSeconds = payload;
    payload = {};
  }
  const body = { ...payload, exp: Date.now() + maxAgeSeconds * 1000 };
  const data = toBase64Url(encoder.encode(JSON.stringify(body)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return `${data}.${toBase64Url(signature)}`;
}

// 校验令牌，成功返回载荷对象，失败返回 null。
export async function verifySessionToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  try {
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const data = JSON.parse(decoder.decode(fromBase64Url(payload)));
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return data;
  } catch (err) {
    return null;
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

function readBearer(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// 后台管理员校验：只接受请求头中的令牌，确保每次进入后台都需要重新登录。
// 用户令牌（role: 'user'）不视为管理员。
export async function isAuthenticated(request, env) {
  if (!env.SESSION_SECRET) return false;
  const token = readBearer(request);
  const data = await verifySessionToken(token, env.SESSION_SECRET);
  return !!data && data.role !== 'user';
}

// 前台用户校验：接受 role: 'user' 的令牌。
export async function getUserAuth(request, env) {
  if (!env.SESSION_SECRET) return null;
  const token = readBearer(request);
  const data = await verifySessionToken(token, env.SESSION_SECRET);
  return data && data.role === 'user' ? data : null;
}
