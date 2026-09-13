import { isAuthenticated } from '../_utils/auth.js';
import { json, error } from '../_utils/http.js';

const NOTICE_KEY = '_config/notice.json';

export async function onRequestGet({ env }) {
  if (!env.DOWNLOADS) return json({ content: '' });
  try {
    const object = await env.DOWNLOADS.get(NOTICE_KEY);
    if (!object) return json({ content: '' });
    const data = await object.json();
    return json({ content: typeof data.content === 'string' ? data.content : '' });
  } catch (err) {
    return json({ content: '' });
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!env.DOWNLOADS) return error('未绑定 R2 存储桶', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const content = typeof body.content === 'string' ? body.content.slice(0, 2000) : '';
  await env.DOWNLOADS.put(
    NOTICE_KEY,
    JSON.stringify({ content, updatedAt: new Date().toISOString() }),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } },
  );

  return json({ ok: true, content });
}
