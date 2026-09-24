/**
 * HTTP 状态码速查数据与搜索（纯数据 + 纯函数，无 DOM 依赖）。
 * 标准码以 IANA 注册表为准（RFC 9110 及 WebDAV、RFC 6585 等扩展），另附 Nginx / Cloudflare 常见非标准码。
 */

export type StatusClass = 1 | 2 | 3 | 4 | 5

export interface StatusClassInfo {
  id: StatusClass
  range: string
  name: string
  desc: string
  /** CSS 颜色（设计 token 变量） */
  color: string
}

export const STATUS_CLASSES: StatusClassInfo[] = [
  { id: 1, range: '1xx', name: '信息响应', desc: '请求已收到，继续处理', color: 'var(--sys-teal)' },
  {
    id: 2,
    range: '2xx',
    name: '成功',
    desc: '请求已成功接收、理解并处理',
    color: 'var(--sys-green)',
  },
  {
    id: 3,
    range: '3xx',
    name: '重定向',
    desc: '需要客户端进一步操作才能完成请求',
    color: 'var(--sys-indigo)',
  },
  {
    id: 4,
    range: '4xx',
    name: '客户端错误',
    desc: '请求有误或无法被满足',
    color: 'var(--sys-orange)',
  },
  {
    id: 5,
    range: '5xx',
    name: '服务器错误',
    desc: '服务器处理一个看似有效的请求时出错',
    color: 'var(--sys-red)',
  },
]

export interface HttpStatus {
  code: number
  /** 英文原因短语 */
  phrase: string
  /** 中文名 */
  name: string
  /** 含义 */
  desc: string
  /** 典型场景 */
  scenario: string
  /** 开发建议 */
  tip: string
  /** 相关的请求 / 响应头 */
  headers?: string[]
  /** 规范出处 */
  spec: string
  specUrl?: string
  /** RFC 9110 §15.1：默认可被启发式缓存 */
  cacheable?: boolean
  /** deprecated 已废弃；reserved 保留不用；unofficial 非标准（厂商扩展） */
  status?: 'deprecated' | 'reserved' | 'unofficial'
  /** 非标准码的来源 */
  vendor?: string
  /** 额外搜索关键词 */
  keywords?: string[]
}

const rfc9110 = (section: string) => ({
  spec: `RFC 9110 §${section}`,
  specUrl: `https://www.rfc-editor.org/rfc/rfc9110#section-${section}`,
})
const rfc = (n: number, section?: string) => ({
  spec: section ? `RFC ${n} §${section}` : `RFC ${n}`,
  specUrl: `https://www.rfc-editor.org/rfc/rfc${n}`,
})
const CLOUDFLARE_DOC =
  'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/'

const DATA: HttpStatus[] = [
  // ───────── 1xx ─────────
  {
    code: 100,
    phrase: 'Continue',
    name: '继续',
    desc: '服务器已收到请求头，客户端可以继续发送请求体。',
    scenario:
      '上传大文件时客户端先带 Expect: 100-continue 询问，服务器完成鉴权、大小检查后回 100，客户端再发送请求体，避免白白上传。',
    tip: '多数 HTTP 客户端会自动处理。curl 上传超过 1MB 时默认带 Expect 头，遇到不支持的代理会平白多等 1 秒，可用 -H "Expect:" 关闭。',
    headers: ['Expect'],
    ...rfc9110('15.2.1'),
    keywords: ['上传'],
  },
  {
    code: 101,
    phrase: 'Switching Protocols',
    name: '切换协议',
    desc: '服务器同意客户端通过 Upgrade 请求头提出的协议切换。',
    scenario: 'WebSocket 握手（Upgrade: websocket）；HTTP/1.1 明文升级到 h2c。',
    tip: '反向代理（如 Nginx）必须显式转发 Upgrade 与 Connection 头，否则 WebSocket 握手会失败，表现为 400 或连接一直 pending。',
    headers: ['Upgrade', 'Connection', 'Sec-WebSocket-Accept'],
    ...rfc9110('15.2.2'),
    keywords: ['websocket', 'ws', '握手'],
  },
  {
    code: 102,
    phrase: 'Processing',
    name: '处理中',
    desc: 'WebDAV 扩展：服务器已接收请求并正在处理，但尚无响应，用来防止客户端超时。',
    scenario: '早期 WebDAV 中耗时很长的 COPY / MOVE 操作。',
    tip: '已在 RFC 4918 中被移除，新系统不要使用；长任务建议返回 202 + 任务查询地址。',
    ...rfc(2518, '10.1'),
    status: 'deprecated',
    keywords: ['webdav'],
  },
  {
    code: 103,
    phrase: 'Early Hints',
    name: '早期提示',
    desc: '在最终响应之前先发送部分响应头（通常是 Link），让浏览器提前预加载资源或预连接。',
    scenario: '服务端渲染页面需要几百毫秒时，先告诉浏览器去预加载关键 CSS、字体或预连接 CDN 域名。',
    tip: '只放 Link: rel=preload / preconnect；Chrome 103+ 已支持。Cloudflare 等 CDN 可以根据缓存的 Link 头自动发送 103。',
    headers: ['Link'],
    ...rfc(8297),
    keywords: ['预加载', 'preload', 'preconnect', '性能'],
  },

  // ───────── 2xx ─────────
  {
    code: 200,
    phrase: 'OK',
    name: '成功',
    desc: '请求成功。响应体含义取决于方法：GET 返回资源，POST 返回处理结果。',
    scenario: '绝大多数正常的页面与接口请求。',
    tip: '不要出错时也返回 200 再在 JSON 里写 {"code": 500}，这会让缓存、监控告警和自动重试全部失效；请使用恰当的 4xx / 5xx。',
    ...rfc9110('15.3.1'),
    cacheable: true,
    keywords: ['正常', 'ok'],
  },
  {
    code: 201,
    phrase: 'Created',
    name: '已创建',
    desc: '请求成功并创建了新资源。',
    scenario: 'POST /users 创建用户成功；PUT 创建了原本不存在的资源。',
    tip: '在 Location 头返回新资源的 URL，响应体可附上创建后的完整资源，省去客户端再查一次。',
    headers: ['Location'],
    ...rfc9110('15.3.2'),
    keywords: ['新建', 'post'],
  },
  {
    code: 202,
    phrase: 'Accepted',
    name: '已接受',
    desc: '请求已被接受，但尚未处理完成；最终可能成功也可能失败。',
    scenario: '异步任务：提交视频转码、批量导出报表、加入邮件发送队列。',
    tip: '返回一个可查询进度的任务地址（Location 或响应体中的 statusUrl），客户端轮询或通过 Webhook 获取结果。',
    headers: ['Location', 'Retry-After'],
    ...rfc9110('15.3.3'),
    keywords: ['异步', '队列', '任务'],
  },
  {
    code: 203,
    phrase: 'Non-Authoritative Information',
    name: '非权威信息',
    desc: '请求成功，但返回内容被中间的转换代理修改过，与源服务器的 200 响应不同。',
    scenario: '转换代理改写了响应，例如移动网络运营商压缩了图片。',
    tip: '业务 API 基本不会主动使用。',
    ...rfc9110('15.3.4'),
    cacheable: true,
    keywords: ['代理'],
  },
  {
    code: 204,
    phrase: 'No Content',
    name: '无内容',
    desc: '请求成功，但没有响应体。',
    scenario: 'DELETE 成功；PUT / PATCH 更新后无需返回数据；CORS 预检 OPTIONS；埋点上报。',
    tip: '204 不能带响应体。前端不要对 204 调用 response.json()，否则会抛出 “Unexpected end of JSON input”。',
    ...rfc9110('15.3.5'),
    cacheable: true,
    keywords: ['删除', 'delete', '空', 'options', 'cors'],
  },
  {
    code: 205,
    phrase: 'Reset Content',
    name: '重置内容',
    desc: '请求成功，并要求客户端重置文档视图（例如清空表单）。',
    scenario: '表单提交后让用户代理清空输入框，方便继续录入下一条。',
    tip: '浏览器几乎没有实现这一语义，实际很少使用。',
    ...rfc9110('15.3.6'),
  },
  {
    code: 206,
    phrase: 'Partial Content',
    name: '部分内容',
    desc: '服务器成功处理了带 Range 头的范围请求，只返回了部分内容。',
    scenario: '视频拖动进度条播放、断点续传、多线程分段下载。',
    tip: '必须返回 Content-Range；支持范围请求的服务器应在普通 200 响应中声明 Accept-Ranges: bytes。',
    headers: ['Range', 'Content-Range', 'Accept-Ranges', 'If-Range'],
    ...rfc9110('15.3.7'),
    cacheable: true,
    keywords: ['断点续传', '视频', '分片', '下载'],
  },
  {
    code: 207,
    phrase: 'Multi-Status',
    name: '多状态',
    desc: 'WebDAV 扩展：响应体（XML）中分别给出多个独立操作各自的状态码。',
    scenario: 'WebDAV 的 PROPFIND、批量移动 / 删除；部分批处理 API 也借用它表示「各条结果不同」。',
    tip: '部分成功时外层仍是 207，客户端要逐条检查内部状态，不能只看外层。',
    ...rfc(4918, '11.1'),
    keywords: ['webdav', '批量'],
  },
  {
    code: 208,
    phrase: 'Already Reported',
    name: '已报告',
    desc: 'WebDAV 扩展：在 207 响应中，该绑定下的成员前面已经列出过，不再重复枚举。',
    scenario: 'WebDAV 绑定让同一资源在多个路径出现时，避免重复列举或陷入循环。',
    tip: '只出现在 207 响应体内部，普通 API 用不到。',
    ...rfc(5842, '7.1'),
    keywords: ['webdav'],
  },
  {
    code: 226,
    phrase: 'IM Used',
    name: '已应用实例操作',
    desc: '服务器完成了 GET 请求，返回的是对当前实例应用一个或多个实例操作（如 delta 增量编码）后的结果。',
    scenario: 'HTTP 增量编码：只传输与客户端已有版本的差异。',
    tip: '实践中极少见，浏览器不支持。',
    headers: ['A-IM', 'IM', 'Delta-Base'],
    ...rfc(3229, '10.4.1'),
    keywords: ['delta', '增量'],
  },

  // ───────── 3xx ─────────
  {
    code: 300,
    phrase: 'Multiple Choices',
    name: '多种选择',
    desc: '请求的资源有多种表示可选，由用户或客户端从中挑选。',
    scenario: '同一文档有多种语言或格式，服务器无法自动协商。',
    tip: '没有标准化的自动选择方式，实际很少用；如有首选项可放在 Location 头。',
    headers: ['Location'],
    ...rfc9110('15.4.1'),
    cacheable: true,
  },
  {
    code: 301,
    phrase: 'Moved Permanently',
    name: '永久重定向',
    desc: '资源已永久迁移到 Location 指定的新地址。',
    scenario: '网站更换域名、HTTP 跳转 HTTPS、URL 结构调整（搜索引擎权重会转移到新地址）。',
    tip: '浏览器会长期缓存 301，配错了很难撤回，上线前先用 302 验证。历史原因下客户端可能把 POST 改成 GET，需要保持方法请用 308。',
    headers: ['Location'],
    ...rfc9110('15.4.2'),
    cacheable: true,
    keywords: ['跳转', 'seo', 'https', '域名'],
  },
  {
    code: 302,
    phrase: 'Found',
    name: '临时重定向',
    desc: '资源临时位于 Location 指定的地址，之后仍应使用原地址访问。',
    scenario: '未登录时跳到登录页、登录后跳回原页面、A/B 测试分流。',
    tip: '浏览器历史上会把 POST 改成 GET 再跳转：想明确「改用 GET」用 303，想保持方法和请求体用 307。',
    headers: ['Location'],
    ...rfc9110('15.4.3'),
    keywords: ['跳转', '登录'],
  },
  {
    code: 303,
    phrase: 'See Other',
    name: '查看其他位置',
    desc: '让客户端用 GET 请求 Location 指定的另一个 URL 来获取结果。',
    scenario:
      '表单 POST 成功后跳转到结果页（PRG 模式：Post / Redirect / Get），防止刷新时重复提交。',
    tip: '无论原请求是什么方法，跟随 303 时都会改用 GET（HEAD 除外）。',
    headers: ['Location'],
    ...rfc9110('15.4.4'),
    keywords: ['跳转', '表单', 'prg'],
  },
  {
    code: 304,
    phrase: 'Not Modified',
    name: '未修改',
    desc: '条件请求（If-None-Match / If-Modified-Since）命中：资源未变化，客户端可直接使用缓存。',
    scenario: '浏览器协商缓存；CDN 回源校验。',
    tip: '304 不带响应体。需要正确生成 ETag 或 Last-Modified；多台服务器时各节点的 ETag 要一致（例如不要把 inode 算进 ETag）。',
    headers: ['ETag', 'Last-Modified', 'If-None-Match', 'If-Modified-Since', 'Cache-Control'],
    ...rfc9110('15.4.5'),
    keywords: ['缓存', 'etag', '协商缓存'],
  },
  {
    code: 305,
    phrase: 'Use Proxy',
    name: '使用代理',
    desc: '要求通过 Location 指定的代理访问资源。',
    scenario: '无——因存在安全隐患已被废弃，主流浏览器不支持。',
    tip: '不要使用。',
    headers: ['Location'],
    ...rfc9110('15.4.6'),
    status: 'deprecated',
  },
  {
    code: 306,
    phrase: '(Unused)',
    name: '未使用',
    desc: '早期草案中曾表示 Switch Proxy，现已不再使用，编号保留。',
    scenario: '无。',
    tip: '保留编号，不得另作他用。',
    ...rfc9110('15.4.7'),
    status: 'reserved',
  },
  {
    code: 307,
    phrase: 'Temporary Redirect',
    name: '临时重定向（保持方法）',
    desc: '与 302 相同，但明确要求客户端不得改变请求方法和请求体。',
    scenario:
      '接口临时迁移、维护期间把 POST / PUT 临时转发到其他地址；开启 HSTS 后浏览器内部把 http 跳到 https 时也显示为 307。',
    tip: 'API 需要临时重定向非 GET 请求时，用 307 而不是 302。',
    headers: ['Location'],
    ...rfc9110('15.4.8'),
    keywords: ['跳转', 'hsts'],
  },
  {
    code: 308,
    phrase: 'Permanent Redirect',
    name: '永久重定向（保持方法）',
    desc: '与 301 相同，但明确要求客户端不得改变请求方法和请求体。',
    scenario: 'API 版本迁移、永久更换接口地址且需要保留 POST / PUT。',
    tip: '同样会被长期缓存；老旧客户端可能不认识 308，需要兼容时评估影响。',
    headers: ['Location'],
    ...rfc9110('15.4.9'),
    cacheable: true,
    keywords: ['跳转', '迁移'],
  },

  // ───────── 4xx ─────────
  {
    code: 400,
    phrase: 'Bad Request',
    name: '错误请求',
    desc: '请求本身有问题，服务器无法处理：语法错误、参数格式不对、JSON 解析失败等。',
    scenario:
      '请求体 JSON 格式错误、缺少必填参数、参数类型不匹配；部分服务器在 Cookie 过大时也返回 400。',
    tip: '在响应体中说明具体哪个字段有什么问题，推荐 RFC 9457 Problem Details（application/problem+json）。语法正确但业务校验不通过可以用 422。',
    ...rfc9110('15.5.1'),
    keywords: ['参数错误', '格式错误', 'json'],
  },
  {
    code: 401,
    phrase: 'Unauthorized',
    name: '未认证',
    desc: '请求缺少有效的身份认证凭据。名字虽叫 Unauthorized，实际含义是「未认证」。',
    scenario: '未登录、Token 过期或无效、API Key 错误、签名校验失败。',
    tip: '必须返回 WWW-Authenticate 头说明认证方式。前端据此跳转登录或用 Refresh Token 续期；已登录但没有权限应返回 403。',
    headers: ['WWW-Authenticate', 'Authorization'],
    ...rfc9110('15.5.2'),
    keywords: ['登录', 'token', '过期', '鉴权', 'jwt', '认证'],
  },
  {
    code: 402,
    phrase: 'Payment Required',
    name: '需要付款',
    desc: '为未来的数字支付场景保留，目前没有标准化的用法。',
    scenario: '部分 SaaS / API 用它表示额度用尽、订阅过期、需要付费升级。',
    tip: '使用前需与客户端约定语义，并在响应体中说明如何付费。',
    ...rfc9110('15.5.3'),
    keywords: ['付费', '额度', '订阅'],
  },
  {
    code: 403,
    phrase: 'Forbidden',
    name: '禁止访问',
    desc: '服务器理解请求，但拒绝执行。与 401 不同，重新认证也不会改变结果。',
    scenario: '已登录但无权限、IP 被封禁、WAF 拦截、禁止列出目录、CSRF 校验失败、对象存储未授权。',
    tip: '如果不想暴露资源是否存在（例如别人的私有仓库），可以直接返回 404。',
    ...rfc9110('15.5.4'),
    keywords: ['权限', '无权', '拒绝', '封禁', 'waf', 'csrf'],
  },
  {
    code: 404,
    phrase: 'Not Found',
    name: '未找到',
    desc: '服务器找不到请求的资源。',
    scenario:
      'URL 拼写错误、资源已删除、路由不存在；单页应用刷新子路由时服务器没有回退到 index.html。',
    tip: '单页应用需配置 history 回退（如 Nginx try_files $uri /index.html）；确定已永久删除的资源可以用 410。',
    ...rfc9110('15.5.5'),
    cacheable: true,
    keywords: ['找不到', '不存在', '路由', 'spa'],
  },
  {
    code: 405,
    phrase: 'Method Not Allowed',
    name: '方法不允许',
    desc: '资源存在，但不支持当前请求方法。',
    scenario: '对只读接口发 POST、对表单地址发 GET、RESTful 路由没有注册 DELETE。',
    tip: '必须返回 Allow 头列出支持的方法，例如 Allow: GET, HEAD。',
    headers: ['Allow'],
    ...rfc9110('15.5.6'),
    cacheable: true,
    keywords: ['方法', 'get', 'post'],
  },
  {
    code: 406,
    phrase: 'Not Acceptable',
    name: '无法接受',
    desc: '服务器无法生成符合客户端 Accept 系列请求头要求的内容。',
    scenario: '客户端只接受 application/xml，而接口只能返回 JSON。',
    tip: '大多数 API 会直接返回默认格式而不是 406；确实要严格协商时再使用。',
    headers: ['Accept', 'Accept-Language', 'Accept-Encoding'],
    ...rfc9110('15.5.7'),
    keywords: ['内容协商'],
  },
  {
    code: 407,
    phrase: 'Proxy Authentication Required',
    name: '需要代理认证',
    desc: '与 401 类似，但需要先通过代理服务器的认证。',
    scenario: '公司内网的出口代理需要账号密码。',
    tip: '客户端在 Proxy-Authorization 头中带上凭据；npm、git 等工具需要单独配置代理账号。',
    headers: ['Proxy-Authenticate', 'Proxy-Authorization'],
    ...rfc9110('15.5.8'),
    keywords: ['代理'],
  },
  {
    code: 408,
    phrase: 'Request Timeout',
    name: '请求超时',
    desc: '服务器等待客户端发送完整请求的时间过长，决定关闭连接。',
    scenario: '客户端网络很慢或上传中断；空闲的 keep-alive 连接被服务器回收。',
    tip: '客户端可以安全地重试；服务器应同时带上 Connection: close。',
    headers: ['Connection'],
    ...rfc9110('15.5.9'),
    keywords: ['超时'],
  },
  {
    code: 409,
    phrase: 'Conflict',
    name: '冲突',
    desc: '请求与目标资源的当前状态冲突。',
    scenario: '用户名 / 邮箱已被注册、重复创建同一资源、并发编辑产生冲突。',
    tip: '在响应体中说明冲突原因，便于用户解决；基于版本号的乐观锁冲突用 412 更精确。',
    ...rfc9110('15.5.10'),
    keywords: ['重复', '已存在', '并发'],
  },
  {
    code: 410,
    phrase: 'Gone',
    name: '已永久删除',
    desc: '资源曾经存在，但已被永久删除，且没有新的地址。',
    scenario: '已下架的商品页、结束的活动页、已废弃的 API 版本。',
    tip: '比 404 语义更明确，搜索引擎会更快移除索引。',
    ...rfc9110('15.5.11'),
    cacheable: true,
    keywords: ['删除', '下架', '废弃'],
  },
  {
    code: 411,
    phrase: 'Length Required',
    name: '需要长度',
    desc: '服务器要求请求带上 Content-Length 头。',
    scenario: '某些服务器或网关不接受分块传输（Transfer-Encoding: chunked）的请求体。',
    tip: '客户端先计算请求体长度再发送，或确认网关支持 chunked。',
    headers: ['Content-Length'],
    ...rfc9110('15.5.12'),
  },
  {
    code: 412,
    phrase: 'Precondition Failed',
    name: '前置条件失败',
    desc: '请求头中的前置条件（If-Match、If-Unmodified-Since 等）不成立。',
    scenario: '乐观并发控制：带 If-Match: "旧 ETag" 更新资源，但资源已被别人修改过。',
    tip: '客户端应重新获取最新版本，合并修改后再提交，避免覆盖他人的更新。',
    headers: ['If-Match', 'If-Unmodified-Since', 'ETag'],
    ...rfc9110('15.5.13'),
    keywords: ['乐观锁', '并发', 'etag'],
  },
  {
    code: 413,
    phrase: 'Content Too Large',
    name: '请求体过大',
    desc: '请求体超过了服务器愿意或能够处理的大小（旧名 Payload Too Large）。',
    scenario: '上传文件超过 Nginx 的 client_max_body_size（默认 1MB）。',
    tip: '调大 client_max_body_size 或应用框架的上传限制；大文件改用分片上传。临时限制可带 Retry-After。',
    headers: ['Retry-After'],
    ...rfc9110('15.5.14'),
    keywords: ['上传', '文件太大', 'payload too large', 'nginx'],
  },
  {
    code: 414,
    phrase: 'URI Too Long',
    name: 'URI 过长',
    desc: '请求的 URI 超过了服务器能处理的长度。',
    scenario: 'GET 请求把大量数据塞进查询参数；重定向循环让 URL 越来越长。',
    tip: '大量参数改用 POST 请求体；浏览器与服务器对 URL 长度的上限通常在 8KB 左右。',
    ...rfc9110('15.5.15'),
    cacheable: true,
    keywords: ['url', '太长'],
  },
  {
    code: 415,
    phrase: 'Unsupported Media Type',
    name: '不支持的媒体类型',
    desc: '服务器不支持请求体的格式（Content-Type 或 Content-Encoding）。',
    scenario: '接口要求 application/json，却发送了表单编码，或者忘了设置 Content-Type。',
    tip: '检查 fetch / axios 是否设置了 Content-Type: application/json；服务器可用 Accept-Post / Accept-Patch 声明支持的格式。',
    headers: ['Content-Type', 'Content-Encoding', 'Accept-Post', 'Accept-Patch'],
    ...rfc9110('15.5.16'),
    keywords: ['content-type', '格式'],
  },
  {
    code: 416,
    phrase: 'Range Not Satisfiable',
    name: '范围无法满足',
    desc: 'Range 请求的范围超出了资源的实际大小。',
    scenario: '断点续传时本地记录的偏移量大于服务器上的文件大小（文件已被替换）。',
    tip: '响应应带 Content-Range: bytes */总长度，客户端据此从头重新下载。',
    headers: ['Range', 'Content-Range'],
    ...rfc9110('15.5.17'),
    keywords: ['断点续传', '下载'],
  },
  {
    code: 417,
    phrase: 'Expectation Failed',
    name: '预期失败',
    desc: '服务器无法满足 Expect 请求头提出的要求。',
    scenario: '服务器或中间代理不支持 Expect: 100-continue。',
    tip: '客户端去掉 Expect 头后重试即可。',
    headers: ['Expect'],
    ...rfc9110('15.5.18'),
  },
  {
    code: 418,
    phrase: "I'm a teapot",
    name: '我是茶壶',
    desc: '源自 1998 年愚人节的 RFC 2324（超文本咖啡壶控制协议）：茶壶拒绝煮咖啡。RFC 9110 将其保留，不得另作他用。',
    scenario: '彩蛋；也有网站用它回应不想处理的自动化请求。',
    tip: '不要在正式 API 中使用。',
    ...rfc9110('15.5.19'),
    status: 'reserved',
    keywords: ['茶壶', '彩蛋', 'teapot', '愚人节'],
  },
  {
    code: 421,
    phrase: 'Misdirected Request',
    name: '错误定向请求',
    desc: '请求被发到了无法为目标 URI 生成响应的服务器。',
    scenario:
      'HTTP/2 连接复用：多个域名共用证书和 IP，浏览器把 B 域名的请求复用到 A 的连接上，但该服务器并未配置 B。',
    tip: '客户端可以新建连接后重试；服务器端检查证书覆盖的域名、SNI 与 Host 是否一致。',
    ...rfc9110('15.5.20'),
    keywords: ['http2', 'sni', '证书'],
  },
  {
    code: 422,
    phrase: 'Unprocessable Content',
    name: '无法处理的内容',
    desc: '请求格式正确（如 JSON 语法无误），但语义有误，无法处理。',
    scenario: '表单校验失败：邮箱格式不对、密码太短、结束日期早于开始日期。',
    tip: 'Rails、Laravel、FastAPI 等框架默认用 422 返回校验错误；在响应体中按字段列出错误信息。',
    ...rfc9110('15.5.21'),
    keywords: ['校验', '验证', 'validation', '表单'],
  },
  {
    code: 423,
    phrase: 'Locked',
    name: '已锁定',
    desc: 'WebDAV 扩展：目标资源已被锁定。',
    scenario: 'WebDAV 文件正被其他用户锁定编辑。',
    tip: '等待锁释放或联系持有锁的用户。',
    ...rfc(4918, '11.3'),
    keywords: ['webdav', '锁'],
  },
  {
    code: 424,
    phrase: 'Failed Dependency',
    name: '依赖失败',
    desc: 'WebDAV 扩展：因为所依赖的另一个操作失败，本操作也无法执行。',
    scenario: 'WebDAV 批量操作（如 PROPPATCH）中前一步失败，后续步骤全部返回 424。',
    tip: '先定位并修复最早失败的那一步。',
    ...rfc(4918, '11.4'),
    keywords: ['webdav'],
  },
  {
    code: 425,
    phrase: 'Too Early',
    name: '过早',
    desc: '服务器不愿处理可能被重放的请求。',
    scenario: 'TLS 1.3 的 0-RTT 早期数据：非幂等请求存在被重放的风险，服务器要求握手完成后再发送。',
    tip: '客户端在完整握手后自动重试即可。',
    ...rfc(8470, '5.2'),
    keywords: ['0-rtt', 'tls', '重放'],
  },
  {
    code: 426,
    phrase: 'Upgrade Required',
    name: '需要升级协议',
    desc: '服务器拒绝用当前协议处理请求，要求客户端升级到 Upgrade 头中指定的协议。',
    scenario: '服务器要求改用 TLS 或更新的 HTTP 版本。',
    tip: '必须返回 Upgrade 头说明需要的协议。',
    headers: ['Upgrade'],
    ...rfc9110('15.5.22'),
  },
  {
    code: 428,
    phrase: 'Precondition Required',
    name: '需要前置条件',
    desc: '服务器要求请求必须是条件请求（如带 If-Match），以避免「丢失更新」。',
    scenario: '强制客户端在更新资源时带上 ETag，实现乐观锁。',
    tip: '在响应体中说明需要哪个条件头。',
    headers: ['If-Match', 'If-Unmodified-Since'],
    ...rfc(6585, '3'),
    keywords: ['乐观锁'],
  },
  {
    code: 429,
    phrase: 'Too Many Requests',
    name: '请求过多',
    desc: '客户端在给定时间内发送了太多请求，被限流。',
    scenario: 'API 限流、登录接口防暴力破解、爬虫被限速。',
    tip: '返回 Retry-After 告诉客户端多久后再试；客户端应做指数退避。常配合 X-RateLimit-Limit / Remaining / Reset 头告知配额。',
    headers: ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    ...rfc(6585, '4'),
    keywords: ['限流', '频率', 'rate limit', 'throttle', '爬虫'],
  },
  {
    code: 431,
    phrase: 'Request Header Fields Too Large',
    name: '请求头过大',
    desc: '请求头整体或某个字段太大，服务器不愿处理。',
    scenario: 'Cookie 越积越多、超长的 Authorization 或 Referer。',
    tip: '清理多余 Cookie；Node.js 默认请求头上限 16KB（--max-http-header-size），Nginx 可调 large_client_header_buffers。',
    ...rfc(6585, '5'),
    keywords: ['cookie', 'header', '太大'],
  },
  {
    code: 451,
    phrase: 'Unavailable For Legal Reasons',
    name: '因法律原因不可用',
    desc: '由于法律要求（如政府审查、版权投诉），服务器无法提供该资源。编号致敬小说《华氏 451》。',
    scenario: '内容因 DMCA 版权投诉或地区法律被屏蔽。',
    tip: '可用 Link: <…>; rel="blocked-by" 指明实施封锁的实体。',
    headers: ['Link'],
    ...rfc(7725, '3'),
    keywords: ['法律', '审查', '版权', 'dmca'],
  },

  // ───────── 5xx ─────────
  {
    code: 500,
    phrase: 'Internal Server Error',
    name: '服务器内部错误',
    desc: '服务器遇到意外情况，无法完成请求。',
    scenario: '未捕获的异常、空指针、数据库查询出错、配置错误。',
    tip: '不要把堆栈信息返回给客户端（有安全风险），返回一个请求 ID（如 X-Request-ID）方便在日志中定位。',
    ...rfc9110('15.6.1'),
    keywords: ['异常', '报错', 'bug', 'exception'],
  },
  {
    code: 501,
    phrase: 'Not Implemented',
    name: '未实现',
    desc: '服务器不支持完成请求所需的功能，例如无法识别该请求方法。',
    scenario: '服务器不支持的 HTTP 方法；功能尚未开发。',
    tip: '与 405 的区别：405 是「这个资源」不支持该方法，501 是「整个服务器」都不支持。',
    ...rfc9110('15.6.2'),
    cacheable: true,
    keywords: ['未开发'],
  },
  {
    code: 502,
    phrase: 'Bad Gateway',
    name: '网关错误',
    desc: '作为网关或代理的服务器从上游服务器收到了无效响应。',
    scenario: 'Nginx 后面的应用进程崩溃或未启动、端口配错、上游返回了非法的 HTTP 响应。',
    tip: '查看 Nginx error.log 中的 “connect() failed” 或 “upstream prematurely closed connection”；确认后端在运行且监听的地址端口正确。',
    ...rfc9110('15.6.3'),
    keywords: ['nginx', 'upstream', '上游', '网关', '后端挂了'],
  },
  {
    code: 503,
    phrase: 'Service Unavailable',
    name: '服务不可用',
    desc: '服务器暂时无法处理请求，通常是过载或停机维护。',
    scenario: '发布维护中、服务过载、熔断降级、Kubernetes 中没有就绪的 Pod。',
    tip: '带上 Retry-After 头。维护页返回 503 而不是 200，可以避免搜索引擎把维护页收录进索引。',
    headers: ['Retry-After'],
    ...rfc9110('15.6.4'),
    keywords: ['维护', '过载', '熔断', '降级', 'k8s'],
  },
  {
    code: 504,
    phrase: 'Gateway Timeout',
    name: '网关超时',
    desc: '网关或代理没有在规定时间内收到上游服务器的响应。',
    scenario: '后端慢查询、调用第三方接口超时、Nginx proxy_read_timeout（默认 60 秒）过短。',
    tip: '优化慢接口，或改为异步任务 + 202；必要时调大代理超时时间。',
    ...rfc9110('15.6.5'),
    keywords: ['超时', 'timeout', 'nginx', '网关'],
  },
  {
    code: 505,
    phrase: 'HTTP Version Not Supported',
    name: 'HTTP 版本不支持',
    desc: '服务器不支持请求所使用的 HTTP 主版本。',
    scenario: '用 HTTP/2 或 HTTP/3 访问只支持 HTTP/1.x 的老旧服务器，或请求行版本号写错。',
    tip: '响应体中应说明服务器支持哪些协议。',
    ...rfc9110('15.6.6'),
  },
  {
    code: 506,
    phrase: 'Variant Also Negotiates',
    name: '变体也在协商',
    desc: '服务器的透明内容协商配置有误：选中的变体自身也被配置为要进行协商，形成循环。',
    scenario: 'Apache 等服务器的内容协商（type-map）配置错误。',
    tip: '属于服务器配置问题，客户端无法修复。',
    ...rfc(2295, '8.1'),
  },
  {
    code: 507,
    phrase: 'Insufficient Storage',
    name: '存储空间不足',
    desc: 'WebDAV 扩展：服务器无法存储完成请求所需的内容。',
    scenario: '网盘 / WebDAV 空间已满、服务器磁盘写满。',
    tip: '清理空间或扩容；客户端可提示用户存储已满。',
    ...rfc(4918, '11.5'),
    keywords: ['webdav', '磁盘', '空间'],
  },
  {
    code: 508,
    phrase: 'Loop Detected',
    name: '检测到循环',
    desc: 'WebDAV 扩展：服务器处理 Depth: infinity 的请求时检测到无限循环。',
    scenario: 'WebDAV 绑定互相引用形成环。',
    tip: '检查资源之间的绑定关系。',
    ...rfc(5842, '7.2'),
    keywords: ['webdav', '循环'],
  },
  {
    code: 510,
    phrase: 'Not Extended',
    name: '未扩展',
    desc: '请求未满足访问资源所需的扩展策略（HTTP 扩展框架）。',
    scenario: '几乎没有实际使用。',
    tip: 'RFC 2774 已被标记为历史文档，不建议使用。',
    ...rfc(2774, '7'),
    status: 'deprecated',
  },
  {
    code: 511,
    phrase: 'Network Authentication Required',
    name: '需要网络认证',
    desc: '客户端需要先通过网络认证才能访问网络。',
    scenario: '酒店、机场、咖啡店 Wi-Fi 的强制门户（Captive Portal）登录页。',
    tip: '由拦截流量的网关产生，源站不应返回该状态码。',
    ...rfc(6585, '6'),
    keywords: ['wifi', '门户', 'captive portal'],
  },

  // ───────── 非标准（常见） ─────────
  {
    code: 444,
    phrase: 'No Response',
    name: '无响应',
    desc: 'Nginx 专用：不返回任何内容，直接关闭连接。只会出现在 Nginx 日志里。',
    scenario: '用 return 444; 屏蔽恶意扫描、未匹配任何 server_name 的请求。',
    tip: '客户端看到的是连接被关闭 / 空响应，而不是一个状态码。',
    spec: 'Nginx 扩展',
    specUrl: 'https://nginx.org/en/docs/http/ngx_http_rewrite_module.html#return',
    status: 'unofficial',
    vendor: 'Nginx',
    keywords: ['nginx', '屏蔽'],
  },
  {
    code: 499,
    phrase: 'Client Closed Request',
    name: '客户端关闭请求',
    desc: 'Nginx 专用：客户端在服务器返回响应前主动关闭了连接。',
    scenario:
      '用户刷新或关闭页面、前端用 AbortController 取消请求、客户端超时时间短于后端处理时间。',
    tip: '大量 499 通常说明后端太慢或调用方超时设置太短；只出现在服务端日志中。',
    spec: 'Nginx 扩展',
    status: 'unofficial',
    vendor: 'Nginx',
    keywords: ['nginx', '取消', '超时', 'abort'],
  },
  {
    code: 520,
    phrase: 'Web Server Returned an Unknown Error',
    name: '源站返回未知错误',
    desc: 'Cloudflare 专用：源站返回了空的、未知的或无法解析的响应。',
    scenario: '源站进程崩溃、响应头过大、源站直接重置连接。',
    tip: '直连源站复现问题，检查源站日志与响应头大小。',
    spec: 'Cloudflare 扩展',
    specUrl: CLOUDFLARE_DOC,
    status: 'unofficial',
    vendor: 'Cloudflare',
    keywords: ['cloudflare', 'cdn', '源站'],
  },
  {
    code: 521,
    phrase: 'Web Server Is Down',
    name: '源站已宕机',
    desc: 'Cloudflare 专用：源站拒绝了 Cloudflare 的连接。',
    scenario: '源站服务未启动，或防火墙拦截了 Cloudflare 的 IP 段。',
    tip: '确认源站在运行，并在防火墙中放行 Cloudflare 的 IP 段。',
    spec: 'Cloudflare 扩展',
    specUrl: CLOUDFLARE_DOC,
    status: 'unofficial',
    vendor: 'Cloudflare',
    keywords: ['cloudflare', 'cdn', '源站', '宕机'],
  },
  {
    code: 522,
    phrase: 'Connection Timed Out',
    name: '连接超时',
    desc: 'Cloudflare 专用：与源站建立 TCP 连接超时。',
    scenario: '源站负载过高、网络丢包、防火墙静默丢弃了 Cloudflare 的请求。',
    tip: '检查源站负载与防火墙规则，确认 DNS 指向的源站 IP 正确。',
    spec: 'Cloudflare 扩展',
    specUrl: CLOUDFLARE_DOC,
    status: 'unofficial',
    vendor: 'Cloudflare',
    keywords: ['cloudflare', 'cdn', '超时'],
  },
  {
    code: 523,
    phrase: 'Origin Is Unreachable',
    name: '源站不可达',
    desc: 'Cloudflare 专用：无法路由到源站。',
    scenario: '源站 DNS 记录错误、源站 IP 变更。',
    tip: '核对 DNS 中源站的 A / AAAA 记录。',
    spec: 'Cloudflare 扩展',
    specUrl: CLOUDFLARE_DOC,
    status: 'unofficial',
    vendor: 'Cloudflare',
    keywords: ['cloudflare', 'cdn', 'dns'],
  },
  {
    code: 524,
    phrase: 'A Timeout Occurred',
    name: '响应超时',
    desc: 'Cloudflare 专用：已连上源站，但源站在默认 100 秒内没有返回 HTTP 响应。',
    scenario: '长时间运行的导出、报表等同步接口。',
    tip: '把长任务改为异步（202 + 轮询），或让大流量接口绕过代理。',
    spec: 'Cloudflare 扩展',
    specUrl: CLOUDFLARE_DOC,
    status: 'unofficial',
    vendor: 'Cloudflare',
    keywords: ['cloudflare', 'cdn', '超时'],
  },
  {
    code: 525,
    phrase: 'SSL Handshake Failed',
    name: 'SSL 握手失败',
    desc: 'Cloudflare 专用：与源站的 SSL/TLS 握手失败。',
    scenario: '源站没有配置证书、不支持 SNI 或加密套件不匹配。',
    tip: '确认源站 443 端口已正确配置证书与 TLS 版本。',
    spec: 'Cloudflare 扩展',
    specUrl: CLOUDFLARE_DOC,
    status: 'unofficial',
    vendor: 'Cloudflare',
    keywords: ['cloudflare', 'ssl', 'tls', 'https'],
  },
  {
    code: 526,
    phrase: 'Invalid SSL Certificate',
    name: '源站证书无效',
    desc: 'Cloudflare 专用：在 Full (strict) 模式下，源站证书无法通过校验。',
    scenario: '源站证书过期、自签名或域名不匹配。',
    tip: '更换为受信任的证书（或 Cloudflare Origin CA 证书）。',
    spec: 'Cloudflare 扩展',
    specUrl: CLOUDFLARE_DOC,
    status: 'unofficial',
    vendor: 'Cloudflare',
    keywords: ['cloudflare', 'ssl', '证书', 'https'],
  },
]

/** 全部状态码，按数字升序 */
export const HTTP_STATUSES: readonly HttpStatus[] = [...DATA].sort((a, b) => a.code - b.code)

export function statusClassOf(code: number): StatusClass {
  return Math.min(5, Math.max(1, Math.floor(code / 100))) as StatusClass
}

export function classInfo(code: number): StatusClassInfo {
  return STATUS_CLASSES[statusClassOf(code) - 1]
}

export function getStatus(code: number): HttpStatus | undefined {
  return HTTP_STATUSES.find((s) => s.code === code)
}

export const STATUS_LABELS: Record<NonNullable<HttpStatus['status']>, string> = {
  deprecated: '已废弃',
  reserved: '保留',
  unofficial: '非标准',
}

function haystack(s: HttpStatus): string {
  return [
    s.code,
    s.phrase,
    s.name,
    s.desc,
    s.scenario,
    s.tip,
    s.spec,
    s.vendor ?? '',
    ...(s.headers ?? []),
    ...(s.keywords ?? []),
  ]
    .join('\n')
    .toLowerCase()
}

const HAYSTACKS = new Map(HTTP_STATUSES.map((s) => [s.code, haystack(s)]))

export interface SearchOptions {
  includeUnofficial?: boolean
  /** 只看某一类 */
  cls?: StatusClass | null
}

/**
 * 「按状态码查找」类的查询 → 状态码前缀；普通文本返回 null。
 * "4" / "40" / "404" 原样作为前缀；"4xx"、"40x"（x 大小写均可）去掉通配部分。
 */
export function codeQueryPrefix(query: string): string | null {
  const q = query.trim().toLowerCase()
  if (/^\d{1,3}$/.test(q)) return q
  const wild = /^([1-5]\d?)(x{1,2})$/.exec(q)
  if (wild && wild[1].length + wild[2].length === 3) return wild[1]
  return null
}

/**
 * 搜索状态码：
 * - 纯数字按前缀匹配（"4" → 4xx，"40" → 400–409，"404" → 404）
 * - "4xx" / "40x" 按通配前缀匹配
 * - 其他文本按空格拆词，每个词都要命中（码、英文短语、中文名、说明、场景、建议、相关头、关键词）
 * 结果按匹配度排序：码 / 名称直接命中的排前面，其余按状态码升序。
 */
export function searchStatuses(query: string, opts: SearchOptions = {}): HttpStatus[] {
  const { includeUnofficial = true, cls = null } = opts
  const pool = HTTP_STATUSES.filter(
    (s) =>
      (includeUnofficial || s.status !== 'unofficial') &&
      (cls === null || statusClassOf(s.code) === cls),
  )
  const q = query.trim().toLowerCase()
  if (!q) return pool
  const prefix = codeQueryPrefix(q)
  if (prefix !== null) return pool.filter((s) => String(s.code).startsWith(prefix))

  const terms = q.split(/\s+/).filter(Boolean)
  const scored: { s: HttpStatus; score: number }[] = []
  for (const s of pool) {
    const hay = HAYSTACKS.get(s.code)!
    if (!terms.every((t) => hay.includes(t))) continue
    const title = `${s.code} ${s.phrase} ${s.name}`.toLowerCase()
    let score = 0
    for (const t of terms) {
      if (title.includes(t)) score += 2
      if ((s.keywords ?? []).some((k) => k.toLowerCase() === t)) score += 1
    }
    scored.push({ s, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.s.code - b.s.code).map((x) => x.s)
}
