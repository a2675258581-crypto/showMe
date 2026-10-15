import Foundation

// 由网页版 src/lib/http-status.ts 生成：中文名、说明、典型场景、开发建议原样保留，另加英文说明。

extension HTTPStatusCatalog {
    static let data: [HTTPStatusInfo] = [
        HTTPStatusInfo(
            code: 100, phrase: "Continue", zhName: "继续",
            zhDescription: "服务器已收到请求头，客户端可以继续发送请求体。",
            enDescription: "The server received the request headers; the client may go on and send the request body.",
            zhScenario: "上传大文件时客户端先带 Expect: 100-continue 询问，服务器完成鉴权、大小检查后回 100，客户端再发送请求体，避免白白上传。",
            zhTip: "多数 HTTP 客户端会自动处理。curl 上传超过 1MB 时默认带 Expect 头，遇到不支持的代理会平白多等 1 秒，可用 -H \"Expect:\" 关闭。",
            headers: ["Expect"], spec: "RFC 9110 §15.2.1", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.2.1",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["上传"]
        ),
        HTTPStatusInfo(
            code: 101, phrase: "Switching Protocols", zhName: "切换协议",
            zhDescription: "服务器同意客户端通过 Upgrade 请求头提出的协议切换。",
            enDescription: "The server agrees to switch protocols as requested in the client's Upgrade header.",
            zhScenario: "WebSocket 握手（Upgrade: websocket）；HTTP/1.1 明文升级到 h2c。",
            zhTip: "反向代理（如 Nginx）必须显式转发 Upgrade 与 Connection 头，否则 WebSocket 握手会失败，表现为 400 或连接一直 pending。",
            headers: ["Upgrade", "Connection", "Sec-WebSocket-Accept"], spec: "RFC 9110 §15.2.2", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.2.2",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["websocket", "ws", "握手"]
        ),
        HTTPStatusInfo(
            code: 102, phrase: "Processing", zhName: "处理中",
            zhDescription: "WebDAV 扩展：服务器已接收请求并正在处理，但尚无响应，用来防止客户端超时。",
            enDescription: "WebDAV: the server has accepted the request and is still working on it; sent so the client doesn't time out.",
            zhScenario: "早期 WebDAV 中耗时很长的 COPY / MOVE 操作。",
            zhTip: "已在 RFC 4918 中被移除，新系统不要使用；长任务建议返回 202 + 任务查询地址。",
            headers: [], spec: "RFC 2518 §10.1", specURL: "https://www.rfc-editor.org/rfc/rfc2518",
            cacheable: false, flag: .deprecated, vendor: nil,
            keywords: ["webdav"]
        ),
        HTTPStatusInfo(
            code: 103, phrase: "Early Hints", zhName: "早期提示",
            zhDescription: "在最终响应之前先发送部分响应头（通常是 Link），让浏览器提前预加载资源或预连接。",
            enDescription: "Sends some response headers (usually Link) before the final response so the browser can preload resources or preconnect.",
            zhScenario: "服务端渲染页面需要几百毫秒时，先告诉浏览器去预加载关键 CSS、字体或预连接 CDN 域名。",
            zhTip: "只放 Link: rel=preload / preconnect；Chrome 103+ 已支持。Cloudflare 等 CDN 可以根据缓存的 Link 头自动发送 103。",
            headers: ["Link"], spec: "RFC 8297", specURL: "https://www.rfc-editor.org/rfc/rfc8297",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["预加载", "preload", "preconnect", "性能"]
        ),
        HTTPStatusInfo(
            code: 200, phrase: "OK", zhName: "成功",
            zhDescription: "请求成功。响应体含义取决于方法：GET 返回资源，POST 返回处理结果。",
            enDescription: "The request succeeded. The body depends on the method: GET returns the resource, POST returns the result.",
            zhScenario: "绝大多数正常的页面与接口请求。",
            zhTip: "不要出错时也返回 200 再在 JSON 里写 {\"code\": 500}，这会让缓存、监控告警和自动重试全部失效；请使用恰当的 4xx / 5xx。",
            headers: [], spec: "RFC 9110 §15.3.1", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.1",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["正常", "ok", "success"]
        ),
        HTTPStatusInfo(
            code: 201, phrase: "Created", zhName: "已创建",
            zhDescription: "请求成功并创建了新资源。",
            enDescription: "The request succeeded and a new resource was created.",
            zhScenario: "POST /users 创建用户成功；PUT 创建了原本不存在的资源。",
            zhTip: "在 Location 头返回新资源的 URL，响应体可附上创建后的完整资源，省去客户端再查一次。",
            headers: ["Location"], spec: "RFC 9110 §15.3.2", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.2",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["新建", "post", "create"]
        ),
        HTTPStatusInfo(
            code: 202, phrase: "Accepted", zhName: "已接受",
            zhDescription: "请求已被接受，但尚未处理完成；最终可能成功也可能失败。",
            enDescription: "The request was accepted but not processed yet; it may still succeed or fail.",
            zhScenario: "异步任务：提交视频转码、批量导出报表、加入邮件发送队列。",
            zhTip: "返回一个可查询进度的任务地址（Location 或响应体中的 statusUrl），客户端轮询或通过 Webhook 获取结果。",
            headers: ["Location", "Retry-After"], spec: "RFC 9110 §15.3.3", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.3",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["异步", "队列", "任务"]
        ),
        HTTPStatusInfo(
            code: 203, phrase: "Non-Authoritative Information", zhName: "非权威信息",
            zhDescription: "请求成功，但返回内容被中间的转换代理修改过，与源服务器的 200 响应不同。",
            enDescription: "The request succeeded, but a transforming proxy modified the content, so it differs from the origin's 200 response.",
            zhScenario: "转换代理改写了响应，例如移动网络运营商压缩了图片。",
            zhTip: "业务 API 基本不会主动使用。",
            headers: [], spec: "RFC 9110 §15.3.4", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.4",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["代理"]
        ),
        HTTPStatusInfo(
            code: 204, phrase: "No Content", zhName: "无内容",
            zhDescription: "请求成功，但没有响应体。",
            enDescription: "The request succeeded and there is no response body.",
            zhScenario: "DELETE 成功；PUT / PATCH 更新后无需返回数据；CORS 预检 OPTIONS；埋点上报。",
            zhTip: "204 不能带响应体。前端不要对 204 调用 response.json()，否则会抛出 “Unexpected end of JSON input”。",
            headers: [], spec: "RFC 9110 §15.3.5", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.5",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["删除", "delete", "空", "options", "cors", "empty"]
        ),
        HTTPStatusInfo(
            code: 205, phrase: "Reset Content", zhName: "重置内容",
            zhDescription: "请求成功，并要求客户端重置文档视图（例如清空表单）。",
            enDescription: "The request succeeded and the client should reset the document view (e.g. clear the form).",
            zhScenario: "表单提交后让用户代理清空输入框，方便继续录入下一条。",
            zhTip: "浏览器几乎没有实现这一语义，实际很少使用。",
            headers: [], spec: "RFC 9110 §15.3.6", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.6",
            cacheable: false, flag: nil, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 206, phrase: "Partial Content", zhName: "部分内容",
            zhDescription: "服务器成功处理了带 Range 头的范围请求，只返回了部分内容。",
            enDescription: "The server fulfilled a Range request and returned only part of the content.",
            zhScenario: "视频拖动进度条播放、断点续传、多线程分段下载。",
            zhTip: "必须返回 Content-Range；支持范围请求的服务器应在普通 200 响应中声明 Accept-Ranges: bytes。",
            headers: ["Range", "Content-Range", "Accept-Ranges", "If-Range"], spec: "RFC 9110 §15.3.7", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.3.7",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["断点续传", "视频", "分片", "下载", "resume", "video", "partial"]
        ),
        HTTPStatusInfo(
            code: 207, phrase: "Multi-Status", zhName: "多状态",
            zhDescription: "WebDAV 扩展：响应体（XML）中分别给出多个独立操作各自的状态码。",
            enDescription: "WebDAV: the XML body reports separate status codes for several independent operations.",
            zhScenario: "WebDAV 的 PROPFIND、批量移动 / 删除；部分批处理 API 也借用它表示「各条结果不同」。",
            zhTip: "部分成功时外层仍是 207，客户端要逐条检查内部状态，不能只看外层。",
            headers: [], spec: "RFC 4918 §11.1", specURL: "https://www.rfc-editor.org/rfc/rfc4918",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["webdav", "批量"]
        ),
        HTTPStatusInfo(
            code: 208, phrase: "Already Reported", zhName: "已报告",
            zhDescription: "WebDAV 扩展：在 207 响应中，该绑定下的成员前面已经列出过，不再重复枚举。",
            enDescription: "WebDAV: members of this binding were already listed earlier in the 207 response and are not repeated.",
            zhScenario: "WebDAV 绑定让同一资源在多个路径出现时，避免重复列举或陷入循环。",
            zhTip: "只出现在 207 响应体内部，普通 API 用不到。",
            headers: [], spec: "RFC 5842 §7.1", specURL: "https://www.rfc-editor.org/rfc/rfc5842",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["webdav"]
        ),
        HTTPStatusInfo(
            code: 226, phrase: "IM Used", zhName: "已应用实例操作",
            zhDescription: "服务器完成了 GET 请求，返回的是对当前实例应用一个或多个实例操作（如 delta 增量编码）后的结果。",
            enDescription: "The server fulfilled a GET request; the response is the result of one or more instance manipulations (such as delta encoding).",
            zhScenario: "HTTP 增量编码：只传输与客户端已有版本的差异。",
            zhTip: "实践中极少见，浏览器不支持。",
            headers: ["A-IM", "IM", "Delta-Base"], spec: "RFC 3229 §10.4.1", specURL: "https://www.rfc-editor.org/rfc/rfc3229",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["delta", "增量"]
        ),
        HTTPStatusInfo(
            code: 300, phrase: "Multiple Choices", zhName: "多种选择",
            zhDescription: "请求的资源有多种表示可选，由用户或客户端从中挑选。",
            enDescription: "The resource has several representations for the user or client to choose from.",
            zhScenario: "同一文档有多种语言或格式，服务器无法自动协商。",
            zhTip: "没有标准化的自动选择方式，实际很少用；如有首选项可放在 Location 头。",
            headers: ["Location"], spec: "RFC 9110 §15.4.1", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.1",
            cacheable: true, flag: nil, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 301, phrase: "Moved Permanently", zhName: "永久重定向",
            zhDescription: "资源已永久迁移到 Location 指定的新地址。",
            enDescription: "The resource has moved permanently to the URL in Location.",
            zhScenario: "网站更换域名、HTTP 跳转 HTTPS、URL 结构调整（搜索引擎权重会转移到新地址）。",
            zhTip: "浏览器会长期缓存 301，配错了很难撤回，上线前先用 302 验证。历史原因下客户端可能把 POST 改成 GET，需要保持方法请用 308。",
            headers: ["Location"], spec: "RFC 9110 §15.4.2", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.2",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["跳转", "seo", "https", "域名", "redirect"]
        ),
        HTTPStatusInfo(
            code: 302, phrase: "Found", zhName: "临时重定向",
            zhDescription: "资源临时位于 Location 指定的地址，之后仍应使用原地址访问。",
            enDescription: "The resource is temporarily at the URL in Location; the original URL should still be used later.",
            zhScenario: "未登录时跳到登录页、登录后跳回原页面、A/B 测试分流。",
            zhTip: "浏览器历史上会把 POST 改成 GET 再跳转：想明确「改用 GET」用 303，想保持方法和请求体用 307。",
            headers: ["Location"], spec: "RFC 9110 §15.4.3", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.3",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["跳转", "登录", "redirect", "login"]
        ),
        HTTPStatusInfo(
            code: 303, phrase: "See Other", zhName: "查看其他位置",
            zhDescription: "让客户端用 GET 请求 Location 指定的另一个 URL 来获取结果。",
            enDescription: "Tells the client to fetch the result with a GET to another URL given in Location.",
            zhScenario: "表单 POST 成功后跳转到结果页（PRG 模式：Post / Redirect / Get），防止刷新时重复提交。",
            zhTip: "无论原请求是什么方法，跟随 303 时都会改用 GET（HEAD 除外）。",
            headers: ["Location"], spec: "RFC 9110 §15.4.4", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.4",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["跳转", "表单", "prg", "redirect"]
        ),
        HTTPStatusInfo(
            code: 304, phrase: "Not Modified", zhName: "未修改",
            zhDescription: "条件请求（If-None-Match / If-Modified-Since）命中：资源未变化，客户端可直接使用缓存。",
            enDescription: "A conditional request (If-None-Match / If-Modified-Since) matched: the resource is unchanged and the cached copy can be used.",
            zhScenario: "浏览器协商缓存；CDN 回源校验。",
            zhTip: "304 不带响应体。需要正确生成 ETag 或 Last-Modified；多台服务器时各节点的 ETag 要一致（例如不要把 inode 算进 ETag）。",
            headers: ["ETag", "Last-Modified", "If-None-Match", "If-Modified-Since", "Cache-Control"], spec: "RFC 9110 §15.4.5", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.5",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["缓存", "etag", "协商缓存", "cache"]
        ),
        HTTPStatusInfo(
            code: 305, phrase: "Use Proxy", zhName: "使用代理",
            zhDescription: "要求通过 Location 指定的代理访问资源。",
            enDescription: "The resource must be accessed through the proxy given in Location.",
            zhScenario: "无——因存在安全隐患已被废弃，主流浏览器不支持。",
            zhTip: "不要使用。",
            headers: ["Location"], spec: "RFC 9110 §15.4.6", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.6",
            cacheable: false, flag: .deprecated, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 306, phrase: "(Unused)", zhName: "未使用",
            zhDescription: "早期草案中曾表示 Switch Proxy，现已不再使用，编号保留。",
            enDescription: "Meant “Switch Proxy” in an early draft; no longer used and the number is reserved.",
            zhScenario: "无。",
            zhTip: "保留编号，不得另作他用。",
            headers: [], spec: "RFC 9110 §15.4.7", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.7",
            cacheable: false, flag: .reserved, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 307, phrase: "Temporary Redirect", zhName: "临时重定向（保持方法）",
            zhDescription: "与 302 相同，但明确要求客户端不得改变请求方法和请求体。",
            enDescription: "Like 302, but the client must not change the request method or body.",
            zhScenario: "接口临时迁移、维护期间把 POST / PUT 临时转发到其他地址；开启 HSTS 后浏览器内部把 http 跳到 https 时也显示为 307。",
            zhTip: "API 需要临时重定向非 GET 请求时，用 307 而不是 302。",
            headers: ["Location"], spec: "RFC 9110 §15.4.8", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.8",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["跳转", "hsts", "redirect"]
        ),
        HTTPStatusInfo(
            code: 308, phrase: "Permanent Redirect", zhName: "永久重定向（保持方法）",
            zhDescription: "与 301 相同，但明确要求客户端不得改变请求方法和请求体。",
            enDescription: "Like 301, but the client must not change the request method or body.",
            zhScenario: "API 版本迁移、永久更换接口地址且需要保留 POST / PUT。",
            zhTip: "同样会被长期缓存；老旧客户端可能不认识 308，需要兼容时评估影响。",
            headers: ["Location"], spec: "RFC 9110 §15.4.9", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.4.9",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["跳转", "迁移", "redirect"]
        ),
        HTTPStatusInfo(
            code: 400, phrase: "Bad Request", zhName: "错误请求",
            zhDescription: "请求本身有问题，服务器无法处理：语法错误、参数格式不对、JSON 解析失败等。",
            enDescription: "The request itself is wrong and can't be processed: bad syntax, invalid parameters, unparsable JSON and so on.",
            zhScenario: "请求体 JSON 格式错误、缺少必填参数、参数类型不匹配；部分服务器在 Cookie 过大时也返回 400。",
            zhTip: "在响应体中说明具体哪个字段有什么问题，推荐 RFC 9457 Problem Details（application/problem+json）。语法正确但业务校验不通过可以用 422。",
            headers: [], spec: "RFC 9110 §15.5.1", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.1",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["参数错误", "格式错误", "json", "invalid", "validation"]
        ),
        HTTPStatusInfo(
            code: 401, phrase: "Unauthorized", zhName: "未认证",
            zhDescription: "请求缺少有效的身份认证凭据。名字虽叫 Unauthorized，实际含义是「未认证」。",
            enDescription: "The request lacks valid authentication credentials. Despite the name, it means “unauthenticated”.",
            zhScenario: "未登录、Token 过期或无效、API Key 错误、签名校验失败。",
            zhTip: "必须返回 WWW-Authenticate 头说明认证方式。前端据此跳转登录或用 Refresh Token 续期；已登录但没有权限应返回 403。",
            headers: ["WWW-Authenticate", "Authorization"], spec: "RFC 9110 §15.5.2", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.2",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["登录", "token", "过期", "鉴权", "jwt", "认证", "login", "token", "expired", "auth", "unauthenticated"]
        ),
        HTTPStatusInfo(
            code: 402, phrase: "Payment Required", zhName: "需要付款",
            zhDescription: "为未来的数字支付场景保留，目前没有标准化的用法。",
            enDescription: "Reserved for future digital payment use; there is no standardized usage yet.",
            zhScenario: "部分 SaaS / API 用它表示额度用尽、订阅过期、需要付费升级。",
            zhTip: "使用前需与客户端约定语义，并在响应体中说明如何付费。",
            headers: [], spec: "RFC 9110 §15.5.3", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.3",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["付费", "额度", "订阅"]
        ),
        HTTPStatusInfo(
            code: 403, phrase: "Forbidden", zhName: "禁止访问",
            zhDescription: "服务器理解请求，但拒绝执行。与 401 不同，重新认证也不会改变结果。",
            enDescription: "The server understood the request but refuses to fulfill it. Unlike 401, authenticating again won't change the result.",
            zhScenario: "已登录但无权限、IP 被封禁、WAF 拦截、禁止列出目录、CSRF 校验失败、对象存储未授权。",
            zhTip: "如果不想暴露资源是否存在（例如别人的私有仓库），可以直接返回 404。",
            headers: [], spec: "RFC 9110 §15.5.4", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.4",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["权限", "无权", "拒绝", "封禁", "waf", "csrf", "permission", "denied", "access"]
        ),
        HTTPStatusInfo(
            code: 404, phrase: "Not Found", zhName: "未找到",
            zhDescription: "服务器找不到请求的资源。",
            enDescription: "The server can't find the requested resource.",
            zhScenario: "URL 拼写错误、资源已删除、路由不存在；单页应用刷新子路由时服务器没有回退到 index.html。",
            zhTip: "单页应用需配置 history 回退（如 Nginx try_files $uri /index.html）；确定已永久删除的资源可以用 410。",
            headers: [], spec: "RFC 9110 §15.5.5", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["找不到", "不存在", "路由", "spa", "missing", "route"]
        ),
        HTTPStatusInfo(
            code: 405, phrase: "Method Not Allowed", zhName: "方法不允许",
            zhDescription: "资源存在，但不支持当前请求方法。",
            enDescription: "The resource exists but doesn't support this request method.",
            zhScenario: "对只读接口发 POST、对表单地址发 GET、RESTful 路由没有注册 DELETE。",
            zhTip: "必须返回 Allow 头列出支持的方法，例如 Allow: GET, HEAD。",
            headers: ["Allow"], spec: "RFC 9110 §15.5.6", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.6",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["方法", "get", "post", "method"]
        ),
        HTTPStatusInfo(
            code: 406, phrase: "Not Acceptable", zhName: "无法接受",
            zhDescription: "服务器无法生成符合客户端 Accept 系列请求头要求的内容。",
            enDescription: "The server can't produce content that matches the client's Accept headers.",
            zhScenario: "客户端只接受 application/xml，而接口只能返回 JSON。",
            zhTip: "大多数 API 会直接返回默认格式而不是 406；确实要严格协商时再使用。",
            headers: ["Accept", "Accept-Language", "Accept-Encoding"], spec: "RFC 9110 §15.5.7", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.7",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["内容协商"]
        ),
        HTTPStatusInfo(
            code: 407, phrase: "Proxy Authentication Required", zhName: "需要代理认证",
            zhDescription: "与 401 类似，但需要先通过代理服务器的认证。",
            enDescription: "Like 401, but the client must first authenticate with the proxy.",
            zhScenario: "公司内网的出口代理需要账号密码。",
            zhTip: "客户端在 Proxy-Authorization 头中带上凭据；npm、git 等工具需要单独配置代理账号。",
            headers: ["Proxy-Authenticate", "Proxy-Authorization"], spec: "RFC 9110 §15.5.8", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.8",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["代理"]
        ),
        HTTPStatusInfo(
            code: 408, phrase: "Request Timeout", zhName: "请求超时",
            zhDescription: "服务器等待客户端发送完整请求的时间过长，决定关闭连接。",
            enDescription: "The server waited too long for the client to send the full request and closed the connection.",
            zhScenario: "客户端网络很慢或上传中断；空闲的 keep-alive 连接被服务器回收。",
            zhTip: "客户端可以安全地重试；服务器应同时带上 Connection: close。",
            headers: ["Connection"], spec: "RFC 9110 §15.5.9", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.9",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["超时", "timeout"]
        ),
        HTTPStatusInfo(
            code: 409, phrase: "Conflict", zhName: "冲突",
            zhDescription: "请求与目标资源的当前状态冲突。",
            enDescription: "The request conflicts with the current state of the target resource.",
            zhScenario: "用户名 / 邮箱已被注册、重复创建同一资源、并发编辑产生冲突。",
            zhTip: "在响应体中说明冲突原因，便于用户解决；基于版本号的乐观锁冲突用 412 更精确。",
            headers: [], spec: "RFC 9110 §15.5.10", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["重复", "已存在", "并发", "duplicate", "exists", "concurrency"]
        ),
        HTTPStatusInfo(
            code: 410, phrase: "Gone", zhName: "已永久删除",
            zhDescription: "资源曾经存在，但已被永久删除，且没有新的地址。",
            enDescription: "The resource existed but has been permanently removed, with no new address.",
            zhScenario: "已下架的商品页、结束的活动页、已废弃的 API 版本。",
            zhTip: "比 404 语义更明确，搜索引擎会更快移除索引。",
            headers: [], spec: "RFC 9110 §15.5.11", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.11",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["删除", "下架", "废弃", "deleted", "removed"]
        ),
        HTTPStatusInfo(
            code: 411, phrase: "Length Required", zhName: "需要长度",
            zhDescription: "服务器要求请求带上 Content-Length 头。",
            enDescription: "The server requires a Content-Length header.",
            zhScenario: "某些服务器或网关不接受分块传输（Transfer-Encoding: chunked）的请求体。",
            zhTip: "客户端先计算请求体长度再发送，或确认网关支持 chunked。",
            headers: ["Content-Length"], spec: "RFC 9110 §15.5.12", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.12",
            cacheable: false, flag: nil, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 412, phrase: "Precondition Failed", zhName: "前置条件失败",
            zhDescription: "请求头中的前置条件（If-Match、If-Unmodified-Since 等）不成立。",
            enDescription: "A precondition in the request headers (If-Match, If-Unmodified-Since, etc.) is not met.",
            zhScenario: "乐观并发控制：带 If-Match: \"旧 ETag\" 更新资源，但资源已被别人修改过。",
            zhTip: "客户端应重新获取最新版本，合并修改后再提交，避免覆盖他人的更新。",
            headers: ["If-Match", "If-Unmodified-Since", "ETag"], spec: "RFC 9110 §15.5.13", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.13",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["乐观锁", "并发", "etag", "optimistic lock"]
        ),
        HTTPStatusInfo(
            code: 413, phrase: "Content Too Large", zhName: "请求体过大",
            zhDescription: "请求体超过了服务器愿意或能够处理的大小（旧名 Payload Too Large）。",
            enDescription: "The request body is larger than the server is willing or able to process (formerly Payload Too Large).",
            zhScenario: "上传文件超过 Nginx 的 client_max_body_size（默认 1MB）。",
            zhTip: "调大 client_max_body_size 或应用框架的上传限制；大文件改用分片上传。临时限制可带 Retry-After。",
            headers: ["Retry-After"], spec: "RFC 9110 §15.5.14", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.14",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["上传", "文件太大", "payload too large", "nginx", "upload", "too large"]
        ),
        HTTPStatusInfo(
            code: 414, phrase: "URI Too Long", zhName: "URI 过长",
            zhDescription: "请求的 URI 超过了服务器能处理的长度。",
            enDescription: "The request URI is longer than the server can handle.",
            zhScenario: "GET 请求把大量数据塞进查询参数；重定向循环让 URL 越来越长。",
            zhTip: "大量参数改用 POST 请求体；浏览器与服务器对 URL 长度的上限通常在 8KB 左右。",
            headers: [], spec: "RFC 9110 §15.5.15", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.15",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["url", "太长"]
        ),
        HTTPStatusInfo(
            code: 415, phrase: "Unsupported Media Type", zhName: "不支持的媒体类型",
            zhDescription: "服务器不支持请求体的格式（Content-Type 或 Content-Encoding）。",
            enDescription: "The server doesn't support the format of the request body (Content-Type or Content-Encoding).",
            zhScenario: "接口要求 application/json，却发送了表单编码，或者忘了设置 Content-Type。",
            zhTip: "检查 fetch / axios 是否设置了 Content-Type: application/json；服务器可用 Accept-Post / Accept-Patch 声明支持的格式。",
            headers: ["Content-Type", "Content-Encoding", "Accept-Post", "Accept-Patch"], spec: "RFC 9110 §15.5.16", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.16",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["content-type", "格式", "format"]
        ),
        HTTPStatusInfo(
            code: 416, phrase: "Range Not Satisfiable", zhName: "范围无法满足",
            zhDescription: "Range 请求的范围超出了资源的实际大小。",
            enDescription: "The requested Range lies outside the actual size of the resource.",
            zhScenario: "断点续传时本地记录的偏移量大于服务器上的文件大小（文件已被替换）。",
            zhTip: "响应应带 Content-Range: bytes */总长度，客户端据此从头重新下载。",
            headers: ["Range", "Content-Range"], spec: "RFC 9110 §15.5.17", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.17",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["断点续传", "下载", "resume", "download"]
        ),
        HTTPStatusInfo(
            code: 417, phrase: "Expectation Failed", zhName: "预期失败",
            zhDescription: "服务器无法满足 Expect 请求头提出的要求。",
            enDescription: "The server can't meet the requirement in the Expect header.",
            zhScenario: "服务器或中间代理不支持 Expect: 100-continue。",
            zhTip: "客户端去掉 Expect 头后重试即可。",
            headers: ["Expect"], spec: "RFC 9110 §15.5.18", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.18",
            cacheable: false, flag: nil, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 418, phrase: "I'm a teapot", zhName: "我是茶壶",
            zhDescription: "源自 1998 年愚人节的 RFC 2324（超文本咖啡壶控制协议）：茶壶拒绝煮咖啡。RFC 9110 将其保留，不得另作他用。",
            enDescription: "From RFC 2324, a 1998 April Fools' joke (Hyper Text Coffee Pot Control Protocol): a teapot refuses to brew coffee. RFC 9110 reserves it.",
            zhScenario: "彩蛋；也有网站用它回应不想处理的自动化请求。",
            zhTip: "不要在正式 API 中使用。",
            headers: [], spec: "RFC 9110 §15.5.19", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.19",
            cacheable: false, flag: .reserved, vendor: nil,
            keywords: ["茶壶", "彩蛋", "teapot", "愚人节"]
        ),
        HTTPStatusInfo(
            code: 421, phrase: "Misdirected Request", zhName: "错误定向请求",
            zhDescription: "请求被发到了无法为目标 URI 生成响应的服务器。",
            enDescription: "The request was sent to a server that can't produce a response for the target URI.",
            zhScenario: "HTTP/2 连接复用：多个域名共用证书和 IP，浏览器把 B 域名的请求复用到 A 的连接上，但该服务器并未配置 B。",
            zhTip: "客户端可以新建连接后重试；服务器端检查证书覆盖的域名、SNI 与 Host 是否一致。",
            headers: [], spec: "RFC 9110 §15.5.20", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.20",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["http2", "sni", "证书"]
        ),
        HTTPStatusInfo(
            code: 422, phrase: "Unprocessable Content", zhName: "无法处理的内容",
            zhDescription: "请求格式正确（如 JSON 语法无误），但语义有误，无法处理。",
            enDescription: "The request is well-formed (e.g. valid JSON) but semantically wrong, so it can't be processed.",
            zhScenario: "表单校验失败：邮箱格式不对、密码太短、结束日期早于开始日期。",
            zhTip: "Rails、Laravel、FastAPI 等框架默认用 422 返回校验错误；在响应体中按字段列出错误信息。",
            headers: [], spec: "RFC 9110 §15.5.21", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.21",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["校验", "验证", "validation", "表单", "validation", "form"]
        ),
        HTTPStatusInfo(
            code: 423, phrase: "Locked", zhName: "已锁定",
            zhDescription: "WebDAV 扩展：目标资源已被锁定。",
            enDescription: "WebDAV: the target resource is locked.",
            zhScenario: "WebDAV 文件正被其他用户锁定编辑。",
            zhTip: "等待锁释放或联系持有锁的用户。",
            headers: [], spec: "RFC 4918 §11.3", specURL: "https://www.rfc-editor.org/rfc/rfc4918",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["webdav", "锁"]
        ),
        HTTPStatusInfo(
            code: 424, phrase: "Failed Dependency", zhName: "依赖失败",
            zhDescription: "WebDAV 扩展：因为所依赖的另一个操作失败，本操作也无法执行。",
            enDescription: "WebDAV: the operation can't be performed because another operation it depends on failed.",
            zhScenario: "WebDAV 批量操作（如 PROPPATCH）中前一步失败，后续步骤全部返回 424。",
            zhTip: "先定位并修复最早失败的那一步。",
            headers: [], spec: "RFC 4918 §11.4", specURL: "https://www.rfc-editor.org/rfc/rfc4918",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["webdav"]
        ),
        HTTPStatusInfo(
            code: 425, phrase: "Too Early", zhName: "过早",
            zhDescription: "服务器不愿处理可能被重放的请求。",
            enDescription: "The server is unwilling to process a request that might be replayed.",
            zhScenario: "TLS 1.3 的 0-RTT 早期数据：非幂等请求存在被重放的风险，服务器要求握手完成后再发送。",
            zhTip: "客户端在完整握手后自动重试即可。",
            headers: [], spec: "RFC 8470 §5.2", specURL: "https://www.rfc-editor.org/rfc/rfc8470",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["0-rtt", "tls", "重放"]
        ),
        HTTPStatusInfo(
            code: 426, phrase: "Upgrade Required", zhName: "需要升级协议",
            zhDescription: "服务器拒绝用当前协议处理请求，要求客户端升级到 Upgrade 头中指定的协议。",
            enDescription: "The server refuses to use the current protocol and requires the client to upgrade to the one in the Upgrade header.",
            zhScenario: "服务器要求改用 TLS 或更新的 HTTP 版本。",
            zhTip: "必须返回 Upgrade 头说明需要的协议。",
            headers: ["Upgrade"], spec: "RFC 9110 §15.5.22", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.22",
            cacheable: false, flag: nil, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 428, phrase: "Precondition Required", zhName: "需要前置条件",
            zhDescription: "服务器要求请求必须是条件请求（如带 If-Match），以避免「丢失更新」。",
            enDescription: "The server requires the request to be conditional (e.g. with If-Match) to prevent lost updates.",
            zhScenario: "强制客户端在更新资源时带上 ETag，实现乐观锁。",
            zhTip: "在响应体中说明需要哪个条件头。",
            headers: ["If-Match", "If-Unmodified-Since"], spec: "RFC 6585 §3", specURL: "https://www.rfc-editor.org/rfc/rfc6585",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["乐观锁"]
        ),
        HTTPStatusInfo(
            code: 429, phrase: "Too Many Requests", zhName: "请求过多",
            zhDescription: "客户端在给定时间内发送了太多请求，被限流。",
            enDescription: "The client sent too many requests in a given time and is being rate limited.",
            zhScenario: "API 限流、登录接口防暴力破解、爬虫被限速。",
            zhTip: "返回 Retry-After 告诉客户端多久后再试；客户端应做指数退避。常配合 X-RateLimit-Limit / Remaining / Reset 头告知配额。",
            headers: ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"], spec: "RFC 6585 §4", specURL: "https://www.rfc-editor.org/rfc/rfc6585",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["限流", "频率", "rate limit", "throttle", "爬虫", "quota"]
        ),
        HTTPStatusInfo(
            code: 431, phrase: "Request Header Fields Too Large", zhName: "请求头过大",
            zhDescription: "请求头整体或某个字段太大，服务器不愿处理。",
            enDescription: "The request headers, or a single header field, are too large for the server.",
            zhScenario: "Cookie 越积越多、超长的 Authorization 或 Referer。",
            zhTip: "清理多余 Cookie；Node.js 默认请求头上限 16KB（--max-http-header-size），Nginx 可调 large_client_header_buffers。",
            headers: [], spec: "RFC 6585 §5", specURL: "https://www.rfc-editor.org/rfc/rfc6585",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["cookie", "header", "太大"]
        ),
        HTTPStatusInfo(
            code: 444, phrase: "No Response", zhName: "无响应",
            zhDescription: "Nginx 专用：不返回任何内容，直接关闭连接。只会出现在 Nginx 日志里。",
            enDescription: "Nginx only: returns nothing and just closes the connection. It only appears in Nginx logs.",
            zhScenario: "用 return 444; 屏蔽恶意扫描、未匹配任何 server_name 的请求。",
            zhTip: "客户端看到的是连接被关闭 / 空响应，而不是一个状态码。",
            headers: [], spec: "Nginx 扩展", specURL: "https://nginx.org/en/docs/http/ngx_http_rewrite_module.html#return",
            cacheable: false, flag: .unofficial, vendor: "Nginx",
            keywords: ["nginx", "屏蔽"]
        ),
        HTTPStatusInfo(
            code: 451, phrase: "Unavailable For Legal Reasons", zhName: "因法律原因不可用",
            zhDescription: "由于法律要求（如政府审查、版权投诉），服务器无法提供该资源。编号致敬小说《华氏 451》。",
            enDescription: "The server can't provide the resource for legal reasons (such as censorship or copyright claims). The number nods to Fahrenheit 451.",
            zhScenario: "内容因 DMCA 版权投诉或地区法律被屏蔽。",
            zhTip: "可用 Link: <…>; rel=\"blocked-by\" 指明实施封锁的实体。",
            headers: ["Link"], spec: "RFC 7725 §3", specURL: "https://www.rfc-editor.org/rfc/rfc7725",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["法律", "审查", "版权", "dmca"]
        ),
        HTTPStatusInfo(
            code: 499, phrase: "Client Closed Request", zhName: "客户端关闭请求",
            zhDescription: "Nginx 专用：客户端在服务器返回响应前主动关闭了连接。",
            enDescription: "Nginx only: the client closed the connection before the server responded.",
            zhScenario: "用户刷新或关闭页面、前端用 AbortController 取消请求、客户端超时时间短于后端处理时间。",
            zhTip: "大量 499 通常说明后端太慢或调用方超时设置太短；只出现在服务端日志中。",
            headers: [], spec: "Nginx 扩展", specURL: nil,
            cacheable: false, flag: .unofficial, vendor: "Nginx",
            keywords: ["nginx", "取消", "超时", "abort"]
        ),
        HTTPStatusInfo(
            code: 500, phrase: "Internal Server Error", zhName: "服务器内部错误",
            zhDescription: "服务器遇到意外情况，无法完成请求。",
            enDescription: "The server hit an unexpected condition and couldn't complete the request.",
            zhScenario: "未捕获的异常、空指针、数据库查询出错、配置错误。",
            zhTip: "不要把堆栈信息返回给客户端（有安全风险），返回一个请求 ID（如 X-Request-ID）方便在日志中定位。",
            headers: [], spec: "RFC 9110 §15.6.1", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.1",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["异常", "报错", "bug", "exception", "crash", "error"]
        ),
        HTTPStatusInfo(
            code: 501, phrase: "Not Implemented", zhName: "未实现",
            zhDescription: "服务器不支持完成请求所需的功能，例如无法识别该请求方法。",
            enDescription: "The server doesn't support the functionality required, e.g. it doesn't recognize the request method.",
            zhScenario: "服务器不支持的 HTTP 方法；功能尚未开发。",
            zhTip: "与 405 的区别：405 是「这个资源」不支持该方法，501 是「整个服务器」都不支持。",
            headers: [], spec: "RFC 9110 §15.6.2", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.2",
            cacheable: true, flag: nil, vendor: nil,
            keywords: ["未开发"]
        ),
        HTTPStatusInfo(
            code: 502, phrase: "Bad Gateway", zhName: "网关错误",
            zhDescription: "作为网关或代理的服务器从上游服务器收到了无效响应。",
            enDescription: "A gateway or proxy received an invalid response from the upstream server.",
            zhScenario: "Nginx 后面的应用进程崩溃或未启动、端口配错、上游返回了非法的 HTTP 响应。",
            zhTip: "查看 Nginx error.log 中的 “connect() failed” 或 “upstream prematurely closed connection”；确认后端在运行且监听的地址端口正确。",
            headers: [], spec: "RFC 9110 §15.6.3", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.3",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["nginx", "upstream", "上游", "网关", "后端挂了", "upstream", "proxy"]
        ),
        HTTPStatusInfo(
            code: 503, phrase: "Service Unavailable", zhName: "服务不可用",
            zhDescription: "服务器暂时无法处理请求，通常是过载或停机维护。",
            enDescription: "The server can't handle the request right now, usually because it is overloaded or down for maintenance.",
            zhScenario: "发布维护中、服务过载、熔断降级、Kubernetes 中没有就绪的 Pod。",
            zhTip: "带上 Retry-After 头。维护页返回 503 而不是 200，可以避免搜索引擎把维护页收录进索引。",
            headers: ["Retry-After"], spec: "RFC 9110 §15.6.4", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.4",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["维护", "过载", "熔断", "降级", "k8s", "maintenance", "overload"]
        ),
        HTTPStatusInfo(
            code: 504, phrase: "Gateway Timeout", zhName: "网关超时",
            zhDescription: "网关或代理没有在规定时间内收到上游服务器的响应。",
            enDescription: "A gateway or proxy didn't receive a response from the upstream server in time.",
            zhScenario: "后端慢查询、调用第三方接口超时、Nginx proxy_read_timeout（默认 60 秒）过短。",
            zhTip: "优化慢接口，或改为异步任务 + 202；必要时调大代理超时时间。",
            headers: [], spec: "RFC 9110 §15.6.5", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.5",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["超时", "timeout", "nginx", "网关", "timeout", "upstream"]
        ),
        HTTPStatusInfo(
            code: 505, phrase: "HTTP Version Not Supported", zhName: "HTTP 版本不支持",
            zhDescription: "服务器不支持请求所使用的 HTTP 主版本。",
            enDescription: "The server doesn't support the HTTP major version used in the request.",
            zhScenario: "用 HTTP/2 或 HTTP/3 访问只支持 HTTP/1.x 的老旧服务器，或请求行版本号写错。",
            zhTip: "响应体中应说明服务器支持哪些协议。",
            headers: [], spec: "RFC 9110 §15.6.6", specURL: "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.6",
            cacheable: false, flag: nil, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 506, phrase: "Variant Also Negotiates", zhName: "变体也在协商",
            zhDescription: "服务器的透明内容协商配置有误：选中的变体自身也被配置为要进行协商，形成循环。",
            enDescription: "Transparent content negotiation is misconfigured: the chosen variant is itself set up to negotiate, creating a loop.",
            zhScenario: "Apache 等服务器的内容协商（type-map）配置错误。",
            zhTip: "属于服务器配置问题，客户端无法修复。",
            headers: [], spec: "RFC 2295 §8.1", specURL: "https://www.rfc-editor.org/rfc/rfc2295",
            cacheable: false, flag: nil, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 507, phrase: "Insufficient Storage", zhName: "存储空间不足",
            zhDescription: "WebDAV 扩展：服务器无法存储完成请求所需的内容。",
            enDescription: "WebDAV: the server can't store the content needed to complete the request.",
            zhScenario: "网盘 / WebDAV 空间已满、服务器磁盘写满。",
            zhTip: "清理空间或扩容；客户端可提示用户存储已满。",
            headers: [], spec: "RFC 4918 §11.5", specURL: "https://www.rfc-editor.org/rfc/rfc4918",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["webdav", "磁盘", "空间", "disk"]
        ),
        HTTPStatusInfo(
            code: 508, phrase: "Loop Detected", zhName: "检测到循环",
            zhDescription: "WebDAV 扩展：服务器处理 Depth: infinity 的请求时检测到无限循环。",
            enDescription: "WebDAV: the server detected an infinite loop while processing a Depth: infinity request.",
            zhScenario: "WebDAV 绑定互相引用形成环。",
            zhTip: "检查资源之间的绑定关系。",
            headers: [], spec: "RFC 5842 §7.2", specURL: "https://www.rfc-editor.org/rfc/rfc5842",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["webdav", "循环"]
        ),
        HTTPStatusInfo(
            code: 510, phrase: "Not Extended", zhName: "未扩展",
            zhDescription: "请求未满足访问资源所需的扩展策略（HTTP 扩展框架）。",
            enDescription: "The request doesn't meet the extension policy required to access the resource (HTTP Extension Framework).",
            zhScenario: "几乎没有实际使用。",
            zhTip: "RFC 2774 已被标记为历史文档，不建议使用。",
            headers: [], spec: "RFC 2774 §7", specURL: "https://www.rfc-editor.org/rfc/rfc2774",
            cacheable: false, flag: .deprecated, vendor: nil,
            keywords: []
        ),
        HTTPStatusInfo(
            code: 511, phrase: "Network Authentication Required", zhName: "需要网络认证",
            zhDescription: "客户端需要先通过网络认证才能访问网络。",
            enDescription: "The client must authenticate before it can access the network.",
            zhScenario: "酒店、机场、咖啡店 Wi-Fi 的强制门户（Captive Portal）登录页。",
            zhTip: "由拦截流量的网关产生，源站不应返回该状态码。",
            headers: [], spec: "RFC 6585 §6", specURL: "https://www.rfc-editor.org/rfc/rfc6585",
            cacheable: false, flag: nil, vendor: nil,
            keywords: ["wifi", "门户", "captive portal"]
        ),
        HTTPStatusInfo(
            code: 520, phrase: "Web Server Returned an Unknown Error", zhName: "源站返回未知错误",
            zhDescription: "Cloudflare 专用：源站返回了空的、未知的或无法解析的响应。",
            enDescription: "Cloudflare only: the origin returned an empty, unknown or unparsable response.",
            zhScenario: "源站进程崩溃、响应头过大、源站直接重置连接。",
            zhTip: "直连源站复现问题，检查源站日志与响应头大小。",
            headers: [], spec: "Cloudflare 扩展", specURL: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
            cacheable: false, flag: .unofficial, vendor: "Cloudflare",
            keywords: ["cloudflare", "cdn", "源站"]
        ),
        HTTPStatusInfo(
            code: 521, phrase: "Web Server Is Down", zhName: "源站已宕机",
            zhDescription: "Cloudflare 专用：源站拒绝了 Cloudflare 的连接。",
            enDescription: "Cloudflare only: the origin refused Cloudflare's connection.",
            zhScenario: "源站服务未启动，或防火墙拦截了 Cloudflare 的 IP 段。",
            zhTip: "确认源站在运行，并在防火墙中放行 Cloudflare 的 IP 段。",
            headers: [], spec: "Cloudflare 扩展", specURL: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
            cacheable: false, flag: .unofficial, vendor: "Cloudflare",
            keywords: ["cloudflare", "cdn", "源站", "宕机"]
        ),
        HTTPStatusInfo(
            code: 522, phrase: "Connection Timed Out", zhName: "连接超时",
            zhDescription: "Cloudflare 专用：与源站建立 TCP 连接超时。",
            enDescription: "Cloudflare only: the TCP connection to the origin timed out.",
            zhScenario: "源站负载过高、网络丢包、防火墙静默丢弃了 Cloudflare 的请求。",
            zhTip: "检查源站负载与防火墙规则，确认 DNS 指向的源站 IP 正确。",
            headers: [], spec: "Cloudflare 扩展", specURL: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
            cacheable: false, flag: .unofficial, vendor: "Cloudflare",
            keywords: ["cloudflare", "cdn", "超时"]
        ),
        HTTPStatusInfo(
            code: 523, phrase: "Origin Is Unreachable", zhName: "源站不可达",
            zhDescription: "Cloudflare 专用：无法路由到源站。",
            enDescription: "Cloudflare only: the origin can't be reached.",
            zhScenario: "源站 DNS 记录错误、源站 IP 变更。",
            zhTip: "核对 DNS 中源站的 A / AAAA 记录。",
            headers: [], spec: "Cloudflare 扩展", specURL: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
            cacheable: false, flag: .unofficial, vendor: "Cloudflare",
            keywords: ["cloudflare", "cdn", "dns"]
        ),
        HTTPStatusInfo(
            code: 524, phrase: "A Timeout Occurred", zhName: "响应超时",
            zhDescription: "Cloudflare 专用：已连上源站，但源站在默认 100 秒内没有返回 HTTP 响应。",
            enDescription: "Cloudflare only: connected to the origin, but it didn't send an HTTP response within the default 100 seconds.",
            zhScenario: "长时间运行的导出、报表等同步接口。",
            zhTip: "把长任务改为异步（202 + 轮询），或让大流量接口绕过代理。",
            headers: [], spec: "Cloudflare 扩展", specURL: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
            cacheable: false, flag: .unofficial, vendor: "Cloudflare",
            keywords: ["cloudflare", "cdn", "超时"]
        ),
        HTTPStatusInfo(
            code: 525, phrase: "SSL Handshake Failed", zhName: "SSL 握手失败",
            zhDescription: "Cloudflare 专用：与源站的 SSL/TLS 握手失败。",
            enDescription: "Cloudflare only: the SSL/TLS handshake with the origin failed.",
            zhScenario: "源站没有配置证书、不支持 SNI 或加密套件不匹配。",
            zhTip: "确认源站 443 端口已正确配置证书与 TLS 版本。",
            headers: [], spec: "Cloudflare 扩展", specURL: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
            cacheable: false, flag: .unofficial, vendor: "Cloudflare",
            keywords: ["cloudflare", "ssl", "tls", "https"]
        ),
        HTTPStatusInfo(
            code: 526, phrase: "Invalid SSL Certificate", zhName: "源站证书无效",
            zhDescription: "Cloudflare 专用：在 Full (strict) 模式下，源站证书无法通过校验。",
            enDescription: "Cloudflare only: in Full (strict) mode, the origin certificate failed validation.",
            zhScenario: "源站证书过期、自签名或域名不匹配。",
            zhTip: "更换为受信任的证书（或 Cloudflare Origin CA 证书）。",
            headers: [], spec: "Cloudflare 扩展", specURL: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
            cacheable: false, flag: .unofficial, vendor: "Cloudflare",
            keywords: ["cloudflare", "ssl", "证书", "https"]
        ),
    ]
}
