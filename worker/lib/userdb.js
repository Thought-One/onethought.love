// 用户数据存储（Cloudflare KV）——不写入 B2 桶。
// 键约定：
//   user:<email>        用户资料 JSON
//   code:<email>        邮箱验证码 { code, tries }（带 TTL）
//   rate:<scope>        频率限制计数（带 TTL）
//   avatars/uid         头像二进制（KV，metadata 记录 mime）

const USER = 'user:';
const CODE = 'code:';
const RATE = 'rate:';
const AVATAR = 'avatars/';

export const USER_TOKEN_TTL = 30 * 24 * 60 * 60; // 用户登录 30 天
export const CODE_TTL = 10 * 60; // 验证码 10 分钟
export const MAX_AVATAR_BYTES = 512 * 1024; // 头像最大 512KB

export function kvReady(env) {
  return !!env.USER_KV;
}

export function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function makeUserId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function readUserByEmail(env, email) {
  if (!env.USER_KV) return null;
  return env.USER_KV.get(USER + email, 'json');
}

export async function writeUser(env, user) {
  await env.USER_KV.put(USER + user.email, JSON.stringify(user));
}

// 对外公开的用户字段（不含邮箱验证等敏感信息）
export function publicUser(user) {
  if (!user) return null;
  let avatar = user.avatar || '';
  if (avatar && !/^https?:\/\//i.test(avatar) && !avatar.startsWith('data:')) {
    avatar = '/api/user/avatar/' + encodeURIComponent(user.id);
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    avatar,
    qq: user.qq || '',
    createdAt: user.createdAt || 0,
  };
}

// ===== 验证码 =====
export async function saveCode(env, email, code) {
  await env.USER_KV.put(
    CODE + email,
    JSON.stringify({ code, tries: 0, createdAt: Date.now() }),
    { expirationTtl: CODE_TTL },
  );
}

export async function readCode(env, email) {
  return env.USER_KV.get(CODE + email, 'json');
}

export async function bumpCodeTries(env, email, rec) {
  const tries = (rec.tries || 0) + 1;
  const age = Math.floor((Date.now() - (rec.createdAt || Date.now())) / 1000);
  const remaining = Math.max(1, CODE_TTL - age);
  await env.USER_KV.put(
    CODE + email,
    JSON.stringify({ code: rec.code, tries, createdAt: rec.createdAt || Date.now() }),
    { expirationTtl: remaining },
  );
  return tries;
}

export async function deleteCode(env, email) {
  await env.USER_KV.delete(CODE + email);
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
