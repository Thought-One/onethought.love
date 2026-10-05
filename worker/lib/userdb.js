// 用户数据存储（Cloudflare KV）——不写入 B2。
// 键约定：
//   user:<username小写>   用户资料 JSON（含密码哈希）
//   rate:<scope>          频率限制计数（带 TTL）
//   avatars/<uid>         头像二进制（metadata 记录 mime）

const USER = 'user:';
const RATE = 'rate:';
const AVATAR = 'avatars/';

export const USER_TOKEN_TTL = 30 * 24 * 60 * 60; // 登录 30 天
export const MAX_AVATAR_BYTES = 512 * 1024; // 头像最大 512KB
const PBKDF2_ITER = 50000; // 兼顾安全与 Workers 免费版 CPU 限制（10ms），可自行调高

const encoder = new TextEncoder();

export function kvReady(env) {
  return !!env.USER_KV;
}

export function normalizeUsername(username) {
  return String(username == null ? '' : username).trim();
}

export function validUsername(username) {
  return /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/.test(username);
}

export function validPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 64;
}

export function makeUserId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function userKey(username) {
  return USER + username.toLowerCase();
}

export async function readUser(env, username) {
  if (!env.USER_KV) return null;
  return env.USER_KV.get(userKey(username), 'json');
}

export async function writeUser(env, user) {
  await env.USER_KV.put(userKey(user.username), JSON.stringify(user));
}

// 对外公开的用户字段
export function publicUser(user) {
  if (!user) return null;
  let avatar = user.avatar || '';
  if (avatar && !/^https?:\/\//i.test(avatar) && !avatar.startsWith('data:')) {
    avatar = '/api/user/avatar/' + encodeURIComponent(user.id);
  }
  return {
    id: user.id,
    username: user.username,
    name: user.name || '',
    avatar,
    qq: user.qq || '',
    createdAt: user.createdAt || 0,
  };
}

// ===== 密码（PBKDF2-SHA256） =====
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pbkdf2(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${toBase64(salt)}$${toBase64(bits)}`;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10) || PBKDF2_ITER;
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    const bits = await pbkdf2(password, salt, iterations);
    return bytesEqual(bits, expected);
  } catch (err) {
    return false;
  }
}

// ===== 频率限制：窗口内允许 limit 次 =====
export async function allowRate(env, scope, limit, windowSec) {
  if (!env.USER_KV) return false;
  const key = RATE + scope;
  const current = Number(await env.USER_KV.get(key)) || 0;
  if (current >= limit) return false;
  await env.USER_KV.put(key, String(current + 1), { expirationTtl: windowSec });
  return true;
}

// ===== 头像 =====
export async function putAvatar(env, uid, bytes, mime) {
  await env.USER_KV.put(AVATAR + uid, bytes, { metadata: { mime: mime || 'image/png' } });
}

export async function getAvatar(env, uid) {
  return env.USER_KV.getWithMetadata(AVATAR + uid, 'arrayBuffer');
}

export async function deleteAvatar(env, uid) {
  await env.USER_KV.delete(AVATAR + uid);
}
