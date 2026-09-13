import { isAuthenticated } from './auth.js';
import { json, error } from './http.js';
import { b2Configured, b2GetJson, b2PutJson } from './b2.js';

const NOTICE_KEY = '_config/notice.json';

export async function onRequestGet({ env }) {
  if (!b2Configured(env)) return json({ content: '' });
  try {
    const data = await b2GetJson(env, NOTICE_KEY);
    return json({ content: data && typeof data.content === 'string' ? data.content : '' });
  } catch (err) {
    return json({ content: '' });
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const content = typeof body.content === 'string' ? body.content.slice(0, 2000) : '';
  const res = await b2PutJson(env, NOTICE_KEY, {
    content,
    updatedAt: new Date().toISOString(),
  });
  if (!res.ok) return error(`保存失败 (${res.status})`, 502);

  return json({ ok: true, content });
}
