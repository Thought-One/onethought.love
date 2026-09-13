# 一思数据

静态站点 + 免费后台管理系统。文件存于 **Backblaze B2**，公告与文件管理通过 **Cloudflare Pages Functions** 完成。

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
       ├─ api/files    GET 列表 / POST 上传 / DELETE 删除（读写 B2）
       ├─ api/notice   GET 读取 / PUT 保存公告（存于 B2）
       ├─ _utils/b2.js B2 的 S3 兼容接口封装（AWS Signature V4）
       └─ download/*   从 B2 读取文件并下载（支持断点续传 Range）
  download/            B2 不可用时的静态兜底文件与 manifest.json
```

后端未部署时，站点会自动回退到 `download/manifest.json` 与 `files/notice.json`，因此 GitHub Pages 仍可正常浏览。

## 特殊功能：txt 文件跳转

上传 `.txt` 文件时，若文件内容中包含**被引号包裹的网址**，例如：

```
官方网站：“https://example.com/page”
```

后台会自动识别该网址并保存。此条目在首页显示为蓝色按钮，**点击直接跳转到该网站**，不再下载文件。

- 支持中文引号 `“...”` 和英文引号 `"..."`。
- 若只写 `“www.bilibili.com”`（不带 http），会自动补全为 `https://`。
- 若引号内不是网址（如 `“普通文字”`），则按普通文件正常下载。

## 部署到 Cloudflare Pages（免费）

### 第一步：注册 Backblaze B2 并创建存储桶

1. 打开 https://www.backblaze.com/cloud-storage 注册账号（**无需信用卡**），完成邮箱验证。
2. 登录后左侧点 **B2 Cloud Storage** → **Buckets** → **Create a Bucket**。
   - Bucket Unique Name：例如 `onethought-downloads`（全局唯一，可加随机后缀）
   - Files in Bucket are：**Private**（保持私有，文件通过本站后端代理访问）
   - 其余默认，点 **Create a Bucket**。
3. 创建后点进该桶，记下 **Endpoint**，形如 `s3.us-west-004.backblazeb2.com`；
   其中 `us-west-004` 就是区域（Region）。

### 第二步：创建应用密钥（Application Key）

1. 左侧点 **Application Keys** → **Add a New Application Key**。
2. 填写：
   - Name of Key：随意，如 `onethought-pages`
   - Allow access to Bucket(s)：选择刚创建的桶
   - Type of Access：**Read and Write**
3. 点 **Create New Key**，页面会显示一次：
   - `keyID`（例如 `005abc...`）
   - `applicationKey`（一长串，**只显示这一次，务必复制保存**）

### 第三步：创建 Cloudflare Pages 项目

1. 登录 https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 授权 GitHub，选择本仓库（`Thought-One/onethought.love`）。
3. 构建设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：**`/`**
4. **Save and Deploy**。
   - 注意：仓库中**不要**放置 `wrangler.toml`，否则 Pages 会改用 `wrangler deploy`（Workers 方式）构建并报错。

### 第四步：配置环境变量

项目 → **Settings → Environment variables**，在 **Production** 和 **Preview** 两个环境都添加：

| 变量名 | 说明 | 示例 | 加密 |
|---|---|---|---|
| `ADMIN_PASSWORD` | 后台登录密码 | 自定义 | ✅ Encrypt |
| `SESSION_SECRET` | 会话签名密钥，任意长随机串 | `f8a3...`（40 位以上） | ✅ Encrypt |
| `B2_ENDPOINT` | B2 的 S3 Endpoint | `s3.us-west-004.backblazeb2.com` | 否 |
| `B2_REGION` | B2 区域（可省略，会自动从 Endpoint 推导） | `us-west-004` | 否 |
| `B2_BUCKET` | 存储桶名称 | `onethought-downloads` | 否 |
| `B2_KEY_ID` | 上一步的 keyID | `005abc...` | ✅ Encrypt |
| `B2_APP_KEY` | 上一步的 applicationKey | `K001...` | ✅ Encrypt |

生成随机串可在 PowerShell 执行：

```powershell
-join ((1..48) | ForEach-Object { [char]((65..90)+(97..122)+(48..57) | Get-Random) })
```

### 第五步：重新部署

回到 **Deployments → Retry deployment**（或再 push 一次），让环境变量生效。

部署完成后：

| 用途 | 地址 |
|---|---|
| 站点首页 | `https://<项目名>.pages.dev/` |
| 后台管理 | `https://<项目名>.pages.dev/onemiss` |
| 文件直链 | `https://<项目名>.pages.dev/download/<文件名>` |

首页**没有**任何后台入口，只有知道 `/onemiss` 才能进入。

## 后台使用

1. 打开 `/onemiss`，输入 `ADMIN_PASSWORD` 登录。
2. **公告管理**：编辑文本 → 保存，首页立即生效。
3. **上传文件**：选择或拖拽文件，可填写显示名称、存储文件名、描述 → 开始上传。
4. **文件列表**：可复制下载链接或删除文件。

> 单文件上限约 95MB（受 Pages Functions 内存限制）。更大的文件请使用外链：
> 编辑 `download/links.json` 添加网盘地址，或直接在 `download/meta.json` 维护描述。

## 本地开发（可选）

```powershell
# 安装 Wrangler（首次）
npm install -g wrangler

# 复制并填写本地密钥（含 B2 信息）
Copy-Item .dev.vars.example .dev.vars

# 启动本地开发服务器（自动加载 .dev.vars）
wrangler pages dev .

# 访问 http://localhost:8788/ 与 http://localhost:8788/onemiss
```

## 静态兜底（可选）

若只想用 GitHub Pages、不部署后端：

- 把文件放进 `download/`，执行 `node scripts/generate-download-manifest.js` 生成 `download/manifest.json`。
- 在 `download/meta.json` 自定义名称/描述，在 `download/links.json` 添加外部链接。
- GitHub Pages 设置：**Settings → Pages**，Branch 选 `main` + `/ (root)`。

## 安全说明

- 密码以环境变量保存，前端永不接触明文；会话 Cookie 为 `HttpOnly + Secure + SameSite=Strict`。
- 登录态使用 HMAC-SHA256 签名，7 天过期。
- B2 桶保持 Private，文件仅能通过本站后端访问。
- 后台页面带 `noindex,nofollow`，不会被搜索引擎收录。
- 不要将 `ADMIN_PASSWORD`、`SESSION_SECRET`、`B2_KEY_ID`、`B2_APP_KEY` 或 `.dev.vars` 提交到仓库。
