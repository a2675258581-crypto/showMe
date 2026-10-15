import Foundation
import XCTest
@testable import ShowMeCore

/// 假的脚本引擎：记录调用参数，按 handler 返回结果
final class FormatConvertFakeEngine: ScriptEngine, @unchecked Sendable {
    private let lock = NSLock()
    private var log: [(function: String, args: [String: String])] = []
    let handler: @Sendable (String, [String: String]) throws -> String

    init(_ handler: @escaping @Sendable (String, [String: String]) throws -> String) {
        self.handler = handler
    }

    var calls: [(function: String, args: [String: String])] {
        lock.lock()
        defer { lock.unlock() }
        return log
    }

    func call(_ function: String, _ args: [String: String]) throws -> String {
        lock.lock()
        log.append((function, args))
        lock.unlock()
        return try handler(function, args)
    }
}

final class FormatConvertEngineTests: XCTestCase {
    override func tearDown() {
        ToolEnvironment.script = nil
        super.tearDown()
    }

    @discardableResult
    func install(_ handler: @escaping @Sendable (String, [String: String]) throws -> String) -> FormatConvertFakeEngine {
        let e = FormatConvertFakeEngine(handler)
        ToolEnvironment.script = e
        return e
    }

    // MARK: 代码格式化

    func testCodeFormatterArgsMapping() throws {
        let engine = install { _, args in "formatted:" + (args["parser"] ?? "?") }
        let tool = CodeFormatterTool.spec
        let cases: [(String, String, String)] = [
            ("javascript", "babel", "javascript"), ("typescript", "babel-ts", "typescript"), ("jsx", "babel", "javascript"),
            ("css", "css", "css"), ("scss", "scss", "scss"), ("less", "less", "less"), ("html", "html", "html"),
            ("vue", "vue", "html"), ("markdown", "markdown", "markdown"), ("yaml", "yaml", "yaml"), ("graphql", "graphql", "graphql"),
        ]
        for (choice, parser, language) in cases {
            let r = try tool("x", options: ["lang": choice])
            XCTAssertEqual(r.primary?.value, "formatted:" + parser, choice)
            XCTAssertEqual(r.primary?.language, language, choice)
        }
        _ = try tool("const a=1", options: ["lang": "typescript", "indent": "tab", "printWidth": "100", "singleQuote": "1", "semi": "0", "trailingComma": "es5"])
        XCTAssertEqual(engine.calls.last?.function, "format")
        XCTAssertEqual(engine.calls.last?.args, [
            "code": "const a=1", "parser": "babel-ts", "tabWidth": "2", "useTabs": "1", "printWidth": "100",
            "singleQuote": "1", "semi": "0", "trailingComma": "es5",
        ])
        _ = try tool("a{b:c}", options: ["lang": "css", "indent": "4"])
        XCTAssertEqual(engine.calls.last?.args["tabWidth"], "4")
        XCTAssertEqual(engine.calls.last?.args["useTabs"], "0")
        XCTAssertEqual(engine.calls.last?.args["semi"], "1")
        XCTAssertEqual(engine.calls.last?.args["trailingComma"], "all")
        XCTAssertEqual(engine.calls.last?.args["printWidth"], "80")
        // 自动识别
        let auto = try tool("$x: 1px;\n.a { width: $x; }")
        XCTAssertEqual(engine.calls.last?.args["parser"], "scss")
        XCTAssertEqual(auto.primary?.language, "scss")
        XCTAssertEqual(auto.notes.first?.message, "自动识别：SCSS")
        _ = try tool(#"{"a": 1}"#, lang: .en)
        XCTAssertEqual(engine.calls.last?.args["parser"], "json5")
        let same = try tool("x", options: ["lang": "css"])
        XCTAssertTrue(same.notes.isEmpty)
    }

    func testCodeFormatterErrors() {
        install { _, _ in
            throw ScriptError(message: "\u{1B}[31mSyntaxError: Unexpected token, expected \",\" (1:15)\u{1B}[39m\n> 1 | const s = \"😀\" + {\n    |               ^")
        }
        let tool = CodeFormatterTool.spec
        XCTAssertThrowsError(try tool("const s = \"😀\" + {", options: ["lang": "javascript"])) { error in
            let e = error as? ToolError
            XCTAssertEqual(e?.message, "第 1 行第 14 列：意外的符号，此处应为 \",\"")
            XCTAssertEqual(e?.line, 1)
            XCTAssertEqual(e?.column, 14)
        }
        XCTAssertThrowsError(try tool("const s = \"😀\" + {", options: ["lang": "javascript"], lang: .en)) { error in
            XCTAssertEqual((error as? ToolError)?.message, "Line 1, column 14: Unexpected token, expected \",\"")
        }
        install { _, _ in throw ScriptError(message: "CssSyntaxError: <css input>:2:3: Unclosed block", line: 2, column: 3) }
        XCTAssertThrowsError(try tool("a {\n  b: c", options: ["lang": "css"])) { error in
            XCTAssertEqual((error as? ToolError)?.message, "第 2 行第 3 列：代码块没有闭合，缺少 }")
        }
        install { _, _ in throw ScriptError(message: "Maximum call stack size exceeded") }
        XCTAssertThrowsError(try tool("[[[", options: ["lang": "javascript"])) { error in
            XCTAssertTrue((error as? ToolError)?.message.contains("嵌套层级过深") ?? false)
            XCTAssertNil((error as? ToolError)?.line)
        }
        install { _, _ in throw ScriptError(message: "Totally new error") }
        XCTAssertThrowsError(try tool("x", options: ["lang": "yaml"])) { error in
            XCTAssertEqual((error as? ToolError)?.message, "Totally new error")
        }
        XCTAssertNil(CodeFormatter.translate("Totally new error"))
        XCTAssertEqual(CodeFormatter.translate("Missing semicolon."), "缺少分号")
        XCTAssertEqual(CodeFormatter.translate("Unknown word"), "无法识别的内容（可能缺少分号或冒号）")
        XCTAssertEqual(CodeFormatter.translate("Expected Name, found <EOF>."), "此处应为 Name，却遇到了 <EOF>")
        XCTAssertEqual(CodeFormatter.translate("Unexpected closing tag \"div\". It may happen when …"), "意外的结束标签 </div>：它可能已被其他标签提前闭合，或缺少对应的开始标签")

        ToolEnvironment.script = nil
        XCTAssertThrowsError(try tool("x", options: ["lang": "css"])) { error in
            XCTAssertEqual((error as? ToolError)?.message, "格式化引擎不可用")
        }
        XCTAssertThrowsError(try tool("x", options: ["lang": "css"], lang: .en)) { error in
            XCTAssertEqual((error as? ToolError)?.message, "The formatting engine is unavailable")
        }
    }

    func testDetectLanguage() {
        let cases: [(String, CodeFormatter.Detected?)] = [
            ("", nil), ("   ", nil),
            ("const a = 1", .javascript), ("console.log(\"hi\")", .javascript),
            ("let x: number = 1", .typescript), ("function f(a: string): void {}", .typescript),
            ("interface User {\n  id: number;\n  name: string;\n}", .typescript), ("const x = <T,>(a: T) => a", .typescript),
            ("const [v, setV] = useState<string>(\"\")", .typescript),
            ("import React from \"react\"\nexport const App = () => <div className=\"a\">Hi</div>", .jsx),
            ("export const App = (p: Props) => <Button onClick={p.go}>去</Button>", .tsx),
            ("<div className=\"a\">{x}</div>", .jsx),
            ("{\"a\": 1, \"b\": [true, null]}", .json), ("[1, 2, 3]", .json),
            ("{a: 1, b: 'x', // 注释\n}", .json5), ("// 配置\n{\n  port: 8080,\n}", .json5),
            ("<div class=\"a\">x</div>", .html), ("<!doctype html><html><body></body></html>", .html),
            ("<template><div/></template>\n<script>export default {}</script>", .vue),
            ("<button (click)=\"go()\">去</button>", .angular), ("<li *ngFor=\"let x of xs\">{{x}}</li>", .angular),
            (".a { color: red; }\n#b > p { margin: 0 }", .css), ("@media (max-width: 600px) {\n  .a { display: none; }\n}", .css),
            ("$x: 1px;\n.a { width: $x; }", .scss), (".a {\n  &:hover { color: red; }\n}", .scss),
            ("@x: 1px;\n.a { width: @x; }", .less),
            ("# 标题\n\n一段说明文字，介绍这个项目。\n\n- 列表项", .markdown), ("普通的一段中文文本", .markdown),
            ("name: demo\nversion: 1\nlist:\n  - a\n  - b", .yaml), ("# 注释\nkey: value\nother: 2", .yaml),
            ("query { me { id } }", .graphql), ("{ me { id name } }", .graphql),
            ("type User {\n  id: ID!\n  name: String\n  posts: [Post!]!\n}", .graphql),
            ("mutation Add($t: String!) { add(title: $t) { id } }", .graphql),
            ("const x = {aaaaaaaaaaaaaaaa:1,bbbbbbbbbbbbbbbbbbbb:2}", .javascript), ("x = {a:1}", .javascript),
            ("const style = {color:\"red\"}", .javascript), ("input[type=\"text\"]{border:0}", .css), ("a, b > c{margin:0}", .css),
        ]
        for (src, expected) in cases {
            XCTAssertEqual(CodeFormatter.detectLanguage(src), expected, src)
        }
    }

    func testDetectLanguageSamples() {
        let ts = #"""
        // 带重试与超时的请求封装
        export interface RequestOptions<T=unknown>{url:string;method?:'GET'|'POST'|'PUT'|'DELETE';body?:T;retries?:number;timeoutMs?:number}
        type Result<R>={ok:true;data:R}|{ok:false;error:string}

        export class HttpClient{
          private readonly baseUrl:string
          constructor(baseUrl:string,private token?:string){this.baseUrl=baseUrl.replace(/\/$/,'')}
          async request<R,T=unknown>({url,method='GET',body,retries=2,timeoutMs=8000}:RequestOptions<T>):Promise<Result<R>>{
            for(let attempt=0;attempt<=retries;attempt++){
              const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeoutMs)
              try{
                const res=await fetch(`${this.baseUrl}${url}`,{method,body:body?JSON.stringify(body):undefined,headers:{'Content-Type':'application/json',...(this.token?{Authorization:`Bearer ${this.token}`}:{})},signal:ctrl.signal})
                if(!res.ok)throw new Error(`HTTP ${res.status}`)
                return {ok:true,data:await res.json() as R}
              }catch(e){if(attempt===retries)return {ok:false,error:e instanceof Error?e.message:'请求失败'}}
              finally{clearTimeout(timer)}
            }
            return {ok:false,error:'unreachable'}
          }
        }

        """#
        XCTAssertEqual(CodeFormatter.detectLanguage(ts), .typescript)
        let start = Date()
        XCTAssertEqual(CodeFormatter.detectLanguage(String(repeating: ts, count: 2000)), .typescript)
        XCTAssertLessThan(Date().timeIntervalSince(start), 5)

        let yaml = """
        # GitHub Actions：推送时自动测试并部署
        name:   CI
        on:
          push: {branches: [main]}
          pull_request:
        jobs:
          test:
            runs-on: ubuntu-latest
            strategy:
              matrix:
                node: [ 20,22 ]
            steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with: {node-version: "${{ matrix.node }}", cache: npm}
            - run: npm ci
            - run:   npm test -- --coverage
            - name: 部署到生产环境
              if: github.ref == 'refs/heads/main'
              run: |
                npm run build
                npx wrangler deploy

        """
        XCTAssertEqual(CodeFormatter.detectLanguage(yaml), .yaml)
        let less = """
        // 主题变量与混入
        @primary:#0071e3;@radius:12px;
        .rounded(@r:@radius){border-radius:@r}
        .theme(@mode) when (@mode = dark){background:#1c1c1e;color:#f5f5f7}
        .panel{.rounded();padding:16px;border:1px solid fade(@primary,20%);
          .header{font-weight:600;color:darken(@primary,10%)}
          &:hover{box-shadow:0 4px 12px fade(#000,12%)}
          .theme(dark);
        }
        @media (max-width:768px){.panel{padding:12px;.rounded(8px)}}

        """
        XCTAssertEqual(CodeFormatter.detectLanguage(less), .less)
        let graphql = """
        # 查询用户订单（分页 + 片段）
        query GetOrders($userId:ID!,$first:Int=10,$after:String){user(id:$userId){id name orders(first:$first,after:$after,filter:{status:[PAID,SHIPPED]}){edges{node{...OrderFields}}pageInfo{hasNextPage endCursor}}}}
        fragment OrderFields on Order{id createdAt total{amount currency} items{product{name} quantity}}

        """
        XCTAssertEqual(CodeFormatter.detectLanguage(graphql), .graphql)
        let markdown = """
        # showMe 使用指南
        showMe 是一组**完全本地运行**的开发者小工具，打开即用。
        ## 快速开始
        1. 打开 [工具列表](/tools)
        2. 选择需要的工具

        | 工具 | 分类 | 快捷键 |
        |---|:-:|--:|
        | JSON 格式化 | 格式化 | ⌘J |

        ```js
        const  greeting={text:"你好，世界",emoji:'👋'}
        ```
        > 提示：所有数据都不会上传到服务器。

        """
        XCTAssertEqual(CodeFormatter.detectLanguage(markdown), .markdown)
    }

    // MARK: SQL

    func testSQLFormatArgsPlaceholdersAndOperatorCase() throws {
        let engine = install { _, args in (args["code"] ?? "").uppercased() }
        let tool = SQLFormatterTool.spec
        let r = try tool("select * from t where id = #{id} and name = ${name} and x = #{a.b}", options: ["dialect": "postgresql", "keywordCase": "lower", "indent": "tab", "linesBetweenQueries": "2"])
        XCTAssertEqual(engine.calls.last?.function, "sql")
        let args = engine.calls.last?.args ?? [:]
        XCTAssertEqual(args["language"], "postgresql")
        XCTAssertEqual(args["keywordCase"], "lower")
        XCTAssertEqual(args["tabWidth"], "2")
        XCTAssertEqual(args["useTabs"], "1")
        XCTAssertEqual(args["linesBetweenQueries"], "2")
        XCTAssertEqual(args["code"], "select * from t where id = zqph0x0q and name = zqph0x1q and x = zqph0x2q")
        // 占位符原样还原（引擎把它们转成了大写也能认出来）
        XCTAssertEqual(r.primary?.value, "SELECT * FROM T WHERE ID = #{id} AND NAME = ${name} AND X = #{a.b}")
        XCTAssertEqual(r.primary?.language, "sql")
        _ = try tool("select 1", options: ["indent": "4"])
        XCTAssertEqual(engine.calls.last?.args["tabWidth"], "4")
        XCTAssertEqual(engine.calls.last?.args["useTabs"], "0")
        XCTAssertEqual(engine.calls.last?.args["language"], "mysql")
        XCTAssertEqual(engine.calls.last?.args["keywordCase"], "upper")
        XCTAssertEqual(SQLFormatter.applyOperatorKeywordCase("a.like, 'is null' -- is null\nb is null", dialect: .mysql, keywordCase: .upper),
                       "a.like, 'is null' -- is null\nb IS NULL")
        install { _, args in args["code"] ?? "" }
        XCTAssertEqual(try tool("select a from t where b is not null and c like 'x%'").primary?.value, "select a from t where b IS NOT NULL and c LIKE 'x%'")
        // 原文里本来就有 zqph0x 时换一个前缀
        XCTAssertEqual(try SQLFormatter.format("select zqph0x, #{id}"), "select zqph0x, #{id}")
        XCTAssertEqual(try SQLFormatter.format("   \n"), "")
    }

    func testSQLDelimiterScripts() throws {
        install { _, args in "F(" + FC.jsTrim(args["code"] ?? "") + ")" }
        let proc = "DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1; -- one\n  SELECT 2;\nEND //\nDELIMITER ;\nCALL p();"
        XCTAssertEqual(try SQLFormatter.format(proc), "DELIMITER //\nF(CREATE PROCEDURE p()\nBEGIN\n  SELECT 1; -- one\n  SELECT 2;\nEND)//\nDELIMITER ;\nF(CALL p();)")
        XCTAssertEqual(try SQLFormatter.format("DELIMITER $$\nselect '$$' as a$$\nDELIMITER ;\nselect #{id};"),
                       "DELIMITER $$\nF(select '$$' as a)$$\nDELIMITER ;\nF(select #{id};)")
        XCTAssertTrue(SQLFormatter.delimiterCommands(Array("-- DELIMITER //\nselect 'DELIMITER //'".unicodeScalars), dialect: .mysql).isEmpty)
        XCTAssertEqual(SQLFormatter.delimiterCommands(Array("DELIMITER $$ -- note\nselect 1".unicodeScalars), dialect: .mysql).first?.delimiter, "$$")
        // 其它方言不处理 DELIMITER
        XCTAssertEqual(try SQLFormatter.format("DELIMITER //\nselect 1", options: SQLFormatter.Options(dialect: .postgresql)), "F(DELIMITER //\nselect 1)")
        // 报错位置换算回整段脚本
        install { _, args in
            if (args["code"] ?? "").contains("select (1") { throw ScriptError(message: "Parse error at token: «EOF» at line 2 column 11") }
            return args["code"] ?? ""
        }
        XCTAssertThrowsError(try SQLFormatter.format("DELIMITER //\nselect (1 //\nDELIMITER ;")) { error in
            let e = error as? ToolError
            XCTAssertEqual([e?.line, e?.column], [2, 11])
            XCTAssertTrue(e?.message.contains("意外结束") ?? false)
        }
    }

    func testSQLErrors() {
        install { _, _ in throw ScriptError(message: "Parse error at token: ) at line 3 column 13\nsomething") }
        XCTAssertThrowsError(try SQLFormatter.format("select a\nfrom t\nwhere b = 1 )")) { error in
            let e = error as? ToolError
            XCTAssertEqual([e?.line, e?.column], [3, 13])
            XCTAssertEqual(e?.message, "第 3 行第 13 列：意外的右括号 )：括号不匹配，或括号前的表达式不完整（当前方言：MySQL。若语句属于其他数据库，可尝试切换方言。）")
        }
        XCTAssertThrowsError(try SQLFormatter.format("select a\nfrom t\nwhere b = 1 )", lang: .en)) { error in
            XCTAssertTrue((error as? ToolError)?.message.hasPrefix("Line 3, column 13: Unexpected ): ") ?? false)
        }
        // sql-formatter 按 UTF-16 计列：😀 算 2 列
        install { _, _ in throw ScriptError(message: "Parse error at token: «EOF» at line 1 column 32") }
        XCTAssertThrowsError(try SQLFormatter.format("select '😀😀', x from t where (")) { error in
            XCTAssertEqual((error as? ToolError)?.column, 30)
        }
        install { _, _ in throw ScriptError(message: "Parse error: Unexpected \"¥😀😀😀😀\" at line 1 column 31 something") }
        XCTAssertThrowsError(try SQLFormatter.format("select 1 from t where a = 'x' ¥😀😀😀😀😀")) { error in
            XCTAssertTrue((error as? ToolError)?.message.contains("无法识别的内容：¥😀😀😀😀") ?? false)
        }
        install { _, _ in throw ScriptError(message: "Parse error: Unexpected \"'abc\" at line 1 column 27") }
        XCTAssertThrowsError(try SQLFormatter.format("select a from t where b = 'abc")) { error in
            let e = error as? ToolError
            XCTAssertTrue(e?.message.contains("没有闭合") ?? false)
            XCTAssertEqual(e?.column, 27)
        }
        install { _, _ in throw ScriptError(message: "boom\nstack") }
        XCTAssertThrowsError(try SQLFormatter.format("x")) { error in
            XCTAssertTrue((error as? ToolError)?.message.hasPrefix("格式化失败：boom（") ?? false)
        }
        ToolEnvironment.script = nil
        XCTAssertThrowsError(try SQLFormatterTool.spec("select 1", lang: .en)) { error in
            XCTAssertEqual((error as? ToolError)?.message, "The formatting engine is unavailable")
        }
        // 压缩不需要引擎
        XCTAssertEqual(try SQLFormatterTool.spec("select 1 -- c\n, 2", options: ["mode": "minify"]).primary?.value, "select 1,2")
    }

    // MARK: JSON ⇄ YAML

    func testJSONToYAML() throws {
        let engine = install { _, args in "yaml(" + (args["json"] ?? "") + ")\n" }
        let tool = JSONYAMLTool.spec
        let r = try tool("{\n  \"b\": 1,\n  \"a\": [true, null]\n}", options: ["indent": "4", "sortKeys": "1"])
        XCTAssertEqual(engine.calls.last?.function, "jsonToYaml")
        XCTAssertEqual(engine.calls.last?.args, ["json": #"{"b":1,"a":[true,null]}"#, "indent": "4", "sortKeys": "1"])
        XCTAssertEqual(r.primary?.value, "yaml(" + #"{"b":1,"a":[true,null]}"# + ")\n")
        XCTAssertEqual(r.primary?.language, "yaml")
        let multi = try tool("[{\"a\":1},{\"b\":2}]", options: ["multiDoc": "1"])
        XCTAssertEqual(multi.primary?.value, "---\nyaml({\"a\":1})\n---\nyaml({\"b\":2})\n")
        XCTAssertEqual(multi.notes.first?.message, "共 2 个文档")
        XCTAssertEqual(engine.calls.last?.args["indent"], "2")
        XCTAssertEqual(engine.calls.last?.args["sortKeys"], "0")
        let big = try tool(#"{"id":12345678901234567890,"ok":9007199254740991,"pi":3.14159265358979323846,"x":1.50000000000000000}"#)
        XCTAssertEqual(big.notes.count, 1)
        XCTAssertTrue(big.notes[0].message.contains("12345678901234567890"))
        XCTAssertTrue(big.notes[0].message.contains("3.14159265358979323846"))
        XCTAssertFalse(big.notes[0].message.contains("9007199254740991"))
        XCTAssertFalse(big.notes[0].message.contains("1.5000"))
        // JSON 错误：先用本地解析器定位，不调用引擎
        let before = engine.calls.count
        XCTAssertThrowsError(try tool("{\n  \"a\": 1\n  \"b\": 2\n}")) { error in
            XCTAssertEqual((error as? ToolError)?.line, 3)
        }
        XCTAssertEqual(engine.calls.count, before)
        XCTAssertEqual(try JSONYAML.jsonToYAML("  ").output, "")
    }

    func testYAMLToJSON() throws {
        let engine = install { _, _ in #"{"name":"demo","list":["a","b"],"n":12345678901234567890,"cfg":{"z":1,"a":2}}"# }
        let tool = JSONYAMLTool.spec
        let r = try tool("name: demo", options: ["mode": "yaml2json", "indent": "4", "sortKeys": "1"])
        XCTAssertEqual(engine.calls.last?.function, "yamlToJson")
        XCTAssertEqual(engine.calls.last?.args, ["code": "name: demo"])
        XCTAssertEqual(r.primary?.value, "{\n    \"cfg\": {\n        \"a\": 2,\n        \"z\": 1\n    },\n    \"list\": [\n        \"a\",\n        \"b\"\n    ],\n    \"n\": 12345678901234567890,\n    \"name\": \"demo\"\n}")
        XCTAssertEqual(r.primary?.language, "json")
        install { _, _ in throw ScriptError(message: "bad indentation of a mapping entry (3:5)\n\n 1 | a: 1\n 2 | b:\n 3 |     c: 2\n---------^") }
        XCTAssertThrowsError(try tool("a: 1\nb:\n    c: 2", options: ["mode": "yaml2json"])) { error in
            let e = error as? ToolError
            XCTAssertEqual(e?.message, "第 3 行第 5 列：映射项缩进不正确")
            XCTAssertEqual([e?.line, e?.column], [3, 5])
        }
        XCTAssertThrowsError(try tool("a: 1\nb:\n    c: 2", options: ["mode": "yaml2json"], lang: .en)) { error in
            XCTAssertEqual((error as? ToolError)?.message, "Line 3, column 5: bad indentation of a mapping entry")
        }
        install { _, _ in throw ScriptError(message: "unidentified alias \"base\"", line: 4, column: 7) }
        XCTAssertThrowsError(try tool("x: *base", options: ["mode": "yaml2json"])) { error in
            XCTAssertEqual((error as? ToolError)?.message, "第 4 行第 7 列：找不到锚点 &base（别名 *base 必须在锚点定义之后使用）")
        }
        install { _, _ in "not json" }
        XCTAssertThrowsError(try tool("x: 1", options: ["mode": "yaml2json"]))
        install { _, _ in "" }
        XCTAssertEqual(try tool("# only comment", options: ["mode": "yaml2json"]).primary?.value, "")
        ToolEnvironment.script = nil
        XCTAssertThrowsError(try tool("a: 1", options: ["mode": "yaml2json"])) { error in
            XCTAssertEqual((error as? ToolError)?.message, "格式化引擎不可用")
        }
    }

    func testRegistryHasAllTools() {
        let ids = FormatConvertTools.all.map(\.id)
        XCTAssertEqual(ids, ["xml-formatter", "code-formatter", "sql-formatter", "json-yaml", "json-xml", "json-csv", "json-to-types"])
        for tool in FormatConvertTools.all {
            XCTAssertNotNil(ToolRegistry.tool(tool.id))
            XCTAssertFalse(tool.name.en.isEmpty)
            XCTAssertFalse(tool.summary.en.isEmpty)
            XCTAssertLessThanOrEqual(tool.fields.filter { $0.visibleWhen == nil }.count, 6, tool.id)
            for f in tool.fields {
                XCTAssertFalse(f.label.zh.isEmpty)
                XCTAssertFalse(f.label.en.isEmpty)
            }
        }
    }
}
