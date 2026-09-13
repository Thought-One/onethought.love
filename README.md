# 一思数据

静态站点 + 免费后台管理系统。文件存于 Cloudflare R2，公告与文件管理通过 Cloudflare Pages Functions 完成。

访问地址：https://thought-one.github.io/onethought.love/（GitHub Pages 仅作静态兜底，无后台）

## 架构

```
浏览器
  ├─ index.html        公开站点：读 api/files 渲染下载列表、读 api/notice 显示公告
  ├─ onemiss/          后台：登录后上传/删除文件、编辑公告（访问 /onemiss）
  └─ functions/        Cloudflare Pages Functions（免费 Serverless 后端）
       ├─ api/login    管理员登录，签发 HMAC 签名 Cookie
       ├─ api/logout   退出登录
       ├─ api/session  查询登录状态
       ├─ api/files    GET 列表 / POST 上传 / DELETE 删除
       ├─ api/notice   GET 读取 / PUT 保存公告
       └─ download/*   从 R2 读取文件并下载（支持断点续传 Range）
  download/            R2 为空时的静态兜底文件与 manifest.json
```

后端未部署时，站点会自动回退到 `download/manifest.json` 与 `files/notice.json`，因此 GitHub Pages 仍可正常浏览。

## 部署到 Cloudflare Pages（推荐，免费）

1. **创建 R2 存储桶**
   - 登录 Cloudflare 控制台 → **R2** → 创建存储桶，名称填 `onethought-downloads`。

2. **创建 Pages 项目**
   - **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，选择本仓库。
   - Framework preset：`None`
   - Build command：留空
   - Build output directory：`/`
   - 注意：仓库中**不要**放置 `wrangler.toml`，否则 Pages 会改用 `wrangler deploy`（Workers 方式）构建并报错。

3. **绑定 R2**
   - Pages 项目 → **Settings → Functions → R2 bucket bindings** → 添加：
     - Variable name：`DOWNLOADS`
     - R2 bucket：`onethought-downloads`

4. **设置环境变量**（Settings → Environment variables，Production 与 Preview 都加）
   - `ADMIN_PASSWORD`：后台登录密码，勾选 **Encrypt**
   - `SESSION_SECRET`：任意足够长的随机字符串，勾选 **Encrypt**

5. 重新部署后，访问 `https://<项目名>.pages.dev/` 即为站点，
   后台地址为 `https://<项目名>.pages.dev/onemiss`（首页不提供任何入口）。

## 后台使用

1. 打开 `/onemiss`，输入 `ADMIN_PASSWORD` 登录。
2. **公告管理**：编辑文本 → 保存，首页立即生效。
3. **上传文件**：选择或拖拽文件，可填写显示名称、存储文件名、描述 → 开始上传。
4. **文件列表**：可复制下载链接或删除文件。

> 单文件上限约 95MB（受 Pages Functions 请求体限制）。更大的文件请使用外链：
> 编辑 `download/links.json` 添加网盘地址，或直接在 `download/meta.json` 维护描述。

## 本地开发

```powershell
# 安装 Wrangler（首次）
npm install -g wrangler

# 复制并填写本地密钥
Copy-Item .dev.vars.example .dev.vars

# 启动本地开发服务器（含 Functions 与 R2 模拟）
wrangler pages dev . --r2=DOWNLOADS=onethought-downloads

# 访问 http://localhost:8788/ 与 http://localhost:8788/onemiss
```

## 静态兜底（可选）

若只想用 GitHub Pages、不部署后端：

- 把文件放进 `download/`，推送后 `.github/workflows/update-download-manifest.yml`
  会自动运行 `scripts/generate-download-manifest.js` 生成 `download/manifest.json`。
- 在 `download/meta.json` 自定义名称/描述，在 `download/links.json` 添加外部链接。
- GitHub Pages 设置：**Settings → Pages**，Branch 选 `main` + `/ (root)`。

## 安全说明

- 密码以环境变量保存，前端永不接触明文；会话 Cookie 为 `HttpOnly + Secure + SameSite=Strict`。
- 登录态使用 HMAC-SHA256 签名，7 天过期。
- 后台页面带 `noindex,nofollow`，不会被搜索引擎收录。
- 不要将 `ADMIN_PASSWORD`、`SESSION_SECRET` 或 `.dev.vars` 提交到仓库。
