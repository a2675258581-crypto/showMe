import Foundation

// 编辑器语言表：扩展名 / 文件名识别、内容嗅探、格式化器与注释符号。

/// 格式化器种类。App 按种类调用对应实现（JSON.swift、XML 美化、Prettier、SQL 格式化）。
public enum FormatterKind: Sendable, Hashable {
    case json
    case xml
    case prettier(parser: String)
    case sql(dialect: String)
}

/// 块注释的起止符号，如 `/*` 与 `*/`。
public struct BlockComment: Sendable, Hashable {
    public let open: String
    public let close: String

    public init(_ open: String, _ close: String) {
        self.open = open
        self.close = close
    }
}

public struct EditorLanguage: Sendable, Hashable, Identifiable {
    /// 稳定 id，如 "plain"、"markdown"、"json"；也是 `Highlighter` 的语言参数。
    public let id: String
    /// 显示名，如 "JSON"。纯文本请用 `displayName(_:)` 取本地化名称。
    public let name: String
    /// 小写扩展名（不带点）
    public let extensions: [String]
    /// 精确文件名，如 "Dockerfile"、".gitignore"
    public let fileNames: [String]
    /// 文字类文档：App 用比例字体和窄栏排版
    public let isProse: Bool
    /// 默认格式化器；没有则为 nil
    public let formatter: FormatterKind?
    public let lineComment: String?
    public let blockComment: BlockComment?
    /// 个别扩展名使用不同的格式化器（如 .json5 → prettier json5、.vue → prettier vue）
    public let formatterOverrides: [String: FormatterKind]

    public init(
        id: String,
        name: String,
        extensions: [String] = [],
        fileNames: [String] = [],
        isProse: Bool = false,
        formatter: FormatterKind? = nil,
        lineComment: String? = nil,
        blockComment: BlockComment? = nil,
        formatterOverrides: [String: FormatterKind] = [:]
    ) {
        self.id = id
        self.name = name
        self.extensions = extensions
        self.fileNames = fileNames
        self.isProse = isProse
        self.formatter = formatter
        self.lineComment = lineComment
        self.blockComment = blockComment
        self.formatterOverrides = formatterOverrides
    }

    /// 界面显示名：纯文本按界面语言显示「纯文本 / Plain Text」，其余用 `name`。
    public func displayName(_ lang: Lang) -> String {
        id == "plain" ? lang.t("纯文本", "Plain Text") : name
    }

    /// 回车时行尾冒号也加一级缩进（Python、YAML）
    public var indentsAfterColon: Bool {
        id == "python" || id == "yaml"
    }

    /// 按文件名选格式化器：先看扩展名覆盖表，再用默认值。
    public func formatter(forFileName fileName: String?) -> FormatterKind? {
        guard let fileName, !formatterOverrides.isEmpty else { return formatter }
        let name = EditorLanguage.baseName(fileName).lowercased()
        if let override = formatterOverrides[name] { return override }
        if let ext = EditorLanguage.fileExtension(of: name), let override = formatterOverrides[ext] { return override }
        return formatter
    }
}

// MARK: - 语言表

extension EditorLanguage {
    private static let cBlock = BlockComment("/*", "*/")
    private static let htmlBlock = BlockComment("<!--", "-->")

    private static func cLike(
        _ id: String, _ name: String, _ exts: [String], fileNames: [String] = [],
        formatter: FormatterKind? = nil, overrides: [String: FormatterKind] = [:]
    ) -> EditorLanguage {
        EditorLanguage(id: id, name: name, extensions: exts, fileNames: fileNames, formatter: formatter,
                       lineComment: "//", blockComment: cBlock, formatterOverrides: overrides)
    }

    private static func hashComment(
        _ id: String, _ name: String, _ exts: [String], fileNames: [String] = [], formatter: FormatterKind? = nil
    ) -> EditorLanguage {
        EditorLanguage(id: id, name: name, extensions: exts, fileNames: fileNames, formatter: formatter, lineComment: "#")
    }

    public static let plain = EditorLanguage(id: "plain", name: "Plain Text", extensions: ["txt", "text"], isProse: true)

    /// 全部内置语言（顺序即菜单顺序：纯文本、Markdown 在前，其余大致按常用程度）
    public static let all: [EditorLanguage] = [
        plain,
        EditorLanguage(id: "markdown", name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"],
                       isProse: true, formatter: .prettier(parser: "markdown"), blockComment: htmlBlock),
        EditorLanguage(id: "json", name: "JSON",
                       extensions: ["json", "jsonc", "json5", "geojson", "webmanifest", "har"],
                       fileNames: [".babelrc", ".jshintrc", ".swcrc"],
                       formatter: .json,
                       formatterOverrides: ["jsonc": .prettier(parser: "json5"), "json5": .prettier(parser: "json5"),
                                            ".babelrc": .prettier(parser: "json5"), ".jshintrc": .prettier(parser: "json5"),
                                            ".swcrc": .prettier(parser: "json5")]),
        cLike("javascript", "JavaScript", ["js", "mjs", "cjs", "jsx"], formatter: .prettier(parser: "babel")),
        cLike("typescript", "TypeScript", ["ts", "tsx", "mts", "cts"], formatter: .prettier(parser: "babel-ts")),
        EditorLanguage(id: "css", name: "CSS", extensions: ["css"], formatter: .prettier(parser: "css"), blockComment: cBlock),
        cLike("scss", "SCSS", ["scss"], formatter: .prettier(parser: "scss")),
        cLike("less", "Less", ["less"], formatter: .prettier(parser: "less")),
        EditorLanguage(id: "html", name: "HTML", extensions: ["html", "htm", "xhtml", "shtml", "vue"],
                       formatter: .prettier(parser: "html"), blockComment: htmlBlock,
                       formatterOverrides: ["vue": .prettier(parser: "vue")]),
        EditorLanguage(id: "xml", name: "XML",
                       extensions: ["xml", "plist", "svg", "xsd", "xsl", "xslt", "rss", "atom", "storyboard", "xib",
                                    "entitlements", "csproj", "fsproj", "vbproj", "props", "targets", "resx", "wsdl",
                                    "kml", "gpx", "opml", "xaml", "xliff", "xlf"],
                       formatter: .xml, blockComment: htmlBlock),
        hashComment("yaml", "YAML", ["yaml", "yml"], fileNames: [".clang-format", ".clangd"], formatter: .prettier(parser: "yaml")),
        hashComment("toml", "TOML", ["toml"], fileNames: ["Cargo.lock", "Pipfile", "poetry.lock", "uv.lock"]),
        hashComment("ini", "INI", ["ini", "cfg", "conf", "properties", "env", "editorconfig"],
                    fileNames: [".env", ".editorconfig", ".gitconfig", ".gitmodules", ".gitattributes", ".npmrc", ".yarnrc",
                                ".flake8", ".pylintrc", "setup.cfg", "tox.ini"]),
        EditorLanguage(id: "sql", name: "SQL", extensions: ["sql", "psql", "pgsql", "mysql", "ddl", "dml"],
                       formatter: .sql(dialect: "sql"), lineComment: "--", blockComment: cBlock),
        hashComment("shell", "Shell", ["sh", "bash", "zsh", "fish", "command", "ksh", "tool"],
                    fileNames: [".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".profile", ".zshrc", ".zprofile",
                                ".zshenv", ".zlogin", ".zlogout", ".envrc", "PKGBUILD"]),
        hashComment("python", "Python", ["py", "pyw", "pyi", "pyx", "gyp", "bzl"],
                    fileNames: ["SConstruct", "SConscript", "BUILD", "WORKSPACE", "Snakefile"]),
        cLike("go", "Go", ["go"]),
        cLike("java", "Java", ["java"]),
        cLike("kotlin", "Kotlin", ["kt", "kts"]),
        cLike("swift", "Swift", ["swift"]),
        cLike("rust", "Rust", ["rs"]),
        cLike("c", "C", ["c", "h"]),
        cLike("cpp", "C++", ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ipp", "tpp", "ino", "cu"]),
        cLike("objective-c", "Objective-C", ["m", "mm"]),
        cLike("csharp", "C#", ["cs", "csx"]),
        cLike("php", "PHP", ["php", "phtml", "php3", "php4", "php5", "phps"]),
        hashComment("ruby", "Ruby", ["rb", "rake", "gemspec", "ru", "podspec"],
                    fileNames: ["Gemfile", "Rakefile", "Podfile", "Fastfile", "Appfile", "Matchfile", "Brewfile", "Vagrantfile",
                                "Guardfile", "Dangerfile"]),
        EditorLanguage(id: "lua", name: "Lua", extensions: ["lua"], lineComment: "--", blockComment: BlockComment("--[[", "]]")),
        cLike("dart", "Dart", ["dart"]),
        cLike("scala", "Scala", ["scala", "sc", "sbt"]),
        hashComment("r", "R", ["r"], fileNames: [".Rprofile"]),
        hashComment("graphql", "GraphQL", ["graphql", "gql", "graphqls"], formatter: .prettier(parser: "graphql")),
        hashComment("dockerfile", "Dockerfile", ["dockerfile", "containerfile"], fileNames: ["Dockerfile", "Containerfile"]),
        hashComment("makefile", "Makefile", ["mk", "mak", "make"], fileNames: ["Makefile", "makefile", "GNUmakefile", "BSDmakefile"]),
        EditorLanguage(id: "diff", name: "Diff", extensions: ["diff", "patch", "rej"]),
        EditorLanguage(id: "log", name: "Log", extensions: ["log"]),
        EditorLanguage(id: "csv", name: "CSV", extensions: ["csv", "tsv", "tab", "psv"]),
        hashComment("ignore", "Ignore", ["gitignore", "dockerignore", "npmignore"],
                    fileNames: [".gitignore", ".dockerignore", ".npmignore", ".prettierignore", ".eslintignore", ".hgignore",
                                ".stylelintignore", ".vscodeignore", ".slugignore", ".gcloudignore"]),
    ]

    private static let byIDTable: [String: EditorLanguage] = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

    private static let byExtensionTable: [String: EditorLanguage] = {
        var t: [String: EditorLanguage] = [:]
        for lang in all { for ext in lang.extensions where t[ext] == nil { t[ext] = lang } }
        return t
    }()

    private static let byFileNameTable: [String: EditorLanguage] = {
        var t: [String: EditorLanguage] = [:]
        for lang in all { for name in lang.fileNames where t[name] == nil { t[name] = lang } }
        return t
    }()

    private static let byLowerFileNameTable: [String: EditorLanguage] = {
        var t: [String: EditorLanguage] = [:]
        for lang in all { for name in lang.fileNames where t[name.lowercased()] == nil { t[name.lowercased()] = lang } }
        return t
    }()

    /// 常见别名（Markdown 代码块的 info string、工具输出的 language 等）
    private static let aliases: [String: String] = [
        "text": "plain", "txt": "plain", "plaintext": "plain", "none": "plain", "": "plain",
        "md": "markdown", "gfm": "markdown",
        "jsonc": "json", "json5": "json",
        "js": "javascript", "jsx": "javascript", "node": "javascript", "ecmascript": "javascript", "mjs": "javascript",
        "ts": "typescript", "tsx": "typescript",
        "htm": "html", "xhtml": "html", "vue": "html",
        "svg": "xml", "plist": "xml", "xsl": "xml",
        "yml": "yaml",
        "sh": "shell", "bash": "shell", "zsh": "shell", "fish": "shell", "console": "shell", "shellscript": "shell",
        "py": "python", "python3": "python",
        "golang": "go",
        "kt": "kotlin", "kts": "kotlin",
        "rs": "rust",
        "c++": "cpp", "cxx": "cpp", "hpp": "cpp",
        "objc": "objective-c", "objectivec": "objective-c", "obj-c": "objective-c", "objective-c++": "objective-c",
        "cs": "csharp", "c#": "csharp",
        "rb": "ruby",
        "gql": "graphql",
        "docker": "dockerfile",
        "make": "makefile", "mk": "makefile",
        "patch": "diff",
        "tsv": "csv",
        "gitignore": "ignore",
        "properties": "ini", "env": "ini", "dotenv": "ini", "cfg": "ini", "conf": "ini",
        "postgres": "sql", "postgresql": "sql", "mysql": "sql", "sqlite": "sql", "plsql": "sql",
    ]

    /// 按 id 查找（也接受常见别名和扩展名），找不到时返回纯文本。
    public static func byID(_ id: String) -> EditorLanguage {
        let key = id.trimmingCharacters(in: .whitespaces).lowercased()
        if let lang = byIDTable[key] { return lang }
        if let alias = aliases[key], let lang = byIDTable[alias] { return lang }
        if let lang = byExtensionTable[key] { return lang }
        return plain
    }

    /// 按扩展名查找（不区分大小写，可带点）
    public static func byExtension(_ ext: String) -> EditorLanguage? {
        var key = ext.lowercased()
        if key.hasPrefix(".") { key.removeFirst() }
        return byExtensionTable[key]
    }

    /// 只看文件名识别，识别不了返回 nil。
    public static func detect(fileName: String) -> EditorLanguage? {
        let name = baseName(fileName)
        guard !name.isEmpty else { return nil }
        if let lang = byFileNameTable[name] { return lang }
        let lower = name.lowercased()
        if let lang = byLowerFileNameTable[lower] { return lang }
        // .env.local、Dockerfile.dev、Makefile.inc 这类带后缀的变体
        if lower.hasPrefix(".env.") { return byIDTable["ini"] }
        if lower.hasPrefix("dockerfile.") || lower.hasPrefix("containerfile.") { return byIDTable["dockerfile"] }
        if lower.hasPrefix("makefile.") { return byIDTable["makefile"] }
        if let ext = fileExtension(of: name), let lang = byExtensionTable[ext] { return lang }
        return nil
    }

    /// 识别语言：先看文件名（扩展名不区分大小写、精确文件名），否则嗅探内容，最后回退纯文本。
    public static func detect(fileName: String?, content: String?) -> EditorLanguage {
        if let fileName, let lang = detect(fileName: fileName) { return lang }
        if let content, let lang = sniff(content) { return lang }
        return plain
    }

    // MARK: 文件名工具

    static func baseName(_ path: String) -> String {
        if let slash = path.lastIndex(where: { $0 == "/" || $0 == "\\" }) {
            return String(path[path.index(after: slash)...])
        }
        return path
    }

    /// 小写扩展名；".env" 这种只有前导点的返回 "env"
    static func fileExtension(of name: String) -> String? {
        guard let dot = name.lastIndex(of: ".") else { return nil }
        let ext = name[name.index(after: dot)...]
        return ext.isEmpty ? nil : ext.lowercased()
    }
}

// MARK: - 内容嗅探

extension EditorLanguage {
    private static let htmlTags: Set<String> = [
        "html", "head", "body", "div", "span", "p", "a", "table", "ul", "ol", "li", "script", "style", "meta", "link",
        "section", "header", "footer", "nav", "main", "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "img",
        "form", "input", "button", "template", "br", "hr", "pre", "code", "title", "iframe", "video", "audio", "canvas",
        "label", "select", "textarea", "strong", "em", "b", "i", "blockquote", "figure", "picture", "source", "noscript",
    ]

    /// 嗅探未命名文本的语言；没有把握时返回 nil。
    public static func sniff(_ content: String) -> EditorLanguage? {
        // 只看开头一段，避免大文件拖慢
        var head = Substring(content)
        if head.first == "\u{FEFF}" { head = head.dropFirst() }
        let trimmed = head.drop(while: { $0.isWhitespace })
        guard let first = trimmed.first else { return nil }

        // 1. JSON：以 { 或 [ 开头且能严格解析
        if first == "{" || first == "[" {
            if content.utf8.count <= 8 << 20, (try? JSON.parse(String(trimmed))) != nil { return byIDTable["json"] }
        }

        // 2. 标记语言
        if first == "<" {
            let probe = String(trimmed.prefix(512)).lowercased()
            if probe.hasPrefix("<?xml") { return byIDTable["xml"] }
            if probe.hasPrefix("<!doctype html") { return byIDTable["html"] }
            if probe.hasPrefix("<!--") || probe.hasPrefix("<!doctype") { return byIDTable["xml"] }
            let afterLT = probe.dropFirst()
            let tag = afterLT.prefix(while: { $0.isLetter || $0.isNumber || $0 == "-" || $0 == ":" || $0 == "_" })
            if let c = afterLT.first, c.isLetter, !tag.isEmpty {
                return htmlTags.contains(String(tag)) ? byIDTable["html"] : byIDTable["xml"]
            }
        }

        // 3. 首行 shebang
        if head.hasPrefix("#!") {
            let line = head.prefix(while: { $0 != "\n" && $0 != "\r" })
            return interpreterLanguage(String(line.dropFirst(2)))
        }

        // 4. diff
        if trimmed.hasPrefix("diff --git ") || trimmed.hasPrefix("--- ") && trimmed.contains("\n+++ ") || trimmed.hasPrefix("Index: ") {
            return byIDTable["diff"]
        }

        // 5. Markdown：前若干行出现 ATX 标题、列表或代码围栏
        var headings = 0, lists = 0, fences = 0, scanned = 0
        for rawLine in trimmed.prefix(16 * 1024).split(separator: "\n", omittingEmptySubsequences: true) {
            scanned += 1
            if scanned > 40 { break }
            let line = rawLine.drop(while: { $0 == " " })
            if line.hasPrefix("```") || line.hasPrefix("~~~") { fences += 1 }
            if line.hasPrefix("#") {
                let hashes = line.prefix(while: { $0 == "#" }).count
                let rest = line.dropFirst(hashes)
                if hashes <= 6, let c = rest.first, c == " " || c == "\t" { headings += 1 }
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
                lists += 1
            } else if let dot = line.firstIndex(where: { $0 == "." || $0 == ")" }), dot > line.startIndex,
                      line[line.startIndex..<dot].allSatisfy(\.isASCIIDigitChar),
                      line[line.index(after: dot)...].first == " " {
                lists += 1
            }
        }
        if headings > 0 || lists >= 2 || fences >= 2 { return byIDTable["markdown"] }
        return nil
    }

    /// shebang 解释器 → 语言，如 "/usr/bin/env python3" → python
    static func interpreterLanguage(_ shebang: String) -> EditorLanguage? {
        let parts = shebang.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard var program = parts.first.map(baseName) else { return byIDTable["shell"] }
        if program == "env" {
            // 跳过 env 的参数（-S 等）和变量赋值
            program = parts.dropFirst().first(where: { !$0.hasPrefix("-") && !$0.contains("=") }).map(baseName) ?? ""
        }
        let p = program.lowercased()
        if p.hasPrefix("python") || p == "pypy" || p.hasPrefix("pypy") || p == "uv" { return byIDTable["python"] }
        if p == "node" || p == "nodejs" || p == "bun" || p == "deno" || p == "zx" || p == "osascript" { return byIDTable["javascript"] }
        if p == "ts-node" || p == "tsx" { return byIDTable["typescript"] }
        if p.hasPrefix("ruby") { return byIDTable["ruby"] }
        if p.hasPrefix("php") { return byIDTable["php"] }
        if p.hasPrefix("lua") { return byIDTable["lua"] }
        if p == "swift" { return byIDTable["swift"] }
        if p == "rscript" { return byIDTable["r"] }
        if p == "make" { return byIDTable["makefile"] }
        return byIDTable["shell"]
    }
}

private extension Character {
    var isASCIIDigitChar: Bool { isASCII && isNumber }
}
