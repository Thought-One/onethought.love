// 根据扩展名推断文件类型，用于前台/后台展示对应图标（res/icons/<type>.svg）。
const EXT_TYPES = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', rtf: 'doc', odt: 'doc', pages: 'doc',
  xls: 'xls', xlsx: 'xls', csv: 'xls', ods: 'xls', numbers: 'xls',
  ppt: 'ppt', pptx: 'ppt', odp: 'ppt', key: 'ppt',
  zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip', bz2: 'zip', xz: 'zip', tgz: 'zip',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  svg: 'image', ico: 'image', tif: 'image', tiff: 'image', avif: 'image', heic: 'image', psd: 'image',
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', flv: 'video',
  wmv: 'video', m4v: 'video', mpg: 'video', mpeg: 'video', ts: 'video', rmvb: 'video', '3gp': 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  wma: 'audio', opus: 'audio', mid: 'audio', midi: 'audio', amr: 'audio',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', less: 'css', sass: 'css', styl: 'css',
  js: 'js', mjs: 'js', cjs: 'js', ts: 'js', jsx: 'js', tsx: 'js',
  json: 'json', json5: 'json', map: 'json', webmanifest: 'json',
  txt: 'txt', log: 'txt', md: 'txt', markdown: 'txt', nfo: 'txt', readme: 'txt',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', eot: 'font',
  exe: 'exe', msi: 'exe', dmg: 'exe', deb: 'exe', rpm: 'exe', appimage: 'exe', iso: 'exe', bin: 'exe',
  apk: 'apk', aab: 'apk', ipa: 'apk', xapk: 'apk',
  db: 'db', sqlite: 'db', sqlite3: 'db', sql: 'db', mdb: 'db', accdb: 'db',
  conf: 'config', cfg: 'config', ini: 'config', yaml: 'config', yml: 'config',
  toml: 'config', xml: 'config', env: 'config', properties: 'config', lock: 'config',
  java: 'code', c: 'code', h: 'code', cpp: 'code', cc: 'code', cxx: 'code', hpp: 'code',
  cs: 'code', go: 'code', rs: 'code', py: 'code', rb: 'code', php: 'code', sh: 'code',
  bash: 'code', zsh: 'code', bat: 'code', cmd: 'code', ps1: 'code', lua: 'code',
  kt: 'code', kts: 'code', swift: 'code', dart: 'code', vue: 'code', svelte: 'code',
  scala: 'code', pl: 'code', r: 'code', swiftui: 'code',
};

export function extensionOf(name) {
  const base = String(name || '').split('/').pop().split('?')[0];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function iconType(name, { collection = false, redirect = false } = {}) {
  if (collection) return 'world';
  if (redirect) return 'link';
  return EXT_TYPES[extensionOf(name)] || 'file';
}
