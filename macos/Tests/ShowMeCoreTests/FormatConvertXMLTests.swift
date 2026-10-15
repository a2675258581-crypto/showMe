import Foundation
import XCTest
@testable import ShowMeCore

final class FormatConvertXMLTests: XCTestCase {
    typealias O = XMLFormatter.Options

    func out(_ src: String, _ o: O = O()) throws -> String {
        try XMLFormatter.process(src, options: o).text
    }

    func err(_ src: String) -> XMLIssue? {
        do {
            _ = try XMLSyntax.parse(src)
            return nil
        } catch let e as XMLIssueError {
            return e.issue
        } catch {
            return nil
        }
    }

    func warnings(_ src: String) throws -> [String] {
        try XMLSyntax.parse(src).warnings.map(\.message.zh)
    }

    let pom = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!-- Maven 项目配置 -->
    <project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd"><modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId><artifactId>demo</artifactId><name>示例项目</name>
    <properties><java.version>21</java.version><skipTests/></properties>
    <dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>
    """

    func testBasicIndentAndInlineText() throws {
        XCTAssertEqual(try out("<a><b>1</b><c><d>文本</d></c></a>"), "<a>\n  <b>1</b>\n  <c>\n    <d>文本</d>\n  </c>\n</a>")
        XCTAssertEqual(try out("<a><b/></a>", O(indent: "    ")), "<a>\n    <b/>\n</a>")
        XCTAssertEqual(try out("<a><b/></a>", O(indent: "\t")), "<a>\n\t<b/>\n</a>")
        XCTAssertEqual(try XMLFormatter.format("<a><b/></a>", indent: "\t"), "<a>\n\t<b/>\n</a>")
    }

    func testMavenPom() throws {
        XCTAssertEqual(try out(pom), """
        <?xml version="1.0" encoding="UTF-8"?>
        <!-- Maven 项目配置 -->
        <project
          xmlns="http://maven.apache.org/POM/4.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd"
        >
          <modelVersion>4.0.0</modelVersion>
          <groupId>com.example</groupId>
          <artifactId>demo</artifactId>
          <name>示例项目</name>
          <properties>
            <java.version>21</java.version>
            <skipTests/>
          </properties>
          <dependencies>
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-web</artifactId>
            </dependency>
          </dependencies>
        </project>
        """)
        let once = try out(pom)
        XCTAssertEqual(try out(once), once)
        XCTAssertEqual(try out(try out(pom, O(minify: true))), once)
        let st = try XMLFormatter.process(pom, options: O()).stats
        XCTAssertEqual(st, XMLFormatter.Stats(elements: 12, attributes: 3, maxDepth: 4, comments: 1, cdata: 0))
    }

    func testAttributeWrapping() throws {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\"><path d=\"M0 0h24v24H0z\"/></svg>"
        XCTAssertEqual(try out(svg, O(attrWrap: .never, printWidth: 20)),
                       "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\">\n  <path d=\"M0 0h24v24H0z\"/>\n</svg>")
        XCTAssertEqual(try out("<a x=\"1\" y=\"2\"><b z=\"3\"/></a>", O(attrWrap: .always)), "<a\n  x=\"1\"\n  y=\"2\"\n>\n  <b z=\"3\"/>\n</a>")
        XCTAssertEqual(try out("<a><b x=\"1\" y=\"2\"/></a>", O(attrWrap: .always)), "<a>\n  <b\n    x=\"1\"\n    y=\"2\"\n  />\n</a>")
    }

    func testKeepsQuotesEntitiesDoctypePiCdata() throws {
        XCTAssertEqual(try out("<a  b='x \"y\"'   c=\"&amp;&lt;\"/>"), "<a b='x \"y\"' c=\"&amp;&lt;\"/>")
        let src = "<!DOCTYPE note [<!ENTITY writer \"张三\"><!ELEMENT note (#PCDATA)>]><?xml-stylesheet href=\"a.xsl\"?><note>&writer;<![CDATA[<b>原样</b> & ]]></note>"
        XCTAssertEqual(try out(src), "<!DOCTYPE note [<!ENTITY writer \"张三\"><!ELEMENT note (#PCDATA)>]>\n<?xml-stylesheet href=\"a.xsl\"?>\n<note>&writer;<![CDATA[<b>原样</b> & ]]></note>")
        XCTAssertEqual(try out("<s><![CDATA[a\n  b]]></s>"), "<s>\n  <![CDATA[a\n  b]]>\n</s>")
    }

    func testMixedContent() throws {
        XCTAssertEqual(try out("<p>Hello <b>world</b>, 你好！</p>"), "<p>Hello <b>world</b>, 你好！</p>")
        let a = String(repeating: "很长的文字", count: 10), b = String(repeating: "结尾", count: 10)
        XCTAssertEqual(try out("<p>\(a) <b>加粗</b> \(b)</p>", O(printWidth: 40)), "<p>\n  \(a)\n  <b>加粗</b>\n  \(b)\n</p>")
        XCTAssertEqual(try out("<a>\n    第一行\n    第二行\n</a>"), "<a>第一行 第二行</a>")
        XCTAssertEqual(try out("<a>\n    第一行\n    第二行\n</a>", O(printWidth: 8)), "<a>\n  第一行\n  第二行\n</a>")
        XCTAssertEqual(try out("<p>Hello <b>a</b> <i>b</i></p>"), "<p>Hello <b>a</b> <i>b</i></p>")
        XCTAssertEqual(try out("<p>Hello <b>a</b>\n  <i>b</i>!</p>"), "<p>Hello <b>a</b> <i>b</i>!</p>")
        XCTAssertEqual(try out("<p>Hello <b>a</b> <i>b</i></p>", O(minify: true)), "<p>Hello <b>a</b> <i>b</i></p>")
        XCTAssertEqual(try out("<a> <b>1</b> <c>2</c> </a>", O(minify: true)), "<a><b>1</b><c>2</c></a>")
        let once = try out("<doc><p>中文 <em>强调</em> <code>x</code> 结尾</p></doc>")
        XCTAssertEqual(once, "<doc>\n  <p>中文 <em>强调</em> <code>x</code> 结尾</p>\n</doc>")
        XCTAssertEqual(try out(once), once)
    }

    func testPreserveSpaceSelfCloseAndComments() throws {
        XCTAssertEqual(try out("<r><pre xml:space=\"preserve\">  a\n    b  </pre><c>  x  </c></r>"),
                       "<r>\n  <pre xml:space=\"preserve\">  a\n    b  </pre>\n  <c>x</c>\n</r>")
        XCTAssertEqual(try out("<a><b></b><c/></a>", O(selfClose: true)), "<a>\n  <b/>\n  <c/>\n</a>")
        XCTAssertEqual(try out("<a><b></b><c/></a>", O(selfClose: false)), "<a>\n  <b></b>\n  <c/>\n</a>")
        XCTAssertEqual(try out("<a><b>  </b></a>"), "<a>\n  <b/>\n</a>")
        XCTAssertEqual(try out("<a><!-- 注释 --><b/></a>"), "<a>\n  <!-- 注释 -->\n  <b/>\n</a>")
        XCTAssertEqual(try out("<a><!-- 注释 --><b/></a>", O(keepComments: false)), "<a>\n  <b/>\n</a>")
        XCTAssertEqual(try out("<a>x<!-- c --></a>"), "<a>x<!-- c --></a>")
        XCTAssertEqual(try out("<a>x<!-- c -->y</a>", O(keepComments: false)), "<a>xy</a>")
        XCTAssertEqual(try out("<a>x<!-- 1\n2 --></a>"), "<a>\n  x\n  <!-- 1\n2 -->\n</a>")
    }

    func testNewlinesBomAndMinify() throws {
        XCTAssertEqual(try out("<a>\r\n  <b>1</b>\r\n</a>"), "<a>\n  <b>1</b>\n</a>")
        XCTAssertEqual(try out("\u{FEFF}<?xml version=\"1.0\"?><a/>"), "<?xml version=\"1.0\"?>\n<a/>")
        XCTAssertEqual(try out("<a>\n  <b> x </b>\n  <p>Hello <i>w</i> !</p>\n</a>", O(minify: true)), "<a><b>x</b><p>Hello <i>w</i> !</p></a>")
        XCTAssertEqual(try out("<a>\n  <!-- c -->\n  <b></b>\n</a>", O(minify: true, keepComments: false)), "<a><b/></a>")
        XCTAssertEqual(try out("<a>\n  <!-- c -->\n  <b></b>\n</a>", O(minify: true, selfClose: false)), "<a><!-- c --><b></b></a>")
        XCTAssertEqual(try out("<a>\n  <b xml:space=\"preserve\">\n  x\n  </b>\n</a>", O(minify: true)), "<a><b xml:space=\"preserve\">\n  x\n  </b></a>")
        XCTAssertEqual(try XMLFormatter.minify("<?xml version=\"1.0\"?>\n<a>\n  第一行\n  第二行\n</a>"), "<?xml version=\"1.0\"?><a>第一行 第二行</a>")
    }

    func testErrorsWithPositions() {
        let deep = String(repeating: "<a>", count: 20000) + String(repeating: "</a>", count: 20000)
        let e = err(deep)
        XCTAssertTrue(e?.message.zh.contains("嵌套层级过深") ?? false)
        XCTAssertEqual(e?.line, 1)
        XCTAssertEqual(e?.column, 3001)
        let ok = String(repeating: "<a>", count: 1000) + String(repeating: "</a>", count: 1000)
        XCTAssertEqual(try XMLFormatter.process(ok, options: O()).stats.maxDepth, 1000)
        XCTAssertNoThrow(try XMLFormatter.minify(ok))

        let cd = err("<a>\n  x ]]> y\n</a>")
        XCTAssertEqual(cd?.line, 2)
        XCTAssertEqual(cd?.column, 5)
        XCTAssertNil(err("<a b=\"]]>\">]]&gt;<![CDATA[x]]></a>"))

        let unclosed = err("<a>\n  <b>\n</a>")
        XCTAssertEqual([unclosed?.line, unclosed?.column], [3, 1])
        XCTAssertTrue(unclosed?.message.zh.contains("<b>（第 2 行第 3 列）没有闭合") ?? false)
        let eof = err("<root>\n  <child>文本</child>")
        XCTAssertEqual([eof?.line, eof?.column], [1, 1])
        XCTAssertEqual(eof?.message.zh, "标签 <root> 没有闭合")
        let mismatch = err("<a>\n  <b></c>\n</a>")
        XCTAssertEqual([mismatch?.line, mismatch?.column], [2, 6])
        XCTAssertTrue(mismatch?.message.zh.contains("</c> 与开始标签 <b>") ?? false)
        XCTAssertEqual(mismatch?.hint?.zh, "应为 </b>")
        XCTAssertTrue(err("<a/></a>")?.message.zh.contains("多余的闭合标签 </a>") ?? false)
    }

    func testAttributeAndTagErrors() {
        let e = err("<a b=1/>")
        XCTAssertEqual([e?.line, e?.column], [1, 6])
        XCTAssertEqual(e?.hint?.zh, "例如 b=\"1\"")
        func msg(_ s: String) -> String { err(s)?.message.zh ?? "(none)" }
        XCTAssertTrue(msg("<a b></a>").contains("缺少 \"=\" 和属性值"))
        XCTAssertEqual(msg("<a b=\"1\" b=\"2\"/>"), "属性 b 重复")
        XCTAssertTrue(msg("<a b=\"1\"c=\"2\"/>").contains("前面缺少空格"))
        XCTAssertTrue(msg("<a b=\"x/>").contains("缺少结束引号"))
        XCTAssertTrue(msg("<a b=\"x<y\"/>").contains("出现了 \"<\""))
        XCTAssertTrue(msg("<a \"x\"/>").contains("缺少属性名"))
        XCTAssertTrue(msg("<a b=\"&x\"/>").contains("未转义的 \"&\""))
        XCTAssertTrue(msg("<a").contains("缺少 \">\""))
        XCTAssertTrue(msg("<a <b/>").contains("缺少 \">\""))
        XCTAssertTrue(msg("<a/ >").contains("\"/\" 后面应紧跟 \">\""))
        let lt = err("<a>1 < 2</a>")
        XCTAssertEqual([lt?.line, lt?.column], [1, 6])
        XCTAssertTrue(lt?.hint?.zh.contains("&lt;") ?? false)
        XCTAssertTrue(msg("<1a/>").contains("意外的 \"<\""))
        XCTAssertTrue(msg("<a></ >").contains("缺少标签名"))
        XCTAssertTrue(msg("<a></a").contains("缺少 \">\""))
        let amp = err("<a>\n  AT&T\n</a>")
        XCTAssertEqual([amp?.line, amp?.column], [2, 5])
        XCTAssertTrue(amp?.hint?.zh.contains("&amp;") ?? false)
        XCTAssertNil(err("<a>&amp; &#169; &#x4E2D; &自定义;</a>"))
        XCTAssertTrue(msg("<a><!-- x</a>").contains("缺少 \"-->\""))
        XCTAssertTrue(msg("<a><![CDATA[ x</a>").contains("缺少 \"]]>\""))
        XCTAssertTrue(msg("<?xml version=\"1.0\"<a/>").contains("缺少 \"?>\""))
        XCTAssertTrue(msg("<!DOCTYPE a [ <!ENTITY x \"1\"> <a/>").contains("DOCTYPE 没有结束"))
        XCTAssertTrue(msg("<!ELEMENT a>").contains("无法识别的声明"))
        XCTAssertTrue(msg("<a/><?xml version=\"1.0\"?>").contains("只能出现在文档最开头"))
        XCTAssertTrue(msg("<?XML version=\"1.0\"?><a/>").contains("必须小写"))
        XCTAssertTrue(msg("<?xml encoding=\"UTF-8\"?><a/>").contains("缺少 version"))
        XCTAssertTrue(msg("<![CDATA[x]]><a/>").contains("只能出现在元素内部"))
        XCTAssertTrue(msg("<a/><!DOCTYPE a>").contains("之前"))
        XCTAssertTrue(msg("<!DOCTYPE a><!DOCTYPE a><a/>").contains("只能有一个"))
        let none = err("  hello")
        XCTAssertEqual(none?.message.zh, "没有找到任何 XML 元素")
        XCTAssertEqual(none?.column, 3)
        XCTAssertEqual(msg("<!-- 只有注释 -->"), "没有找到任何 XML 元素")
        // 列号按码点计算
        let cp = err("<名字>😀</名>")
        XCTAssertEqual([cp?.line, cp?.column], [1, 6])
    }

    func testWarnings() throws {
        XCTAssertEqual(try warnings("\n<?xml version=\"1.0\"?><a/>"), ["XML 声明前面有空白"])
        XCTAssertEqual(try warnings("<a/><b/>"), ["发现多个根元素 <b>"])
        XCTAssertEqual(try out("<a/><b/>"), "<a/>\n<b/>")
        XCTAssertEqual(try warnings("<a/>尾巴"), ["根元素之外存在文本内容"])
        XCTAssertEqual(try warnings("<soap:Envelope><soap:Body x:y=\"1\"/></soap:Envelope>"),
                       ["命名空间前缀 \"soap\" 未声明", "命名空间前缀 \"x\" 未声明"])
        XCTAssertEqual(try warnings("<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body xml:lang=\"zh\"/></soap:Envelope>"), [])
        XCTAssertEqual(try warnings("<r><a xmlns:p=\"u\"><p:x/></a><p:y/></r>"), ["命名空间前缀 \"p\" 未声明"])
        XCTAssertEqual(try warnings("<a><!-- a -- b --></a>"), ["注释内容中不应出现 \"--\""])
    }

    func testToolSpecAndLanguages() throws {
        let tool = XMLFormatterTool.spec
        let r = try tool("<a><b>1</b></a>")
        XCTAssertEqual(r.primary?.value, "<a>\n  <b>1</b>\n</a>")
        XCTAssertEqual(r.primary?.language, "xml")
        XCTAssertTrue(r.notes[0].message.contains("元素 2"))
        XCTAssertEqual(try tool("<a>\n <b/>\n</a>", options: ["mode": "minify"]).primary?.value, "<a><b/></a>")
        XCTAssertEqual(try tool("<a><!--c--><b/></a>", options: ["keepComments": "0", "indent": "4"]).primary?.value, "<a>\n    <b/>\n</a>")
        XCTAssertThrowsError(try tool("<a>\n  <b>\n</a>", lang: .en)) { error in
            let e = error as? ToolError
            XCTAssertEqual(e?.line, 3)
            XCTAssertEqual(e?.column, 1)
            XCTAssertEqual(e?.message, "Line 3, column 1: Tag <b> (line 2, column 3) is not closed before </a> (add </b> before this point)")
        }
        XCTAssertThrowsError(try XMLFormatter.format("<a>")) { error in
            XCTAssertEqual((error as? ToolError)?.message, "第 1 行第 1 列：标签 <a> 没有闭合（直到文档结束都没有找到 </a>）")
        }
        let warn = try tool("<a/><b/>", lang: .en)
        XCTAssertEqual(warn.notes.last?.level, .warning)
        XCTAssertTrue(warn.notes.last?.message.hasPrefix("Line 1, column 5: Multiple root elements: <b>") ?? false)
    }

    func testSamplesAndIdempotence() throws {
        let soap = "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ord=\"http://example.com/order/v1\"><soap:Body><ord:CreateOrderRequest><ord:CustomerId>10086</ord:CustomerId><ord:Items><ord:Item sku=\"SKU-8848\" qty=\"1\" price=\"199.90\"/></ord:Items>\n<ord:Remark><![CDATA[请在工作日送达，谢谢 <急>]]></ord:Remark></ord:CreateOrderRequest></soap:Body></soap:Envelope>"
        let once = try out(soap)
        XCTAssertEqual(try out(once), once)
        XCTAssertEqual(try out(try out(soap, O(minify: true))), once)

        // 确定性随机用例：格式化 / 压缩的结果再处理一次保持不变
        var seed: UInt32 = 7
        func rnd() -> Double {
            seed = (seed &* 1_103_515_245 &+ 12345) & 0x7FFF_FFFF
            return Double(seed) / Double(0x7FFF_FFFF)
        }
        func pick<T>(_ a: [T]) -> T { a[min(a.count - 1, Int(rnd() * Double(a.count)))] }
        let leaves = ["text", " 空格 ", "\n  ", "x &amp; y", "<![CDATA[ <x> ]]>", "<!-- c -->", "<?pi data?>"]
        func gen(_ d: Int) -> String {
            let t = pick(["a", "b", "ns:c", "中"])
            let n = d > 3 ? 0 : Int(rnd() * 4)
            var kids: [String] = []
            for _ in 0..<n { kids.append(rnd() < 0.4 ? pick(leaves) : gen(d + 1)) }
            let attrs = rnd() < 0.5 ? " id=\"\(Int(rnd() * 9))\" name='v'" : ""
            return kids.isEmpty ? "<\(t)\(attrs)/>" : "<\(t)\(attrs)>\(kids.joined())</\(t)>"
        }
        let variants = [O(), O(indent: "    "), O(attrWrap: .always), O(selfClose: false), O(keepComments: false)]
        for _ in 0..<300 {
            let src = "<root xmlns:ns=\"urn:x\">\(gen(0))</root>"
            var o = pick(variants)
            let once = try out(src, o)
            XCTAssertEqual(try out(once, o), once, src)
            o.minify = true
            let min = try out(src, o)
            XCTAssertEqual(try out(min, o), min, src)
        }
    }

    func testLargeDocumentAndDeepStack() throws {
        var items = ""
        for i in 0..<5000 { items += "<item id=\"\(i)\"><name>商品\(i)</name><price>9.9</price></item>" }
        let start = Date()
        let r = try XMLFormatter.process("<list>\(items)</list>", options: O())
        XCTAssertLessThan(Date().timeIntervalSince(start), 5)
        XCTAssertEqual(r.stats.elements, 15001)

        // 工具在后台线程运行（栈只有 512 KB）：1000 层嵌套也不能爆栈
        let deep = String(repeating: "<a>x", count: 1000) + String(repeating: "</a>", count: 1000)
        let done = expectation(description: "deep")
        let thread = Thread {
            _ = try? XMLFormatter.format(deep)
            _ = try? XMLFormatter.minify(deep)
            done.fulfill()
        }
        thread.stackSize = 512 * 1024
        thread.start()
        wait(for: [done], timeout: 60)
    }
}
