// 用户系统接口：邮箱验证码登录/注册、真人验证、资料与头像。
// 资料存放在 KV（USER_KV），不写入 B2。
import { json, error } from './http.js';
import { createSessionToken, getUserAuth } from './auth.js';
import { mailMode, sendCodeMail } from './mail.js';
import { turnstileEnabled, verifyTurnstile } from './turnstile.js';
import {
  kvReady,
  normalizeEmail,
  validEmail,
  makeUserId,
  readUserByEmail,
  writeUser,
  publicUser,
  saveCode,
  readCode,
  bumpCodeTries,
  deleteCode,
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

// GET /api/user/config —— 前端所需公开配置
export async function onConfig({ env }) {
  return json({
    kvReady: kvReady(env),
    emailMode: mailMode(env),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    turnstileEnabled: turnstileEnabled(env),
  });
}

// POST /api/user/send-code —— 发送邮箱验证码（新邮箱需通过真人验证）
export async function onSendCode({ request, env }) {
  if (!kvReady(env)) return error('用户系统未配置：请在 Cloudflare 创建 KV 命名空间并绑定为 USER_KV。', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const email = normalizeEmail(body && body.email);
  if (!validEmail(email)) return error('请输入有效的邮箱地址');

  const mode = mailMode(env);
  if (mode === 'off') {
    return error('邮件服务未配置：请在 Cloudflare 设置 RESEND_API_KEY（或临时设置 USER_DEV_MODE=1 仅用于测试）。', 503);
  }

  // 频率限制：60 秒 1 次、每小时 5 次（按邮箱）
  if (!(await allowRate(env, `code:${email}:60`, 1, 60))) {
    return error('请求过于频繁，请稍后再试', 429);
  }
  if (!(await allowRate(env, `code:${email}:h`, 5, 3600))) {
    return error('今日验证码次数过多，请稍后再试', 429);
  }

  const existing = await readUserByEmail(env, email);
  const isNew = !existing;

  // 仅在注册（新邮箱）时要求真人验证
  if (isNew && turnstileEnabled(env)) {
    const result = await verifyTurnstile(env, body && body.turnstileToken, clientIp(request));
    if (!result.ok) return json({ error: result.error, needTurnstile: true }, { status: 400 });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await saveCode(env, email, code);

  let sent = false;
  try {
    sent = await sendCodeMail(env, email, code);
  } catch (err) {
    await deleteCode(env, email);
    return error(String((err && err.message) || err), 502);
  }

  const payload = { ok: true, isNew, sent, emailMode: mode };
  if (!sent && mode === 'dev') {
    // 开发模式（USER_DEV_MODE=1）：不真正发信，直接把验证码回传，仅用于测试
    payload.devCode = code;
  }
  return json(payload);
}

// POST /api/user/verify —— 校验验证码，注册/登录并签发用户令牌
export async function onVerify({ request, env }) {
  if (!kvReady(env) || !env.SESSION_SECRET) return error('用户系统未配置', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const email = normalizeEmail(body && body.email);
  const code = String((body && body.code) || '').trim();
  if (!validEmail(email)) return error('请输入有效的邮箱地址');
  if (!/^\d{6}$/.test(code)) return error('请输入 6 位数字验证码');

  const rec = await readCode(env, email);
  if (!rec) return error('验证码已过期，请重新获取');

  if (rec.code !== code) {
    const tries = await bumpCodeTries(env, email, rec);
    if (tries >= 5) {
      await deleteCode(env, email);
      return error('错误次数过多，请重新获取验证码');
    }
    return error('验证码不正确');
  }

  await deleteCode(env, email);

  const now = Date.now();
  let user = await readUserByEmail(env, email);
  if (!user) {
    user = {
      id: makeUserId(),
      email,
      name: email.split('@')[0],
      avatar: '',
      qq: '',
      createdAt: now,
      lastLoginAt: now,
    };
  } else {
    user.lastLoginAt = now;
  }
  await writeUser(env, user);

  const token = await createSessionToken(
    env.SESSION_SECRET,
    { role: 'user', uid: user.id, email: user.email },
    USER_TOKEN_TTL,
  );
  return json({ ok: true, token, user: publicUser(user), expiresIn: USER_TOKEN_TTL });
}

// GET /api/user/me —— 当前登录用户
export async function onMe({ request, env }) {
  if (!kvReady(env)) return json({ user: null, kvReady: false });
  const auth = await getUserAuth(request, env);
  if (!auth) return json({ user: null });
  const user = await readUserByEmail(env, auth.email);
  return json({ user: publicUser(user) });
}

// POST /api/user/qq —— 通过 QQ 号拉取昵称与头像（需登录，避免被当作开放代理）
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

  const user = await readUserByEmail(env, auth.email);
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
    // 已上传过的头像外链切换到别的地址时，清理旧文件
    if (user.avatar && user.avatar.indexOf('/api/user/avatar/') === 0) {
      await deleteAvatar(env, user.id);
    }
    user.avatar = avatar;
  }

  await writeUser(env, user);
  return json({ ok: true, user: publicUser(user) });
}

// GET /api/user/avatar/:uid —— 读取上传的头像
export async function onAvatar({ env, uid }) {
  if (!kvReady(env)) return new Response('Not Found', { status: 404 });
  const id = String(uid || '').trim();
  if (!/^u[a-z0-9]+$/i.test(id)) return new Response('Not Found', { status: 404 });
  const result = await getAvatar(env, id);
  if (!result || !result.value) return new Response('Not Found', { status: 404 });
  const mime = (result.metadata && result.metadata.mime) || 'image/png';
  return new Response(result.value, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
