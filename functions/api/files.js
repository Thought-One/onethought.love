import { isAuthenticated } from '../_utils/auth.js';
import { json, error, formatBytes, publicFileUrl } from '../_utils/http.js';

const RESERVED_PREFIX = '_';
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

function isReserved(key) {
  return key.startsWith(RESERVED_PREFIX);
}

function serialize(object) {
  const key = object.key;
  const meta = object.customMetadata || {};
  const uploaded =
    object.uploaded instanceof Date ? object.uploaded.toISOString() : object.uploaded || null;
  return {
    key,
    name: meta.name || key.split('/').pop(),
    desc: meta.desc || '',
    size: object.size,
    sizeText: formatBytes(object.size),
    uploaded,
    url: publicFileUrl(key),
    download: true,
  };
}

function sanitizeKey(raw) {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

export async function onRequestGet({ env }) {
  if (!env.DOWNLOADS) return error('未绑定 R2 存储桶', 500);

  const listed = await env.DOWNLOADS.list({ limit: 1000 });
  const files = listed.objects
    .filter((object) => !isReserved(object.key))
    .map(serialize)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  return json({ files, count: files.length });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!env.DOWNLOADS) return error('未绑定 R2 存储桶', 500);

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return error('请求格式错误');
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return error('未选择文件');
  if (file.size > MAX_UPLOAD_BYTES) {
    return error(`文件超过 ${formatBytes(MAX_UPLOAD_BYTES)}，请改用外链方式。`, 413);
  }

  const key = sanitizeKey(form.get('key') || file.name);
  if (!key) return error('文件名无效');
  if (isReserved(key)) return error('文件名不能以下划线开头');

  const desc = String(form.get('desc') || '').slice(0, 500);
  const displayName = String(form.get('name') || '').slice(0, 200) || key.split('/').pop();

  await env.DOWNLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { name: displayName, desc },
  });

  return json({
    ok: true,
    file: serialize({
      key,
      size: file.size,
      uploaded: new Date(),
      customMetadata: { name: displayName, desc },
    }),
  });
}

export async function onRequestDelete({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!env.DOWNLOADS) return error('未绑定 R2 存储桶', 500);

  const key = sanitizeKey(new URL(request.url).searchParams.get('key'));
  if (!key) return error('缺少 key 参数');
  if (isReserved(key)) return error('不能删除系统文件');

  await env.DOWNLOADS.delete(key);
  return json({ ok: true });
}
