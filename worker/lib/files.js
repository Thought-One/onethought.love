import { isAuthenticated } from './auth.js';
import { json, error, formatBytes, publicFileUrl } from './http.js';
import { b2Configured, b2ListAll, b2Put, b2Delete, b2GetJson, b2PutJson } from './b2.js';

const INDEX_KEY = '_config/index.json';
const RESERVED_PREFIX = '_';
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

function isReserved(key) {
  return key.startsWith(RESERVED_PREFIX);
}

// 从 txt 内容中提取被中文引号（或英文引号）包裹的网址
function extractRedirectUrl(text) {
  const match = String(text || '').match(/[“"]([^”"\n]+)[”"]/);
  if (!match) return '';
  let url = match[1].trim();
  if (!/^https?:\/\//i.test(url)) {
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(url)) url = 'https://' + url;
    else return '';
  }
  return url;
}

async function readIndex(env) {
  const data = await b2GetJson(env, INDEX_KEY);
  return data && typeof data === 'object' ? data : {};
}

function sanitizeKey(raw) {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function serialize(key, meta, fallback) {
  const info = meta || {};
  const size = Number.isFinite(info.size) ? info.size : (fallback && fallback.size) || 0;
  const uploaded = info.uploaded || (fallback && fallback.lastModified) || null;
  const redirectUrl = info.redirectUrl || '';
  return {
    key,
    name: info.name || key.split('/').pop(),
    desc: info.desc || '',
    size,
    sizeText: formatBytes(size),
    uploaded,
    url: publicFileUrl(key),
    download: !redirectUrl,
    redirectUrl,
  };
}

export async function onRequestGet({ env }) {
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  let listed;
  try {
    listed = await b2ListAll(env);
  } catch (err) {
    return error(err.message || '读取存储失败', 502);
  }

  const index = await readIndex(env);
  const files = listed
    .filter((object) => !isReserved(object.key))
    .map((object) => serialize(object.key, index[object.key], object))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  return json({ files, count: files.length });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

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

  const buffer = await file.arrayBuffer();

  // txt 文件：若内容中有被引号包裹的网址，则点击时直接跳转
  let redirectUrl = '';
  if (/\.txt$/i.test(key)) {
    try {
      redirectUrl = extractRedirectUrl(new TextDecoder('utf-8').decode(buffer));
    } catch (err) {
      redirectUrl = '';
    }
  }

  const putRes = await b2Put(env, key, buffer, file.type || 'application/octet-stream');
  if (!putRes.ok) {
    const text = await putRes.text();
    return error(`上传失败 (${putRes.status}): ${text.slice(0, 200)}`, 502);
  }

  const index = await readIndex(env);
  const entry = {
    name: displayName,
    desc,
    size: file.size,
    uploaded: new Date().toISOString(),
  };
  if (redirectUrl) entry.redirectUrl = redirectUrl;
  index[key] = entry;
  await b2PutJson(env, INDEX_KEY, index);

  return json({ ok: true, file: serialize(key, entry) });
}

export async function onRequestDelete({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  const key = sanitizeKey(new URL(request.url).searchParams.get('key'));
  if (!key) return error('缺少 key 参数');
  if (isReserved(key)) return error('不能删除系统文件');

  const delRes = await b2Delete(env, key);
  if (!delRes.ok && delRes.status !== 404) {
    return error(`删除失败 (${delRes.status})`, 502);
  }

  const index = await readIndex(env);
  if (index[key]) {
    delete index[key];
    await b2PutJson(env, INDEX_KEY, index);
  }

  return json({ ok: true });
}
