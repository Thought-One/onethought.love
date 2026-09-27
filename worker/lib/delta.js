// 三角洲行动 · 每日密码。
// 主源：https://api.s0o1.com/API/sjz/mm
// 备源：https://openapi.dwo.cc/api/sjzmm
// 两者均为公开文本接口，格式略有不同，这里统一解析；上游偶发 522/超时时重试，
// 并在全部失败时用 Cache API 保存的「最近一次成功结果」兜底。
//
// 可选环境变量：DF_SECRET_URL 覆盖为主源地址。

import { json, error } from './http.js';

const SOURCES = [
  'https://api.s0o1.com/API/sjz/mm',
  'https://openapi.dwo.cc/api/sjzmm',
];
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

  let ts = source.match(/更新时间\s*[:：]\s*([^（）()\n]+)/) || source.match(/更新日期\s*[:：]\s*([^\n]+)/);
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

// 带重试的请求：5xx / 网络错误重试，4xx 直接返回
async function requestUpstream(url) {
  const attempts = 2;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/plain, */*' },
        cf: { cacheTtl: 120, cacheEverything: true },
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

function cacheStore() {
  return (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
}

async function readLastGood() {
  const store = cacheStore();
  if (!store) return null;
  try {
    const hit = await store.match(LAST_GOOD_URL);
    if (!hit) return null;
    const data = await hit.json();
    return (data && Array.isArray(data.maps) && data.maps.length) ? data : null;
  } catch (err) {
    return null;
  }
}

async function writeLastGood(payload) {
  const store = cacheStore();
  if (!store) return;
  try {
    await store.put(LAST_GOOD_URL, new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=86400' },
    }));
  } catch (err) {
    // 忽略缓存写入失败
  }
}

export async function onRequestGet({ env }) {
  const custom = env && String(env.DF_SECRET_URL || '').trim();
  const sources = custom ? [custom, ...SOURCES] : SOURCES;

  let text = '';
  let source = '';
  for (const url of sources) {
    try {
      const res = await requestUpstream(url);
      if (!res.ok) continue;
      const body = await readText(res);
      if (parse(body).maps.length) { text = body; source = url; break; }
    } catch (err) {
      // 尝试下一个源
    }
  }

  if (text) {
    const { updatedText, maps } = parse(text);
    const payload = { updatedAt: new Date().toISOString(), updatedText, maps };
    await writeLastGood(payload);
    return json({ configured: true, source: source.indexOf('dwo') >= 0 ? 'dwo' : 's0o1', ...payload });
  }

  // 全部上游失败：用最近一次成功结果兜底
  const cached = await readLastGood();
  if (cached) {
    return json({ configured: true, source: 'cache', stale: true, ...cached });
  }

  return error('每日密码接口暂时不可用（上游超时/522），请稍后重试', 502);
}
