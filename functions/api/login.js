import { createSessionToken, safeEqual, sessionCookie } from '../_utils/auth.js';
import { json, error } from '../_utils/http.js';

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return error('后台未配置：请在 Cloudflare 中设置 ADMIN_PASSWORD 与 SESSION_SECRET 环境变量。', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!safeEqual(password, env.ADMIN_PASSWORD)) {
    return error('密码错误', 401);
  }

  const token = await createSessionToken(env.SESSION_SECRET);
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token) } });
}
