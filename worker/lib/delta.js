// 三角洲行动 · 每日密码。
// 数据来源：https://openapi.dwo.cc/api/sjzmm（公开文本接口，无需登录 Cookie）。
// 返回纯文本，形如：
//   更新日期: 09月27日每日密码已更新
//   地图名称: 零号大坝
//   密码: 0079
//   位置描述: ...
//   位置图片:
//     图1: https://img.71acg.net/...
//
// 可选环境变量：DF_SECRET_URL 覆盖数据来源地址。

import { json, error } from './http.js';

const SOURCE_URL = 'https://openapi.dwo.cc/api/sjzmm';

function parse(text) {
  const lines = String(text || '').split(/\r?\n/);
  const maps = [];
  let current = null;
  let updatedText = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let match;
    if ((match = line.match(/^更新日期\s*[:：]\s*(.+)$/))) {
      updatedText = match[1].trim();
      continue;
    }
    if ((match = line.match(/^地图名称\s*[:：]\s*(.+)$/))) {
      current = { mapName: match[1].trim(), secret: '', desc: '', images: [] };
      maps.push(current);
      continue;
    }
    if (!current) continue;
    if ((match = line.match(/^密码\s*[:：]\s*(.+)$/))) {
      current.secret = match[1].trim();
      continue;
    }
    if ((match = line.match(/^位置描述\s*[:：]\s*(.*)$/))) {
      current.desc = match[1].trim();
      continue;
    }
    const url = (line.match(/https?:\/\/[^\s"'<>]+/) || [])[0];
    if (url) current.images.push(url.replace(/[，。；、,;]+$/, ''));
  }

  return { updatedText, maps };
}

export async function onRequestGet({ env }) {
  const url = env && String(env.DF_SECRET_URL || '').trim()
    ? String(env.DF_SECRET_URL).trim()
    : SOURCE_URL;

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/plain, */*' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
  } catch (err) {
    return error('无法连接每日密码接口，请稍后重试', 502);
  }

  if (!upstream.ok) return error(`每日密码接口返回异常 (${upstream.status})`, 502);

  let text = '';
  try {
    text = await upstream.text();
  } catch (err) {
    return error('每日密码接口读取失败', 502);
  }

  const { updatedText, maps } = parse(text);
  if (!maps.length) return error('暂未获取到密码数据，请稍后重试', 502);

  return json({
    configured: true,
    source: 'dwo',
    updatedAt: new Date().toISOString(),
    updatedText,
    maps,
  });
}
