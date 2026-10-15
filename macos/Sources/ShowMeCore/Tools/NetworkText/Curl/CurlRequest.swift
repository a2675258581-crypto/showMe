import Foundation

// 与具体工具无关的结构化 HTTP 请求：cURL 解析结果、代码生成的输入。

public struct HTTPHeader: Codable, Hashable, Sendable {
    public var name: String
    public var value: String

    public init(_ name: String, _ value: String) {
        self.name = name
        self.value = value
    }
}

public struct CurlFormPart: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable { case text, file }

    public var name: String
    /// 文本字段为字段值；文件字段为本地文件路径
    public var value: String
    public var kind: Kind
    /// 文件字段上传时使用的文件名（缺省为路径的文件名部分）
    public var filename: String?
    public var contentType: String?

    public init(name: String, value: String, kind: Kind = .text, filename: String? = nil, contentType: String? = nil) {
        self.name = name
        self.value = value
        self.kind = kind
        self.filename = filename
        self.contentType = contentType
    }

    /// 上传时使用的文件名
    public var effectiveFileName: String {
        filename ?? CurlRequest.pathBase(value)
    }
}

public enum CurlBody: Hashable, Sendable {
    case none
    case text(String)
    case multipart([CurlFormPart])
    /// 请求体来自本地文件（--data-binary @file、-T file）
    case file(String)

    public var isNone: Bool {
        if case .none = self { return true }
        return false
    }
}

public struct CurlBasicAuth: Codable, Hashable, Sendable {
    public var username: String
    public var password: String

    public init(username: String, password: String) {
        self.username = username
        self.password = password
    }
}

public struct CurlRequest: Hashable, Sendable {
    public var method: String
    public var url: String
    /// 按出现顺序保存，允许重名
    public var headers: [HTTPHeader]
    public var body: CurlBody
    public var auth: CurlBasicAuth?
    /// true：跟随重定向（-L）；false：明确不跟随；nil：沿用各语言默认行为
    public var followRedirects: Bool?
    /// 跳过 TLS 证书校验（-k）
    public var insecure: Bool
    /// 请求压缩响应（--compressed）
    public var compressed: Bool
    /// 整体超时，单位秒（-m）
    public var timeout: Double?

    public init(
        method: String = "GET",
        url: String,
        headers: [HTTPHeader] = [],
        body: CurlBody = .none,
        auth: CurlBasicAuth? = nil,
        followRedirects: Bool? = nil,
        insecure: Bool = false,
        compressed: Bool = false,
        timeout: Double? = nil
    ) {
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
        self.auth = auth
        self.followRedirects = followRedirects
        self.insecure = insecure
        self.compressed = compressed
        self.timeout = timeout
    }

    /// 不区分大小写取第一个同名请求头
    public func header(_ name: String) -> String? {
        let lower = name.lowercased()
        return headers.first { $0.name.lowercased() == lower }?.value
    }

    /// 路径的文件名部分（/ 与 \ 都算分隔符）
    static func pathBase(_ path: String) -> String {
        let scalars = Array(path.unicodeScalars)
        var start = scalars.count
        while start > 0, scalars[start - 1] != "/", scalars[start - 1] != "\\" { start -= 1 }
        let base = String(String.UnicodeScalarView(scalars[start...]))
        return base.isEmpty ? path : base
    }
}
