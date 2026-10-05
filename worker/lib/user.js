// 用户系统接口：账号 + 密码 + 邀请码注册，账号密码登录；资料与头像存 KV，不写入 B2。
import { json, error } from './http.js';
import { createSessionToken, getUserAuth } from './auth.js';
import {
  kvReady,
  normalizeUsername,
  validUsername,
  validPassword,
  makeUserId,
  readUser,
  writeUser,
  publicUser,
  hashPassword,
  verifyPassword,
  allowRate,
  putAvatar,
  getAvatar,
  deleteAvatar,
  USER_TOKEN_TTL,
  MAX_AVATAR_BYTES,
} from './userdb.js';

const QQ_API = 'https://api.s0o1.com/API/qq/nickname';
const ALLOWED_IMAGE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

function issueToken(env, user) {
  return createSessionToken(
    env.SESSION_SECRET,
    { role: 'user', uid: user.id, username: user.username },
    USER_TOKEN_TTL,
  );
}

// GET /api/user/config
export async function onConfig({ env }) {
  return json({ kvReady: kvReady(env) });
}

// POST /api/user/register —— { username, password, invite }
export async function onRegister({ request, env }) {
  if (!kvReady(env) || !env.SESSION_SECRET) return error('用户系统未配置', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const username = normalizeUsername(body && body.username);
  const password = typeof (body && body.password) === 'string' ? body.password : '';
  const invite = String((body && body.invite) || '').trim();

  if (!validUsername(username)) return error('账号需 2-20 位（中文/字母/数字/下划线）');
  if (!validPassword(password)) return error('密码长度需为 6-64 位');

  const expected = String(env.INVITE_CODE || 'ONETHOUGHT').trim().toUpperCase();
  if (invite.toUpperCase() !== expected) return error('邀请码不正确');

  if (!(await allowRate(env, `reg:${clientIp(request)}`, 10, 3600))) {
    return error('注册过于频繁，请稍后再试', 429);
  }

  const existing = await readUser(env, username);
  if (existing) return error('该账号已被注册');

  const now = Date.now();
  const user = {
    id: makeUserId(),
    username,
    name: username,
    avatar: '',
    qq: '',
    pass: await hashPassword(password),
    createdAt: now,
    lastLoginAt: now,
  };
  await writeUser(env, user);

  return json({ ok: true, token: await issueToken(env, user), user: publicUser(user) });
}

// POST /api/user/login —— { username, password }
export async function onLogin({ request, env }) {
  if (!kvReady(env) || !env.SESSION_SECRET) return error('用户系统未配置', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const username = normalizeUsername(body && body.username);
  const password = typeof (body && body.password) === 'string' ? body.password : '';
  if (!username || !password) return error('请输入账号和密码');

  if (!(await allowRate(env, `login:${clientIp(request)}`, 30, 3600))) {
    return error('尝试过于频繁，请稍后再试', 429);
  }

  const user = await readUser(env, username);
  if (!user) return error('账号或密码错误', 401);
  if (!(await verifyPassword(password, user.pass))) return error('账号或密码错误', 401);

  user.lastLoginAt = Date.now();
  await writeUser(env, user);
  return json({ ok: true, token: await issueToken(env, user), user: publicUser(user) });
}

// GET /api/user/me
export async function onMe({ request, env }) {
  if (!kvReady(env)) return json({ user: null, kvReady: false });
  const auth = await getUserAuth(request, env);
  if (!auth) return json({ user: null });
  const user = await readUser(env, auth.username);
  return json({ user: publicUser(user) });
}

// POST /api/user/qq —— 通过 QQ 号拉取昵称与头像（需登录）
export async function onQq({ request, env }) {
  const auth = await getUserAuth(request, env);
  if (!auth) return error('请先登录', 401);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }
  const qq = String((body && body.qq) || '').trim();
  if (!/^\d{5,12}$/.test(qq)) return error('请输入有效的 QQ 号');

  let upstream;
  try {
    upstream = await fetch(`${QQ_API}?qq=${encodeURIComponent(qq)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch (err) {
    return error('无法连接 QQ 接口，请稍后重试', 502);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (err) {
    return error('QQ 接口返回异常', 502);
  }
  if (!data || data.code !== 'success' || !data.data) return error('未找到该 QQ 的昵称或头像');

  const avatar = String(data.data.avatar_url || '').replace(/^http:\/\//i, 'https://');
  return json({ ok: true, qq, nickname: String(data.data.nickname || ''), avatar });
}

// POST /api/user/profile —— 保存昵称与头像（上传 data URL 或外链 URL）
export async function onProfile({ request, env }) {
  if (!kvReady(env)) return error('用户系统未配置', 500);
  const auth = await getUserAuth(request, env);
  if (!auth) return error('请先登录', 401);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const user = await readUser(env, auth.username);
  if (!user) return error('用户不存在', 404);

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 24);
    if (name) user.name = name;
  }
  if (typeof body.qq === 'string' && /^\d{5,12}$/.test(body.qq.trim())) {
    user.qq = body.qq.trim();
  }

  const avatar = typeof body.avatar === 'string' ? body.avatar.trim() : '';
  if (avatar.startsWith('data:')) {
    const match = avatar.match(/^data:(image\/[a-z+]+);base64,([\s\S]+)$/i);
    if (!match) return error('头像格式不支持');
    const mime = match[1].toLowerCase();
    if (!ALLOWED_IMAGE[mime]) return error('头像仅支持 PNG / JPG / WebP / GIF');
    let bytes;
    try {
      bytes = base64ToBytes(match[2]);
    } catch (err) {
      return error('头像数据解析失败');
    }
    if (!bytes.length) return error('头像数据为空');
    if (bytes.length > MAX_AVATAR_BYTES) {
      return error('头像过大，请控制在 ' + Math.round(MAX_AVATAR_BYTES / 1024) + 'KB 以内');
    }
    await putAvatar(env, user.id, bytes, mime);
    user.avatar = '/api/user/avatar/' + encodeURIComponent(user.id);
  } else if (/^https?:\/\//i.test(avatar)) {
    if (avatar.length > 500) return error('头像链接过长');
    if (user.avatar && user.avatar.indexOf('/api/user/avatar/') === 0) {
      await deleteAvatar(env, user.id);
    }
    user.avatar = avatar;
  }

  await writeUser(env, user);
  return json({ ok: true, user: publicUser(user) });
}

// GET /api/user/avatar/:uid
export async function onAvatar({ env, uid }) {
  if (!kvReady(env)) return new Response('Not Found', { status: 404 });
  const id = String(uid || '').trim();
  if (!/^u[a-z0-9]+$/i.test(id)) return new Response('Not Found', { status: 404 });
  const result = await getAvatar(env, id);
  if (!result || !result.value) return new Response('Not Found', { status: 404 });
  const mime = (result.metadata && result.metadata.mime) || 'image/png';
  return new Response(result.value, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' },
  });
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
