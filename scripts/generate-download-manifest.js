#!/usr/bin/env node
/**
 * 扫描 download/ 文件夹，生成 download/manifest.json。
 * 前端 index.html 读取该清单来渲染下载列表。
 *
 * 可选：download/meta.json 用于自定义显示名称与描述，格式：
 * {
 *   "SkinsRestorer.jar": { "name": "SkinsRestorer 插件", "desc": "Minecraft 皮肤还原插件" }
 * }
 *
 * 可选：download/links.json 用于追加外部链接（网盘等），格式：
 * [
 *   { "name": "Ubuntu 镜像", "url": "https://example.com/x", "desc": "官方镜像" }
 * ]
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const downloadDir = path.join(rootDir, 'download');
const manifestPath = path.join(downloadDir, 'manifest.json');
const metaPath = path.join(downloadDir, 'meta.json');
const linksPath = path.join(downloadDir, 'links.json');

const IGNORED = new Set(['manifest.json', 'meta.json', 'links.json', '.gitkeep', 'README.md']);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function readMeta() {
  return readJson(metaPath, {});
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

if (!fs.existsSync(downloadDir)) {
  console.error(`download 文件夹不存在: ${downloadDir}`);
  process.exit(1);
}

const meta = readMeta();

const files = fs
  .readdirSync(downloadDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => !IGNORED.has(name) && !name.startsWith('.'))
  .sort((a, b) => a.localeCompare(b, 'zh-CN'));

const list = files.map((file) => {
  const stat = fs.statSync(path.join(downloadDir, file));
  const custom = meta[file] || {};
  return {
    name: custom.name || file,
    file,
    url: 'download/' + encodeURIComponent(file),
    size: stat.size,
    sizeText: formatBytes(stat.size),
    desc: custom.desc || '',
    updated: stat.mtime.toISOString(),
  };
});

const extraLinks = (readJson(linksPath, []) || [])
  .filter((item) => item && item.url)
  .map((item) => ({
    name: item.name || item.url,
    url: item.url,
    desc: item.desc || '',
    download: item.download !== false,
    target: item.target || '_blank',
  }));

const all = list.concat(extraLinks);

const manifest = {
  generatedAt: new Date().toISOString(),
  count: all.length,
  files: all,
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`已生成 ${path.relative(rootDir, manifestPath)}，共 ${all.length} 个条目。`);
