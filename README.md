# showMe · 开发者百宝箱

一个给自己用的开发者工具站：JSON / XML / 各种代码格式化、在线 API 调试（浏览器里的 Postman）、哈希与加解密、编码转换、文本处理、图片工具……共 36 款，界面仿苹果官网风格，带大量动效。

**除「API 调试」通过本机代理转发请求外，所有工具都在浏览器本地运行，不上传任何数据。**

## 亮点

- 🍎 苹果风格：系统字体、毛玻璃导航与下拉面板、大圆角卡片、iOS 分段控件与开关、跟随系统的深浅色（可手动切换）
- ✨ 动效：首页发布会式叙事长页（逐字浮现标题、滚动点亮文案、带实时动画预览的 Bento 网格、跑马灯、分类轨道、3D 键帽），路由过渡、弹簧动画、聚光悬停卡片；尊重系统「减少动态效果」
- ⌘K / Ctrl+K（或 `/`）打开 Spotlight 风格的全局搜索，收藏与最近使用
- 每个工具按需懒加载，重依赖（prettier、CodeMirror 语言包等）不影响首屏

## 工具一览

### 格式化

| 工具 | 说明 |
| --- | --- |
| JSON 格式化 | 格式化、压缩、校验 JSON，精确定位错误行列，树形浏览与键排序。 |
| XML 格式化 | 美化或压缩 XML，校验结构并指出错误位置。 |
| 代码格式化 | JavaScript、TypeScript、CSS、SCSS、Less、HTML、Markdown、YAML、GraphQL 一键美化。 |
| SQL 格式化 | 支持 MySQL、PostgreSQL、SQLite、Oracle 等多种方言，关键字大小写可选。 |

### 转换

| 工具 | 说明 |
| --- | --- |
| JSON ⇄ YAML | JSON 与 YAML 双向互转，保留结构与类型。 |
| JSON ⇄ XML | JSON 与 XML 双向互转，属性、数组与文本节点都能正确处理。 |
| JSON ⇄ CSV | JSON 数组与 CSV / Excel 表格互转，支持嵌套字段展开与表格预览。 |
| JSON 生成类型 | 根据 JSON 样例生成 TypeScript 接口、Go 结构体、Java 类、Rust 结构体等。 |
| 时间戳转换 | Unix 时间戳（秒 / 毫秒）与日期时间互转，支持多时区与相对时间。 |
| 进制转换 | 二、八、十、十六进制及任意进制互转，支持超大整数。 |
| 颜色转换 | HEX、RGB、HSL、OKLCH 互转，取色、生成色阶并检查对比度。 |
| 命名风格转换 | camelCase、PascalCase、snake_case、kebab-case、CONSTANT_CASE 等一键互转。 |
| Cron 表达式 | 用中文解释 Cron 表达式，并列出接下来的执行时间。 |

### 编码解码

| 工具 | 说明 |
| --- | --- |
| Base64 编解码 | 文本与文件的 Base64 编码、解码，支持 URL 安全字符集与中文。 |
| 图片 ⇄ Base64 | 图片转 Data URL / Base64，或把 Base64 还原成图片。 |
| URL 编解码 | URL 编码 / 解码，并把链接拆解成协议、主机、路径与查询参数。 |
| HTML 实体 | HTML 特殊字符与实体（&amp;、&#x4E2D; 等）互相转换。 |
| Unicode 转义 | 中文与 \\uXXXX、&#xXXXX;、UTF-8 字节等编码形式互转。 |
| JWT 解析 | 解码 JWT 的 Header 与 Payload，显示过期时间，并可校验 HS256 签名。 |

### 加密与安全

| 工具 | 说明 |
| --- | --- |
| 哈希计算 | MD5、SHA-1、SHA-256、SHA-512、SHA-3、CRC32 等，文本与文件都能算。 |
| HMAC 签名 | 使用密钥计算 HMAC-MD5 / SHA-1 / SHA-256 / SHA-512 签名。 |
| AES / DES 加解密 | 对称加密与解密，支持 CBC / ECB 等模式、PKCS7 填充、Base64 与 Hex 输出。 |
| RSA 密钥与加解密 | 生成 RSA 密钥对（PEM），用公钥加密、私钥解密。 |
| 密码生成器 | 生成高强度随机密码，评估强度与破解时间。 |
| UUID 生成 | 批量生成 UUID v4 / v7、ULID、NanoID，并可解析 UUID。 |

### 网络与 API

| 工具 | 说明 |
| --- | --- |
| API 调试 | 在线版 Postman：发送任意 HTTP 请求，查看响应、历史记录，导入导出 cURL。 |
| cURL 转代码 | 把 cURL 命令转换成 fetch、axios、Python requests、Go 等代码。 |
| HTTP 状态码 | 所有 HTTP 状态码的中文含义与使用场景速查。 |
| IP 子网计算 | 根据 CIDR 计算网络地址、广播地址、掩码与可用主机范围。 |

### 文本

| 工具 | 说明 |
| --- | --- |
| 文本对比 | 逐行 / 逐词对比两段文本，并排或行内高亮差异。 |
| 正则表达式测试 | 实时高亮匹配、查看分组、测试替换，内置常用正则库。 |
| Markdown 预览 | 所见即所得的 Markdown 实时预览，一键导出 HTML。 |
| 文本处理 | 字数统计、去重、排序、去空行、加行号、大小写等批量处理。 |
| 假数据生成 | 批量生成中文姓名、手机号、邮箱、地址、身份证号等测试数据，导出 JSON / CSV / SQL。 |

### 图片

| 工具 | 说明 |
| --- | --- |
| 二维码 | 生成带颜色与容错级别的二维码，或上传图片识别二维码内容。 |
| 图片压缩 | 本地压缩图片并转换为 JPEG / WebP / PNG，可调质量与尺寸，前后对比。 |

## 本地运行

需要 Node.js 20.19+ 或 22.12+（推荐 22 LTS，见 `.nvmrc`）。用 `node -v` 确认版本，版本太旧时 `npm run dev` 会报 `Unexpected token` 之类的语法错误。

```bash
npm install
npm run dev          # http://localhost:5173
```

其它命令：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm run preview` | 预览生产构建（同样带 `/__proxy` 代理） |
| `npm run typecheck` | TypeScript 检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest 单元测试（`src/lib`、`server`） |
| `npm run e2e` | Playwright 冒烟测试（自动构建并启动 preview） |

## 「API 调试」与本地代理

浏览器直接请求第三方接口通常会被 CORS 拦截，所以开发服务器和 preview 服务器上挂了一个 `/__proxy` 中间件（`server/vite-proxy-plugin.ts`），由 Node 代为发送请求：

- `GET /__proxy/ping` 用于探测代理是否可用；不可用时前端自动退回浏览器直连。
- 只接受同源页面发来的 `application/json` 请求，防止别的网页借用它。
- 只接受来自本机回环地址的请求：即使用 `npm run dev -- --host` 暴露到局域网，其它设备也用不了代理（会自动退回浏览器直连）；确需局域网使用时设置 `SHOWME_PROXY_ALLOW_LAN=1`。
- 借助 Vite 自带的 Host 校验，DNS 重绑定攻击会在进入代理前被拦截（403）。
- **它会替你请求任意地址，只应在本机使用，不要把开发服务器暴露到公网。**
- 转发逻辑 `server/proxy-handler.ts` 与框架无关，以后部署到 Vercel / Cloudflare 时可以直接包成一个 Serverless 函数复用。

## 部署（以后需要时）

`npm run build` 产物是纯静态站点，可以放到任意静态托管（Vercel、Cloudflare Pages、GitHub Pages、Nginx）。注意：

- 没法配置「所有路径回退到 index.html」的托管（如 GitHub Pages、直接打开的静态目录）用 `npm run build:static`：产物在 `dist-static/`，资源用相对路径、路由用 `#/`，放到任何子目录下都能直接打开。

- 这是 SPA，需要把所有路径回退到 `index.html`。
- 静态托管上没有 `/__proxy`，「API 调试」会自动改用浏览器直连（仅能请求允许跨域的接口），除非另外部署代理函数。

## 目录结构

```
server/                  Node 端：/__proxy 转发（与框架无关）+ Vite 插件
src/
  tools/registry.ts      所有工具的唯一登记处（名称、分类、关键词、图标、懒加载组件）
  tools/<id>/index.tsx   每个工具的页面
  lib/*.ts               纯逻辑（可在 Node 中运行，附 *.test.ts）
  components/ui/         按钮、分段控件、开关、HUD 提示等 UI 组件
  components/editor/     CodeMirror 编辑器与输入/输出双栏面板
  components/motion/     动效组件（滚动浮现、聚光卡片、光斑背景、数字滚动）
  pages/                 首页、全部工具、工具详情、404
tests/e2e/               Playwright 冒烟测试
```

## 新增一个工具

1. 在 `src/lib/` 写纯逻辑和单元测试；
2. 在 `src/tools/<id>/index.tsx` 默认导出页面组件（标题栏由工具详情页统一渲染）；
3. 在 `src/tools/registry.ts` 里加一行。

更详细的约定见 [CLAUDE.md](CLAUDE.md)。

## 技术栈

Vite 8 · React 19 · TypeScript · Tailwind CSS 4 · motion · React Router 7 · CodeMirror 6 · cmdk · Lenis · prettier · sql-formatter · js-yaml · fast-xml-parser · papaparse · hash-wasm · crypto-js · jose · diff · marked + DOMPurify · qrcode + jsQR
