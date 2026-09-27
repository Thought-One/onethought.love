import { isAuthenticated } from './auth.js';
import { json, error } from './http.js';
import { b2Configured } from './b2.js';
import { readIndex, writeIndex, readFolders, writeFolders, makeFolderId } from './store.js';

function sanitizeName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

export async function onRequestGet({ env }) {
  if (!b2Configured(env)) return json({ folders: [] });
  try {
    return json({ folders: await readFolders(env) });
  } catch (err) {
    return json({ folders: [] });
  }
}

// 新建文件夹（分类）
export async function onRequestPost({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const name = sanitizeName(body.name);
  if (!name) return error('文件夹名称不能为空');

  const folders = await readFolders(env);
  if (folders.some((f) => f.name === name)) return error('已存在同名文件夹');

  const folder = { id: makeFolderId(), name, createdAt: new Date().toISOString() };
  folders.push(folder);

  const res = await writeFolders(env, folders);
  if (!res.ok) return error(`创建失败 (${res.status})`, 502);

  return json({ ok: true, folder, folders });
}

// 重命名文件夹
export async function onRequestPatch({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return error('请求格式错误');
  }

  const id = String(body.id || '').trim();
  const name = sanitizeName(body.name);
  if (!id) return error('缺少 id 参数');
  if (!name) return error('文件夹名称不能为空');

  const folders = await readFolders(env);
  const folder = folders.find((f) => f.id === id);
  if (!folder) return error('文件夹不存在', 404);
  if (folders.some((f) => f.id !== id && f.name === name)) return error('已存在同名文件夹');

  folder.name = name;
  const res = await writeFolders(env, folders);
  if (!res.ok) return error(`保存失败 (${res.status})`, 502);

  return json({ ok: true, folder, folders });
}

// 删除文件夹：其中的文件自动归入“未分类”
export async function onRequestDelete({ request, env }) {
  if (!(await isAuthenticated(request, env))) return error('未登录', 401);
  if (!b2Configured(env)) return error('未配置 Backblaze B2 存储', 500);

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return error('缺少 id 参数');

  const folders = await readFolders(env);
  const next = folders.filter((f) => f.id !== id);
  if (next.length === folders.length) return error('文件夹不存在', 404);

  const res = await writeFolders(env, next);
  if (!res.ok) return error(`删除失败 (${res.status})`, 502);

  const index = await readIndex(env);
  let changed = false;
  for (const key of Object.keys(index)) {
    if (index[key] && index[key].folder === id) {
      delete index[key].folder;
      changed = true;
    }
  }
  if (changed) await writeIndex(env, index);

  return json({ ok: true, folders: next });
}
