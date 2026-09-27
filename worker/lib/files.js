import { isAuthenticated } from './auth.js';
import { json, error, formatBytes, publicFileUrl } from './http.js';
import { b2Configured, b2Debug, b2ListAll, b2Put, b2Delete } from './b2.js';
import { iconType } from './filetype.js';
import { readIndex, writeIndex, readFolders } from './store.js';

const RESERVED_PREFIX = '_';
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

function isReserved(key) {
  return key.startsWith(RESERVED_PREFIX);
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(url)) url = 'https://' + url;
    else return '';
  }
  return url;
}

// 解析形如  名称:"网址"  的条目（支持中英文冒号与引号），行尾文字作为介绍
function extractLinks(text) {
  const source = String(text || '');
  const links = [];
  const seen = new Set();
  const re = /([^\n:："“”"'<>]{1,60})\s*[:：]\s*["“]([^"”\n]+)["”][ \t]*([^\n]*)/g;
  let match;
  while ((match = re.exec(source))) {
    const name = match[1].trim().replace(/^[-*\d.、\s]+/, '').trim();
    const url = normalizeUrl(match[2]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ name: name || url, url, desc: match[3].trim().slice(0, 200) });
  }
  return links;
}

// 兜底：没有「名称:"网址"」结构时，取第一个被引号包裹的网址
function extractBareUrl(text) {
  const match = String(text || '').match(/[“"]([^”"\n]+)[”"]/);
  return match ? normalizeUrl(match[1]) : '';
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
  const links = Array.isArray(info.links) ? info.links : [];
  const isCollection = links.length > 1;
  const name = info.name || key.split('/').pop();
  return {
    key,
    name,
    desc: info.desc || '',
    folder: info.folder || '',
    type: iconType(name, { collection: isCollection, redirect: Boolean(redirectUrl) }),
    size,
    sizeText: formatBytes(size),
    uploaded,
    url: publicFileUrl(key),
    download: !redirectUrl && !isCollection,
    redirectUrl,
    links,
  };
}

export async function onRequestGet({ request, env }) {
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  let listed;
  try {
    listed = await b2ListAll(env);
  } catch (err) {
    const message = err.message || '读取存储失败';
    const isAuthError = /InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied|Malformed/i.test(message);
    let hint = '';
    if (isAuthError) {
      const authed = await isAuthenticated(request, env);
      if (authed) {
        hint = ` 请检查 B2 凭据。当前配置：${JSON.stringify(b2Debug(env, true))}`;
      } else {
        hint = ' 存储认证失败，请管理员登录后台查看详细配置诊断。';
      }
    }
    return error(message + hint, 502);
  }

  const [index, folders] = await Promise.all([readIndex(env), readFolders(env)]);
  const files = listed
    .filter((object) => !isReserved(object.key))
    .map((object) => serialize(object.key, index[object.key], object))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  return json({ files, folders, count: files.length });
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
  const folder = String(form.get('folder') || '').trim().slice(0, 60);

  const buffer = await file.arrayBuffer();

  // txt 文件：解析 名称:"网址" 条目。
  // 单个网址 -> 点击直接跳转；多个网址 -> 前台展示为分页列表。
  let links = [];
  if (/\.txt$/i.test(key)) {
    try {
      const text = new TextDecoder('utf-8').decode(buffer);
      links = extractLinks(text);
      if (!links.length) {
        const bare = extractBareUrl(text);
        if (bare) links = [{ name: displayName, url: bare, desc: '' }];
      }
    } catch (err) {
      links = [];
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
  if (folder) entry.folder = folder;
  if (links.length) entry.links = links;
  if (links.length === 1) entry.redirectUrl = links[0].url;
  index[key] = entry;
  await writeIndex(env, index);

  return json({ ok: true, file: serialize(key, entry) });
}

// 修改已有文件的归属文件夹或显示名称
export async function onRequestPatch({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const key = sanitizeKey(body.key);
  if (!key) return error('缺少 key 参数');
  if (isReserved(key)) return error('不能修改系统文件');

  const index = await readIndex(env);
  if (!index[key]) return error('文件不存在', 404);

  if (typeof body.folder === 'string') {
    const folder = body.folder.trim().slice(0, 60);
    if (folder) index[key].folder = folder;
    else delete index[key].folder;
  }
  if (typeof body.name === 'string' && body.name.trim()) {
    index[key].name = body.name.trim().slice(0, 200);
  }

  await writeIndex(env, index);
  return json({ ok: true, file: serialize(key, index[key]) });
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
    await writeIndex(env, index);
  }

  return json({ ok: true });
}
