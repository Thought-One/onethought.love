// 存储在 B2 上的元数据：文件索引与文件夹（分类）定义。
import { b2GetJson, b2PutJson } from './b2.js';

export const INDEX_KEY = '_config/index.json';
export const FOLDERS_KEY = '_config/folders.json';

export async function readIndex(env) {
  const data = await b2GetJson(env, INDEX_KEY);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

export async function writeIndex(env, index) {
  return b2PutJson(env, INDEX_KEY, index);
}

export async function readFolders(env) {
  const data = await b2GetJson(env, FOLDERS_KEY);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.folders)) return data.folders;
  return [];
}

export async function writeFolders(env, folders) {
  return b2PutJson(env, FOLDERS_KEY, { folders });
}

export function makeFolderId() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
