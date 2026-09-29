// 三角洲行动 · 每日密码（纯后端自动更新）。
// 主源：https://api.s0o1.com/API/sjz/mm
// 备源：https://openapi.dwo.cc/api/sjzmm
//
// 机制：
//   - Cloudflare Cron 每小时（整点）触发 scheduled，后端拉取并写入文件
//     `_config/df-secret.json`（B2），同时写一份 Cache 兜底。
//   - 拉取失败则等待 10 秒重试，最多 3 次；失败不影响已存文件。
//   - /api/df-secret 只读取已存文件返回（无则即时取一次），前端无需刷新。
//
// 可选环境变量：DF_SECRET_URL 覆盖为主源地址。

import { json, error } from './http.js';
import { b2Configured, b2GetJson, b2PutJson } from './b2.js';

const SOURCES = [
  'https://api.s0o1.com/API/sjz/mm',
  'https://openapi.dwo.cc/api/sjzmm',
];
const STORE_KEY = '_config/df-secret.json';
const LAST_GOOD_URL = 'https://onethought.internal/df-secret-lastgood';

// 上游可能返回 UTF-8 或 GBK，这里做兼容解码
async function readText(res) {
  let buf;
  try {
    buf = await res.arrayBuffer();
  } catch (err) {
    return '';
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (err) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch (e) {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}

function parse(text) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);
  const maps = [];
  let current = null;
  let updatedText = '';

  const ts = source.match(/更新时间\s*[:：]\s*([^（）()\n]+)/) || source.match(/更新日期\s*[:：]\s*([^\n]+)/);
  if (ts) updatedText = ts[1].trim();

  const takeUrl = (value) => {
    const url = (String(value || '').match(/https?:\/\/[^\s"'<>]+/) || [])[0];
    return url ? url.replace(/[，。；、,;]+$/, '') : '';
  };
  const newMap = (name) => ({ mapID: maps.length + 1, mapName: name, secret: '', desc: '', images: [] });

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let match;

    // 格式A（s0o1）：以「1. 潮汐监狱」开头
    if ((match = line.match(/^\d+\s*[.、．]\s*(.+)$/))) {
      current = newMap(match[1].trim());
      maps.push(current);
      continue;
    }
    // 格式B（dwo）：「地图名称: 潮汐监狱」
    if ((match = line.match(/^地图名称\s*[:：]\s*(.+)$/))) {
      current = newMap(match[1].trim());
      maps.push(current);
      continue;
    }
    if (!current) continue;

    if ((match = line.match(/^(?:具体点位|位置描述|点位)\s*[:：]\s*(.*)$/))) {
      current.desc = match[1].trim();
      continue;
    }
    if ((match = line.match(/^(?:每日密码|密码)\s*[:：]\s*(.*)$/))) {
      current.secret = match[1].trim();
      continue;
    }
    if ((match = line.match(/^(?:地点图片|位置图片)\s*[:：]\s*(.*)$/))) {
      const url = takeUrl(match[1]);
      if (url) current.images.push(url);
      continue;
    }
    const url = takeUrl(line);
    if (url) current.images.push(url);
  }

  return { updatedText, maps };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestUpstream(url) {
  const attempts = 2;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/plain, */*' },
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      if (res.ok || res.status < 500) return res;
      lastError = Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) await sleep(400);
  }
  throw lastError || new Error('upstream failed');
}

// 依次尝试各数据源，成功返回规范化结果，否则 null
async function fetchFromSources(env) {
  const custom = env && String(env.DF_SECRET_URL || '').trim();
  const sources = custom ? [custom, ...SOURCES] : SOURCES;

  for (const url of sources) {
    try {
      const res = await requestUpstream(url);
      if (!res.ok) continue;
      const body = await readText(res);
      const parsed = parse(body);
      if (parsed.maps.length) {
        return {
          source: url.indexOf('dwo') >= 0 ? 'dwo' : 's0o1',
          updatedAt: new Date().toISOString(),
          updatedText: parsed.updatedText,
          maps: parsed.maps,
        };
      }
    } catch (err) {
      // 尝试下一个源
    }
  }
  return null;
}

function cacheStore() {
  return (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
}

// 写入文件（B2） + Cache 兜底
async function storeResult(env, payload) {
  const record = { updatedAt: payload.updatedAt, updatedText: payload.updatedText, maps: payload.maps };
  if (b2Configured(env)) {
    try { await b2PutJson(env, STORE_KEY, record); } catch (err) { /* 忽略 */ }
  }
  const store = cacheStore();
  if (store) {
    try {
      await store.put(LAST_GOOD_URL, new Response(JSON.stringify(record), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=86400' },
      }));
    } catch (err) { /* 忽略 */ }
  }
}

// 读取已存文件（B2），其次 Cache
async function readStored(env) {
  if (b2Configured(env)) {
    try {
      const data = await b2GetJson(env, STORE_KEY);
      if (data && Array.isArray(data.maps) && data.maps.length) return data;
    } catch (err) { /* 忽略 */ }
  }
  const store = cacheStore();
  if (store) {
    try {
      const hit = await store.match(LAST_GOOD_URL);
      if (hit) {
        const data = await hit.json();
        if (data && Array.isArray(data.maps) && data.maps.length) return data;
      }
    } catch (err) { /* 忽略 */ }
  }
  return null;
}

// 后端定时更新：每小时后端执行；失败等待 10 秒重试，最多 3 次
export async function refreshDeltaSecrets(env) {
  const attempts = 3;
  for (let i = 0; i < attempts; i += 1) {
    const payload = await fetchFromSources(env);
    if (payload) {
      await storeResult(env, payload);
      return payload;
    }
    if (i < attempts - 1) await sleep(10000);
  }
  return null;
}

// 接口只读取已存文件；从未存过则即时取一次并保存
export async function onRequestGet({ env }) {
  const stored = await readStored(env);
  if (stored) {
    return json(Object.assign({ configured: true, source: 'store' }, stored));
  }

  const payload = await fetchFromSources(env);
  if (payload) {
    await storeResult(env, payload);
    return json(Object.assign({ configured: true }, payload));
  }

  return error('每日密码暂不可用，请稍后重试', 502);
}
