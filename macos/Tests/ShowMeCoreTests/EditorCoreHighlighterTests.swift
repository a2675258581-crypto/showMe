import Foundation
import XCTest
@testable import ShowMeCore

/// 分词结果 + 按子串查询种类的小工具
struct EditorCoreTokens {
    let text: String
    let utf16: [UInt16]
    let tokens: [HighlightToken]

    init(_ text: String, _ language: String) {
        self.text = text
        utf16 = Array(text.utf16)
        tokens = Highlighter.tokens(in: text, language: language)
    }

    /// sub 第 n 次出现的 UTF-16 范围。sub 可写成「上下文⟦目标⟧上下文」，只取括号里的部分。
    func range(_ sub: String, _ occurrence: Int = 1) -> Range<Int>? {
        if let open = sub.range(of: "⟦"), let close = sub.range(of: "⟧") {
            let before = String(sub[..<open.lowerBound])
            let inner = String(sub[open.upperBound..<close.lowerBound])
            let after = String(sub[close.upperBound...])
            guard let whole = range(before + inner + after, occurrence) else { return nil }
            let start = whole.lowerBound + before.utf16.count
            return start..<(start + inner.utf16.count)
        }
        let needle = Array(sub.utf16)
        guard !needle.isEmpty, needle.count <= utf16.count else { return nil }
        var seen = 0
        for start in 0...(utf16.count - needle.count) where utf16[start] == needle[0] {
            if Array(utf16[start..<(start + needle.count)]) == needle {
                seen += 1
                if seen == occurrence { return start..<(start + needle.count) }
            }
        }
        return nil
    }

    /// 完整覆盖该子串的 token 种类；nil 表示没有单个 token 覆盖它
    func kind(_ sub: String, _ occurrence: Int = 1) -> HighlightKind? {
        guard let r = range(sub, occurrence) else { return nil }
        return tokens.first(where: { $0.location <= r.lowerBound && $0.end >= r.upperBound })?.kind
    }

    /// 该子串上完全没有 token
    func isPlain(_ sub: String, _ occurrence: Int = 1) -> Bool {
        guard let r = range(sub, occurrence) else { return false }
        return !tokens.contains(where: { $0.location < r.upperBound && $0.end > r.lowerBound })
    }

    var dump: String {
        tokens.map { t in
            let s = String(decoding: utf16[t.location..<min(t.end, utf16.count)], as: UTF16.self)
            return "\(t.kind)@\(t.location)+\(t.length) \(s.debugDescription)"
        }.joined(separator: "\n")
    }
}

/// token 必须有序、互不重叠、长度为正、不越界
func editorCoreAssertValid(_ tokens: [HighlightToken], length: Int, _ context: String = "",
                           file: StaticString = #filePath, line: UInt = #line) {
    var previousEnd = 0
    for t in tokens {
        if t.length <= 0 || t.location < previousEnd || t.end > length {
            XCTFail("非法 token \(t)（前一个结束于 \(previousEnd)，长度 \(length)）\(context)", file: file, line: line)
            return
        }
        previousEnd = t.end
    }
}

final class EditorCoreHighlighterTests: XCTestCase {
    private func check(_ text: String, _ language: String, _ expectations: [(String, HighlightKind?)],
                       file: StaticString = #filePath, line: UInt = #line) {
        let t = EditorCoreTokens(text, language)
        editorCoreAssertValid(t.tokens, length: t.utf16.count, language, file: file, line: line)
        for (sub, kind) in expectations {
            XCTAssertNotNil(t.range(sub), "样例里找不到「\(sub)」", file: file, line: line)
            if let kind {
                XCTAssertEqual(t.kind(sub), kind, "「\(sub)」\n\(t.dump)", file: file, line: line)
            } else {
                XCTAssertTrue(t.isPlain(sub), "「\(sub)」应无高亮\n\(t.dump)", file: file, line: line)
            }
        }
    }

    // MARK: C 系

    func testJavaScript() {
        let src = """
            import { a } from "./a.js";
            const total = (items) => items.reduce((s, it) => s + it.price, 0); // 求和
            function greet(name = 'x') { return `Hi ${name.trim()} !`; }
            class Cart extends Base { #items = []; static of() { return null; } }
            const re = /ab+c[/]x/gi, half = width / 2 / scale;
            let n = 0xFF + 1_000 + 1.5e-3 + 10n + .5; /* 块注释 */
            @decorator export default undefined;
            """
        check(src, "javascript", [
            ("import", .keyword), ("\"./a.js\"", .string), ("const", .keyword), ("// 求和", .comment),
            ("reduce", .function), ("price", .property), ("=>", .operator), ("function", .keyword), ("greet", .function),
            ("'x'", .string), ("`Hi ", .string), ("${", .punctuation), ("trim", .function), (" !`", .string),
            ("class", .keyword), ("Cart", .type), ("extends", .keyword), ("Base", .type), ("#items", .property),
            ("null", .constant), ("/ab+c[/]x/gi", .regex), ("width", nil), ("scale", nil), ("0xFF", .number),
            ("1_000", .number), ("1.5e-3", .number), ("10n", .number), (".5", .number), ("/* 块注释 */", .comment),
            ("@decorator", .meta), ("undefined", .constant),
        ])
        // 模板字符串里的表达式按代码处理
        let t = EditorCoreTokens("`a ${b + 1} c`", "javascript")
        XCTAssertEqual(t.kind("1"), .number)
        XCTAssertTrue(t.isPlain("b"))
        XCTAssertEqual(t.kind(" c`"), .string)
        // 除号不是正则
        let division = EditorCoreTokens("x = a / b / c; y = (a) / 2 / 3;", "javascript")
        XCTAssertFalse(division.tokens.contains(where: { $0.kind == .regex }), division.dump)
        XCTAssertEqual(division.kind("/"), .operator)
        XCTAssertEqual(EditorCoreTokens("if (x) return /re/.test(s)", "javascript").kind("/re/"), .regex)
        // 软关键字后跟括号按函数
        check("map.get(k); get(x); for (const v of list) {}", "javascript", [("get", .function), ("of", .keyword)])
    }

    func testTypeScript() {
        check("interface User { name: string; age?: number }\ntype ID = string | number;\nenum Color { Red }",
              "typescript", [
                  ("interface", .keyword), ("User", .type), ("string", .type), ("number", .type), ("type", .keyword),
                  ("ID", .type), ("enum", .keyword), ("Color", .type),
              ])
        XCTAssertEqual(EditorCoreTokens("let a: Map<string, number> = new Map()", "ts").kind("new"), .keyword)
    }

    func testPython() {
        let src = """
            @dataclass(frozen=True)
            class Point(Base):
                \"\"\"文档字符串
                多行\"\"\"
                def dist(self, other) -> float:  # 注释
                    return f"{self.x}" + r'\\d+' + b"x" + rb'y' if other is not None else 0o17 + 0b1010
            """
        check(src, "python", [
            ("@dataclass", .meta), ("True", .constant), ("\n⟦class⟧ ", .keyword), ("Point", .type), ("Base", .type),
            ("\"\"\"文档字符串\n    多行\"\"\"", .string), ("def", .keyword), ("dist", .function), ("self", .variable),
            ("float", .type), ("# 注释", .comment), ("f\"{self.x}\"", .string), ("r'\\d+'", .string), ("b\"x\"", .string),
            ("rb'y'", .string), (" ⟦is⟧ not", .keyword), ("not", .keyword), ("None", .constant), ("0o17", .number),
            ("0b1010", .number),
        ])
        check("print('hi')\nmatch = 1", "python", [("print", .function), ("match", .keyword)])
    }

    func testSwift() {
        let src = """
            /* 外层 /* 内层 */ 仍是注释 */
            @MainActor struct Point: Codable {
                let raw = #"不转义 \\(x) "#
                var s = "值：\\(value + 1) 个"
                #if DEBUG
                func move(by d: Double) -> Self { .init() }
                #endif
            }
            let text = \"\"\"
                多行
                \"\"\"
            """
        check(src, "swift", [
            ("/* 外层 /* 内层 */ 仍是注释 */", .comment), ("@MainActor", .meta), ("struct", .keyword), ("Point", .type),
            ("Codable", .type), ("#\"不转义 \\(x) \"#", .string), ("\"值：", .string), ("：⟦\\(⟧", .punctuation), ("1", .number),
            (" 个\"", .string), ("#if", .meta), ("func", .keyword), ("move", .function), ("Double", .type),
            ("Self", .keyword), ("init", .function), ("#endif", .meta), ("\"\"\"\n    多行\n    \"\"\"", .string),
        ])
        XCTAssertTrue(EditorCoreTokens("var s = \"\\(value)\"", "swift").isPlain("value"))
    }

    func testRust() {
        let src = """
            #[derive(Debug, Clone)]
            pub struct Ref<'a> { s: &'a str }
            fn main() {
                let raw = r#"含 "引号""#;
                let c = 'x'; let nl = '\\n'; let b = b"bytes";
                println!("{}", raw); /* a /* b */ c */
                let v: Vec<u8> = Vec::new(); let n = 1_000u32 + 0b1010 + 2.5e10;
            }
            """
        check(src, "rust", [
            ("#[derive(Debug, Clone)]", .meta), ("pub", .keyword), ("Ref", .type), ("'a", .variable), ("&'a ⟦str⟧", .type),
            ("fn", .keyword), ("main", .function), ("r#\"含 \"引号\"\"#", .string), ("'x'", .string), ("'\\n'", .string),
            ("b\"bytes\"", .string), ("println!", .function), ("/* a /* b */ c */", .comment), ("u8", .type),
            ("new", .function), ("1_000u32", .number), ("0b1010", .number), ("2.5e10", .number),
        ])
    }

    func testGoJavaKotlin() {
        check("package main\nfunc (s *Server) Start() error {\n\tq := `raw\nline`\n\treturn nil\n}", "go", [
            ("package", .keyword), ("func", .keyword), ("Server", .type), ("Start", .function), ("error", .type),
            ("`raw\nline`", .string), ("nil", .constant), (":=", .operator),
        ])
        check("@Override\npublic static void main(String[] args) { String s = \"\"\"\n  text\n  \"\"\"; char c = 'c'; }", "java", [
            ("@Override", .meta), ("public", .keyword), ("void", .type), ("main", .function), ("String", .type),
            ("\"\"\"\n  text\n  \"\"\"", .string), ("'c'", .string),
        ])
        check("fun main() { val name = \"x\"; println(\"Hi $name and ${user.id}\") }", "kotlin", [
            ("fun", .keyword), ("main", .function), ("val", .keyword), ("$name", .variable), ("${", .punctuation),
            ("id", .property), ("\"Hi ", .string),
        ])
    }

    func testCFamily() {
        check("#include <stdio.h>\n#define MAX_SIZE 10\nint main(void) { char c = '\\n'; return NULL; } // 结束", "c", [
            ("#include", .meta), ("<stdio.h>", .string), ("#define", .meta), ("MAX_SIZE", .constant), ("int", .type),
            ("main", .function), ("void", .type), ("'\\n'", .string), ("NULL", .constant), ("// 结束", .comment),
        ])
        check("template <typename T> auto s = R\"x(raw \" text)x\"; std::vector<int> v; auto p = nullptr; p->field;", "cpp", [
            ("template", .keyword), ("typename", .keyword), ("R\"x(raw \" text)x\"", .string), ("vector", nil),
            ("nullptr", .constant), ("field", .property),
        ])
        check("@interface Foo : NSObject\n@property (nonatomic) BOOL ok;\n@end\nNSString *s = @\"你好\"; id x = nil; BOOL y = YES;",
              "objective-c", [
                  ("@interface", .keyword), ("Foo", .type), ("@property", .keyword), ("nonatomic", .keyword), ("BOOL", .type),
                  ("@end", .keyword), ("@\"你好\"", .string), ("nil", .constant), ("YES", .constant),
              ])
        check("#region 区域\nvar path = @\"C:\\dir\"; var s = $\"Hi {name}\"; public class Foo : Bar { }\n#endregion", "csharp", [
            ("#region", .meta), ("var", .keyword), ("@\"C:\\dir\"", .string), ("$\"Hi {name}\"", .string),
            ("public", .keyword), ("class", .keyword), ("Foo", .type), ("#endregion", .meta),
        ])
    }

    func testScriptLanguages() {
        check("<?php\n// 注释\n$name = \"Hi $user\"; echo $obj->prop; function f() { return TRUE; } # 井号\n?>", "php", [
            ("<?php", .meta), ("// 注释", .comment), ("$name", .variable), ("$user", .variable), ("echo", .keyword),
            ("prop", .property), ("function", .keyword), ("⟦f⟧()", .function), ("TRUE", .constant), ("# 井号", .comment),
            ("?>", .meta),
        ])
        check("# 注释\ndef hello(name)\n  @count += 1\n  puts \"Hi #{name}\" if name.empty?\n  :sym\nend", "ruby", [
            ("# 注释", .comment), ("def", .keyword), ("hello", .function), ("@count", .variable), ("#{", .punctuation),
            ("if", .keyword), ("empty?", .property), (":sym", .constant), ("end", .keyword),
        ])
        check("--[[ 块\n注释 ]]\nlocal function f(x) return [[长\n字符串]] end -- 行注释", "lua", [
            ("--[[ 块\n注释 ]]", .comment), ("local", .keyword), ("function", .keyword), ("⟦f⟧(x)", .function),
            ("[[长\n字符串]]", .string), ("-- 行注释", .comment),
        ])
        check("void main() { var s = 'Hi $name ${a.b}'; final r = r'raw $x'; }", "dart", [
            ("void", .type), ("$name", .variable), ("'Hi ", .string), ("r'raw $x'", .string), ("final", .keyword),
        ])
        check("x <- c(1, 2)\nif (is.na(x)) TRUE else NULL # 注释", "r", [
            ("<-", .operator), ("c", .function), ("is.na", .function), ("TRUE", .constant), ("NULL", .constant),
            ("# 注释", .comment),
        ])
        check("object Main { def f(x: Int) = s\"v=$x\" }", "scala", [
            ("object", .keyword), ("Main", .type), ("def", .keyword), ("⟦f⟧(", .function), ("Int", .type), ("s\"v=$x\"", .string),
        ])
    }

    func testSQL() {
        let src = """
            SELECT id, COUNT(*) AS n FROM users u -- 注释
            where u.name = 'O''Brien' and created_at > now() /* 块 */
            CREATE TABLE t (id BIGINT PRIMARY KEY, name VARCHAR(255) NOT NULL);
            CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;
            SELECT `col` FROM x WHERE a = @v OR b = $1;
            """
        check(src, "sql", [
            ("SELECT", .keyword), ("COUNT", .function), ("AS", .keyword), ("FROM", .keyword), ("-- 注释", .comment),
            ("where", .keyword), ("'O''Brien'", .string), ("and", .keyword), ("now", .function), ("/* 块 */", .comment),
            ("BIGINT", .type), ("VARCHAR", .type), ("255", .number), ("NULL", .constant), ("$$ SELECT 1 $$", .string),
            ("`col`", .variable), ("@v", .variable), ("$1", .variable),
        ])
    }

    func testGraphQL() {
        check("# 查询\nquery GetUser($id: ID!) @cached {\n  user(id: $id) { name }\n}\n\"\"\"说明\"\"\"", "graphql", [
            ("# 查询", .comment), ("query", .keyword), ("GetUser", .function), ("$id", .variable), ("ID", .type),
            ("@cached", .meta), ("user", .function), ("\"\"\"说明\"\"\"", .string),
        ])
    }

    // MARK: 专用扫描器

    func testJSON() {
        let src = """
            {
              "name": "Ada", "age": 36, "ok": true, "none": null,
              "n": -1.5e3, "list": ["a", 2],
              // 注释
              unquoted: 'single', "spaced" : 0x1F, /* 块 */ "inf": -Infinity
            }
            """
        check(src, "json", [
            ("\"name\"", .property), ("\"Ada\"", .string), ("36", .number), ("true", .constant), ("null", .constant),
            ("-1.5e3", .number), ("\"a\"", .string), ("2", .number), ("// 注释", .comment), ("unquoted", .property),
            ("'single'", .string), ("\"spaced\"", .property), ("0x1F", .number), ("/* 块 */", .comment),
            ("-Infinity", .constant),
        ])
        XCTAssertEqual(EditorCoreTokens("[\"a\"\n  :1]", "json").kind("\"a\""), .property)
        XCTAssertEqual(EditorCoreTokens("{\"k\": \"unterminated\n}", "json").kind("\"unterminated"), .string)
    }

    func testXML() {
        let src = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE note [ <!ENTITY a "b"> ]>
            <!-- 注释 -->
            <x:root attr="值" other='v'>text &amp; &#169; &#x1F600; more<br/>
              <![CDATA[ <raw> & ]]>
            </x:root>
            """
        let t = EditorCoreTokens(src, "xml")
        editorCoreAssertValid(t.tokens, length: t.utf16.count)
        XCTAssertEqual(t.kind("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"), .meta, t.dump)
        XCTAssertEqual(t.kind("<!DOCTYPE note [ <!ENTITY a \"b\"> ]>"), .meta, t.dump)
        XCTAssertEqual(t.kind("<!-- 注释 -->"), .comment)
        XCTAssertEqual(t.kind("x:root"), .tag)
        XCTAssertEqual(t.kind("attr"), .attribute)
        XCTAssertEqual(t.kind("\"值\""), .string)
        XCTAssertEqual(t.kind("'v'"), .string)
        XCTAssertEqual(t.kind("&amp;"), .constant)
        XCTAssertEqual(t.kind("&#169;"), .constant)
        XCTAssertEqual(t.kind("&#x1F600;"), .constant)
        XCTAssertTrue(t.isPlain("text"))
        XCTAssertEqual(t.kind("br"), .tag)
        XCTAssertEqual(t.kind("/>"), .punctuation)
        XCTAssertEqual(t.kind("<![CDATA["), .meta)
        XCTAssertEqual(t.kind(" <raw> & "), .string)
        XCTAssertEqual(t.kind("]]>"), .meta)
        XCTAssertEqual(t.kind("</"), .punctuation)
        XCTAssertEqual(t.kind("x:root", 2), .tag)
        // 文本里的 < 不是标签
        XCTAssertTrue(EditorCoreTokens("a < b", "xml").tokens.isEmpty)
        XCTAssertEqual(EditorCoreTokens("<!-- 未闭合\n<a>", "xml").kind("<!-- 未闭合\n<a>"), .comment)
    }

    func testHTMLEmbedsScriptAndStyle() {
        let src = """
            <!doctype html>
            <div class="box" hidden data-x=raw @click="go">Hi</div>
            <SCRIPT>const a = "s"; if (a < 2) {}</SCRIPT>
            <style>body > p { color: red; }</style>
            <script type="application/ld+json">{"k": 1}</script>
            <script type="text/x-template"><b>t</b></script>
            """
        check(src, "html", [
            ("<!doctype html>", .meta), ("div", .tag), ("class", .attribute), ("\"box\"", .string), ("hidden", .attribute),
            ("raw", .string), ("@click", .attribute), ("const", .keyword), ("\"s\"", .string), ("2", .number),
            ("SCRIPT", .tag), ("body", .tag), ("color", .property), ("\"k\"", .property), ("1", .number), ("<⟦b⟧>t", .tag),
        ])
        check("<template><p>{{ x }}</p></template>\n<style lang=\"scss\">$c: red; .a { color: $c; }</style>", "vue", [
            ("template", .tag), ("$c", .variable), ("color", .property),
        ])
        // 没闭合的 script 不崩溃
        editorCoreAssertValid(Highlighter.tokens(in: "<script>let x = `", language: "html"), length: 17)
    }

    func testCSS() {
        let src = """
            /* 样式 */
            @media (max-width: 600px) { .btn:hover > a, #main::before { color: #fff !important; } }
            .card[data-type="x"] { margin: 0 -10px 1.5em; background: url(img/a.png) no-repeat, rgba(0,0,0,.5); --main: 50%; }
            """
        check(src, "css", [
            ("/* 样式 */", .comment), ("@media", .keyword), ("600px", .number), (".btn", .tag), (":hover", .attribute),
            (">", .operator), ("> ⟦a⟧,", .tag), ("#main", .tag), ("::before", .attribute), ("color", .property), ("#fff", .number),
            ("!important", .keyword), (".card", .tag), ("data-type", .attribute), ("\"x\"", .string), ("margin", .property),
            ("-10px", .number), ("1.5em", .number), ("background", .property), ("url", .function), ("img/a.png", .string),
            ("no-repeat", nil), ("rgba", .function), (".5", .number), ("--main", .property), ("50%", .number),
        ])
    }

    func testSCSSAndLess() {
        check("$primary: #333; // 行注释\n.a { &:hover { color: $primary; } .b { margin: 0; } @include m(1px); width: #{$w}px; }", "scss", [
            ("$primary", .variable), ("#333", .number), ("// 行注释", .comment), ("&", .operator), (":hover", .attribute),
            ("color", .property), (".b", .tag), ("margin", .property), ("@include", .keyword), ("⟦m⟧(1px)", .function),
            ("1px", .number), ("#{$w}", .variable),
        ])
        check("@color: red;\n.a { color: @color; .mixin(); }", "less", [
            ("@color", .variable), ("{ ⟦color⟧:", .property), ("color: ⟦@color⟧;", .variable), (".mixin", .tag),
        ])
    }

    func testYAML() {
        let src = """
            # 配置
            %YAML 1.2
            ---
            name: showMe
            version: 1.2
            enabled: true
            empty: ~
            list:
              - a
              - "quoted"
            base: &base
              k: v
            ref: *base
            desc: |-
              多行 key: 不是键
              文本
            next: value # 尾注释
            "quoted key": 1
            url: http://x.com/a#b
            flow: {a: 1, b: [x, y]}
            tagged: !!str 123
            """
        check(src, "yaml", [
            ("# 配置", .comment), ("%YAML 1.2", .meta), ("---", .meta), ("name", .property), ("showMe", .string),
            ("version: ⟦1.2⟧", .number), ("true", .constant), ("~", .constant), ("list", .property), ("- ⟦a⟧\n", .string), ("\"quoted\"", .string),
            ("&base", .variable), ("k", .property), ("*base", .variable), ("|-", .operator), ("多行 key: 不是键", .string),
            ("文本", .string), ("next", .property), ("value", .string), ("# 尾注释", .comment), ("\"quoted key\"", .property),
            ("http://x.com/a#b", .string), ("flow", .property), ("[⟦x⟧, y]", .string), ("!!str", .meta), ("123", .number),
        ])
        let t = EditorCoreTokens("- name: a\n  age: 3\n", "yaml")
        XCTAssertEqual(t.kind("-"), .punctuation)
        XCTAssertEqual(t.kind("name"), .property)
        XCTAssertEqual(t.kind("age"), .property)
        XCTAssertEqual(EditorCoreTokens("m: {a: 1, b: 2}", "yaml").kind("b"), .property)
    }

    func testTOMLAndINI() {
        let toml = """
            # 注释
            title = "TOML 示例"
            [owner]
            name = 'Tom'
            dob = 1979-05-27T07:32:00Z
            [[products]]
            ports = [ 8000, 8001 ]
            enabled = true
            desc = \"\"\"
            多行
            字符串\"\"\"
            pi = 3.14 # 尾注释
            inline = { x = 1, y = "a" }
            "quoted.key" = 2
            """
        check(toml, "toml", [
            ("# 注释", .comment), ("title", .property), ("\"TOML 示例\"", .string), ("[owner]", .heading), ("'Tom'", .string),
            ("1979-05-27T07:32:00Z", .number), ("[[products]]", .heading), ("8000", .number), ("true", .constant),
            ("\"\"\"\n多行\n字符串\"\"\"", .string), ("pi", .property), ("3.14", .number), ("# 尾注释", .comment),
            ("x", .property), ("\"a\"", .string), ("\"quoted.key\"", .property),
        ])
        let ini = """
            ; 分号注释
            [section]
            key=value
            port = 8080
            export API_KEY="abc"
            PATH=$HOME/bin:${EXTRA}
            flag = true # 注释
            a.b: c
            """
        check(ini, "ini", [
            ("; 分号注释", .comment), ("[section]", .heading), ("key", .property), ("value", .string), ("8080", .number),
            ("export", .keyword), ("API_KEY", .property), ("\"abc\"", .string), ("$HOME", .variable), ("${EXTRA}", .variable),
            ("/bin:", .string), ("true", .constant), ("# 注释", .comment), ("a.b", .property), ("a.b: ⟦c⟧", .string),
        ])
    }

    func testMarkdown() {
        let src = """
            ---
            title: 文档
            ---
            # 标题 *不算强调*
            正文 *斜体* 和 **粗体** 还有 `代码` 与 [链接](http://x.com) 和 ![图](a.png)。
            snake_case_word 不是强调，~~删除~~ <https://auto.link> 见 https://bare.url/x.
            > 引用
            - 列表
            1. 第一
            - [x] 完成
            ***
            ```swift
            let a = 1
            ```
            [ref]: https://example.com
            """
        check(src, "markdown", [
            ("---\ntitle: 文档\n---", .meta), ("# 标题 *不算强调*", .heading), ("*斜体*", .emphasis), ("**粗体**", .strong),
            ("`代码`", .code), ("[链接](http://x.com)", .link), ("![图](a.png)", .link), ("snake_case_word", nil),
            ("~~删除~~", .deleted), ("<https://auto.link>", .link), ("https://bare.url/x", .link), ("> 引用", .quote),
            ("\n⟦-⟧ 列表", .listMarker), ("1.", .listMarker), ("[x]", .listMarker), ("***", .meta), ("```swift", .code),
            ("let a = 1", .code), ("[ref]: https://example.com", .link),
        ])
        let t = EditorCoreTokens("a * b * c and 2*3*4", "markdown")
        XCTAssertTrue(t.tokens.isEmpty || !t.tokens.contains(where: { $0.kind == .emphasis && $0.location == 2 }), t.dump)
        XCTAssertEqual(EditorCoreTokens("```\n未闭合\n代码", "markdown").kind("未闭合\n代码"), .code)
        XCTAssertEqual(EditorCoreTokens("标题\n===", "markdown").kind("==="), .heading)
        XCTAssertEqual(EditorCoreTokens("***粗斜***", "markdown").kind("***粗斜***"), .strong)
    }

    func testDiff() {
        let src = """
            diff --git a/x b/x
            index 123..456 100644
            --- a/x
            +++ b/x
            @@ -1,2 +1,2 @@ func main()
            -old
            +new
             context
            \\ No newline at end of file
            """
        check(src, "diff", [
            ("diff --git a/x b/x", .meta), ("index 123..456 100644", .comment), ("--- a/x", .meta), ("+++ b/x", .meta),
            ("@@ -1,2 +1,2 @@", .meta), (" func main()", nil), ("-old", .deleted), ("+new", .inserted), (" context", nil),
            ("\\ No newline at end of file", .comment),
        ])
    }

    func testShell() {
        let src = """
            #!/bin/bash
            # 注释
            NAME="world $USER"
            if [ -f "$FILE" ]; then
              echo "Hello ${NAME}" | grep -q x && exit 1
            fi
            for f in *.txt; do cat $f; done
            greet() { local x=$1; }
            cat <<EOF
            正文 $body
            EOF
            echo 'single $notvar' $(date) 2>&1 # 尾注释
            """
        check(src, "shell", [
            ("#!/bin/bash", .meta), ("# 注释", .comment), ("NAME", .variable), ("\"world ", .string), ("$USER", .variable),
            ("if", .keyword), ("$FILE", .variable), ("then", .keyword), ("echo", .function), ("${NAME}", .variable),
            ("|", .operator), ("&&", .operator), ("exit", .keyword), ("1", .number), ("fi", .keyword), ("for", .keyword),
            (" ⟦in⟧ *.txt", .keyword), ("do", .keyword), ("$f", .variable), ("done", .keyword), ("greet", .function),
            ("local", .keyword), ("local ⟦x⟧", .variable), ("$1", .variable), ("<<", .operator), ("EOF", .string),
            ("正文 $body\nEOF", .string), ("'single $notvar'", .string), ("$(", .operator), ("2⟦>&⟧1", .operator),
            ("# 尾注释", .comment),
        ])
        check("cat <<-'END'\n\tbody\n\tEND\necho hi", "shell", [("\tbody\n\tEND", .string), ("echo", .function)])
        check("a#b ${x:-默认} $'esc\\n'", "shell", [("a#b", nil), ("${x:-默认}", .variable), ("$'esc\\n'", .string)])
    }

    func testDockerfileAndMakefile() {
        let docker = """
            # syntax=docker/dockerfile:1
            FROM node:20 AS build
            RUN apt-get update && \\
                apt-get install -y curl
            ENV PATH=$PATH:/app
            copy . /app
            """
        check(docker, "dockerfile", [
            ("# syntax=docker/dockerfile:1", .comment), ("FROM", .keyword), ("AS", .keyword), ("RUN", .keyword),
            ("&&", .operator), ("install", nil), ("ENV", .keyword), ("PATH", .variable), ("$PATH", .variable), ("copy", .keyword),
        ])
        let make = "CC := gcc\n.PHONY: all\nall: main.o\n\t$(CC) -o app $^ # 链接\n\t@echo \"完成\"\ninclude config.mk\nFLAGS += -O2"
        check(make, "makefile", [
            ("CC", .variable), (":=", .operator), (".PHONY", .keyword), ("\n⟦all⟧:", .function), ("main.o", nil), ("$(CC)", .variable),
            ("$^", .variable), ("# 链接", .comment), ("@", .operator), ("\"完成\"", .string), ("include", .keyword),
            ("FLAGS", .variable), ("+=", .operator),
        ])
    }

    func testCSVLogAndIgnore() {
        let csv = EditorCoreTokens("a,b,c\n1,\"x,\ny\",3\r\n4,5,6", "csv")
        editorCoreAssertValid(csv.tokens, length: csv.utf16.count)
        XCTAssertTrue(csv.isPlain("a"))
        XCTAssertEqual(csv.kind("b"), .property)
        XCTAssertTrue(csv.isPlain("c"))
        XCTAssertEqual(csv.kind("\"x,\ny\""), .property)
        XCTAssertEqual(csv.kind("5"), .property)
        XCTAssertEqual(EditorCoreTokens("a\tb\tc", "tsv").kind("b"), .property)

        let log = "2024-01-02T03:04:05.123Z ERROR 失败 http://x.com/a \"引号\" [warn] level=info DEBUG I/O error 12:30:01,5"
        check(log, "log", [
            ("2024-01-02T03:04:05.123Z", .number), ("ERROR", .invalid), ("http://x.com/a", .link), ("\"引号\"", .string),
            ("warn", .keyword), ("info", .type), ("DEBUG", .comment), ("I/O", nil), ("error", nil), ("12:30:01,5", .number),
        ])
        check("# 注释\nnode_modules/\n!keep.txt", "ignore", [("# 注释", .comment), ("!", .operator), ("node_modules/", nil)])
    }

    // MARK: 偏移与健壮性

    func testUTF16OffsetsWithEmojiAndCJK() {
        let src = "let 名字 = \"😀中文\"; // 注释👍\r\nlet b = 1"
        let tokens = Highlighter.tokens(in: src, language: "javascript")
        let ns = src as NSString
        let string = tokens.first(where: { $0.kind == .string })
        XCTAssertEqual(string?.location, ns.range(of: "\"😀中文\"").location)
        XCTAssertEqual(string?.length, 6)
        let comment = tokens.first(where: { $0.kind == .comment })
        XCTAssertEqual(comment.map { NSRange(location: $0.location, length: $0.length) }, ns.range(of: "// 注释👍"))
        XCTAssertEqual(tokens.last?.kind, .number)
        XCTAssertEqual(tokens.last?.location, ns.length - 1)

        // 中文标识符后跟括号
        XCTAssertEqual(EditorCoreTokens("计算(1)", "javascript").kind("计算"), .function)
        // Markdown 标题含 emoji，CRLF 不进 token
        let md = EditorCoreTokens("# 你好 🎉\r\n正文", "markdown")
        XCTAssertEqual(md.tokens.first?.length, ("# 你好 🎉" as NSString).length)
    }

    func testSubRangeTokenization() {
        let src = "let a = 1\nconst s = \"x\" // c\n"
        let all = Array(src.utf16)
        let lineStart = 10
        let sub = Array(all[lineStart...])
        let tokens = Highlighter.tokens(utf16: sub, language: "js")
        XCTAssertEqual(tokens.first, HighlightToken(location: 0, length: 5, kind: .keyword))
        let full = Highlighter.tokens(utf16: all, language: "javascript").filter { $0.location >= lineStart }
        XCTAssertEqual(tokens.map { HighlightToken(location: $0.location + lineStart, length: $0.length, kind: $0.kind) }, full)
    }

    func testUnterminatedConstructs() {
        let cases: [(String, String, String, HighlightKind)] = [
            ("x = \"abc\nlet y = 1", "javascript", "\"abc", .string),
            ("a /* never closed\nmore", "javascript", "/* never closed\nmore", .comment),
            ("s = \"\"\"open\nstill", "python", "\"\"\"open\nstill", .string),
            ("let t = `a ${b", "javascript", "`a ", .string),
            ("<!-- x\ny", "html", "<!-- x\ny", .comment),
            ("<a href=\"x", "html", "\"x", .string),
            ("'abc\nd", "sql", "'abc\nd", .string),
            ("key: \"abc", "yaml", "\"abc", .string),
            ("echo \"abc", "shell", "\"abc", .string),
            ("`code", "markdown", "`code", .code),
        ]
        for (src, lang, sub, kind) in cases {
            let t = EditorCoreTokens(src, lang)
            editorCoreAssertValid(t.tokens, length: t.utf16.count, lang)
            if sub == "`code" {
                XCTAssertNotEqual(t.kind(sub), kind, "未闭合的行内代码不算代码")
            } else {
                XCTAssertEqual(t.kind(sub), kind, "\(lang): \(sub)\n\(t.dump)")
            }
        }
        XCTAssertEqual(EditorCoreTokens("x = \"abc\nlet y = 1", "javascript").kind("let"), .keyword)
        XCTAssertEqual(EditorCoreTokens("a = \"x\r\nb = 2", "javascript").kind("2"), .number)
    }

    func testFuzzNeverCrashesAndStaysValid() {
        let pieces = [
            "\"", "'", "`", "/*", "*/", "//", "#", "<!--", "-->", "<", ">", "</", "/>", "{", "}", "[", "]", "(", ")", "${", "\\(",
            "#{", "\\", "\n", "\r\n", "\r", " ", "\t", "a", "foo", "Bar", "123", "0x", "1e", ".", "@", "$", "&amp;", "&", "*",
            "**", "_", "~~", "|", "-", "+", "=", ":", ";", ",", "中", "😀", "e\u{301}", "\"\"\"", "'''", "r#\"", "\"#", "[[",
            "]]", "--", "<<EOF", "EOF", "---", "```", "%", "!", "?", "\u{0}", "<?php", "?>", "<script>", "</script>", "<style>",
            "R\"(", ")\"", "@\"", "$\"", "$$", "'a", "|", "- ", "1. ", "> ", "[x]", "](", "\\u{1F600}", "=begin", "=end",
        ]
        var seed: UInt64 = 0x5EED
        func next() -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int(truncatingIfNeeded: seed >> 33)
        }
        var languages = EditorLanguage.all.map(\.id)
        languages += ["vue", "tsv", "js", "unknown"]
        for _ in 0..<150 {
            let count = next() % 120
            var s = ""
            for _ in 0..<count { s += pieces[next() % pieces.count] }
            let units = Array(s.utf16)
            for lang in languages {
                let tokens = Highlighter.tokens(utf16: units, language: lang)
                editorCoreAssertValid(tokens, length: units.count, "\(lang): \(s.debugDescription)")
            }
        }
    }

    func testEveryPrefixOfMixedSample() {
        let sample = """
            <div a="1">#x {y: 'z'} `t ${u} v` /* w */ // c
            "s\\"q" r#"raw"# @a $b ${c} 0x1F 1.5e3 [l](m) **n** - o: p
            """
        let units = Array(sample.utf16)
        for lang in ["javascript", "html", "css", "markdown", "yaml", "rust", "shell", "json", "swift", "python", "sql"] {
            var n = 0
            while n <= units.count {
                let prefix = Array(units[0..<n])
                editorCoreAssertValid(Highlighter.tokens(utf16: prefix, language: lang), length: n, lang)
                n += 3
            }
        }
    }

    func testPlainAndEmpty() {
        XCTAssertTrue(Highlighter.tokens(in: "", language: "javascript").isEmpty)
        XCTAssertTrue(Highlighter.tokens(in: "if (x) {}", language: "plain").isEmpty)
        XCTAssertTrue(Highlighter.tokens(in: "if (x) {}", language: "nonexistent").isEmpty)
        XCTAssertFalse(Highlighter.supports("plain"))
        XCTAssertTrue(Highlighter.supports("yml"))
    }

    /// 病态长行：每种结构都只开不合。默认规模小（只验证不崩溃、token 合法）；
    /// 设 EDITOR_CORE_STRESS=1 时每例 512K 单元并限时，用来发现平方复杂度。
    func testPathologicalLongLines() {
        let stress = ProcessInfo.processInfo.environment["EDITOR_CORE_STRESS"] == "1"
        let size = stress ? 512 * 1024 : 4 * 1024
        let patterns = [
            "*a ", "_a ", "**a ", "`a ", "``a ", "[a ", "[a](", "![a](", "~~a ", "<a ", "(/[a ", "\"\\(x)\" ", "`${a}` ",
            "\"${a}\" ", "\"#{a}\" ", "#{a ", "url(a ", "<<a ", "'a ", "/*", "<!--", "$(", "${", "{", "[", "(", ":a ", "- a: ",
            "a = ", "h ", "http://a ", "&a ", "<a b=", "@a ", "#a ", "$a ", "0x", "1.", "a\\", "|", "--a ", "\"\"\"",
        ]
        let languages = [
            "javascript", "typescript", "python", "swift", "rust", "go", "ruby", "lua", "sql", "php", "cpp", "csharp", "kotlin",
            "dart", "json", "html", "xml", "css", "scss", "less", "markdown", "yaml", "toml", "ini", "shell", "dockerfile",
            "makefile", "diff", "csv", "log", "graphql", "ignore",
        ]
        var slowest = (0.0, "")
        for pattern in patterns {
            let units = Array(String(repeating: pattern, count: size / pattern.utf16.count + 1).utf16)
            for lang in languages {
                let start = Date()
                let tokens = Highlighter.tokens(utf16: units, language: lang)
                let elapsed = Date().timeIntervalSince(start)
                if elapsed > slowest.0 { slowest = (elapsed, "\(lang) \(pattern.debugDescription)") }
                editorCoreAssertValid(tokens, length: units.count, "\(lang) \(pattern.debugDescription)")
                if stress { XCTAssertLessThan(elapsed, 0.5, "\(lang) \(pattern.debugDescription)") }
            }
        }
        if stress { print("Highlighter stress: slowest \(slowest.1) \(String(format: "%.1f", slowest.0 * 1000)) ms") }
    }

    func testPerformanceOneMegabyteJS() {
        let snippet = """
            // 计算总价
            function total(items, rate = 0.08) {
              const sum = items.reduce((acc, it) => acc + it.price * it.qty, 0);
              if (sum > 1_000 && /^vip/i.test(user.name)) { return sum * (1 - rate); }
              return `Total: ${sum.toFixed(2)} 元`; /* done */
            }
            class Cart extends Base { #items = []; static of(x) { return new Cart(x); } }

            """
        let unitsPerSnippet = snippet.utf16.count
        let text = String(repeating: snippet, count: (1 << 20) / unitsPerSnippet + 1)
        let units = Array(text.utf16)
        XCTAssertGreaterThanOrEqual(units.count, 1 << 20)
        let start = Date()
        let tokens = Highlighter.tokens(utf16: units, language: "javascript")
        let elapsed = Date().timeIntervalSince(start)
        print("Highlighter: 1 MB JavaScript → \(tokens.count) tokens in \(String(format: "%.1f", elapsed * 1000)) ms")
        XCTAssertLessThan(elapsed, 2.0)
        XCTAssertGreaterThan(tokens.count, 50_000)
    }
}
