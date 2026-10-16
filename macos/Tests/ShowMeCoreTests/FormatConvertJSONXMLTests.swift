import Foundation
import XCTest
@testable import ShowMeCore

final class FormatConvertJSONXMLTests: XCTestCase {
    typealias O = JSONXML.Options

    func toXML(_ json: String, _ o: O = O(), lang: Lang = .zh) throws -> JSONXML.Result {
        try JSONXML.jsonToXML(json, options: o, lang: lang)
    }

    func toJSON(_ xml: String, _ o: O = O(indent: "")) throws -> JSONXML.Result {
        try JSONXML.xmlToJSON(xml, options: o)
    }

    func noDecl(_ indent: String = "  ") -> O { O(indent: indent, declaration: false) }

    func testTypeScalarAndNames() {
        let cases: [(String, JSONValue)] = [
            ("42", .number("42")), ("-3.5", .number("-3.5")), ("0", .number("0")), ("true", .bool(true)), ("false", .bool(false)),
            ("007", .string("007")), ("1.0", .string("1.0")), ("1.50", .string("1.50")), ("1e5", .string("1e5")),
            ("-0", .string("-0")), ("+1", .string("+1")), ("12345678901234567890", .string("12345678901234567890")),
            ("True", .string("True")), ("", .string("")), ("abc", .string("abc")), ("0x1F", .string("0x1F")),
            ("0.1", .number("0.1")), ("9007199254740991", .number("9007199254740991")), ("9007199254740993", .string("9007199254740993")),
        ]
        for (s, v) in cases { XCTAssertEqual(JSONXML.typeScalar(s), v, s) }
        XCTAssertTrue(JSONXML.isXMLName("book"))
        XCTAssertTrue(JSONXML.isXMLName("soap:Envelope"))
        XCTAssertTrue(JSONXML.isXMLName("书名"))
        XCTAssertFalse(JSONXML.isXMLName("first name"))
        XCTAssertFalse(JSONXML.isXMLName("1abc"))
        XCTAssertFalse(JSONXML.isXMLName(""))
        XCTAssertEqual(JSONXML.xmlName("first name"), "first_name")
        XCTAssertEqual(JSONXML.xmlName("1abc"), "_1abc")
        XCTAssertEqual(JSONXML.xmlName(""), "_")
        XCTAssertEqual(JSONXML.xmlName("a@b"), "a_b")
        XCTAssertEqual(JSONXML.xmlName("ok"), "ok")
        XCTAssertEqual(FC.jsNumber(1e21), "1e+21")
        XCTAssertEqual(FC.jsNumber(1.5e-7), "1.5e-7")
        XCTAssertEqual(FC.jsNumber(123.456), "123.456")
        XCTAssertEqual(FC.jsNumber(100), "100")
        XCTAssertEqual(FC.jsNumber(0.000001), "0.000001")
    }

    func testSingleRootWithAttributesAndText() throws {
        let json = ##"{"catalog":{"@_ver":"1.0","book":[{"@_id":"b1","title":"A"},{"@_id":"b2","title":"B & C","note":{"@_type":"tip","#text":"hi"}}]}}"##
        let r = try toXML(json)
        XCTAssertEqual(r.output, """
        <?xml version="1.0" encoding="UTF-8"?>
        <catalog ver="1.0">
          <book id="b1">
            <title>A</title>
          </book>
          <book id="b2">
            <title>B &amp; C</title>
            <note type="tip">hi</note>
          </book>
        </catalog>
        """)
        XCTAssertFalse(r.wrapped)
        XCTAssertEqual(r.elements, 6)
        XCTAssertEqual(r.attributes, 4)
        XCTAssertEqual(r.warnings, [])
    }

    func testWrapping() throws {
        XCTAssertEqual(try toXML(#"{"a":1,"b":2}"#, noDecl()).output, "<root>\n  <a>1</a>\n  <b>2</b>\n</root>")
        var list = noDecl()
        list.rootName = "list"
        XCTAssertEqual(try toXML("[1,2]", list).output, "<list>\n  <item>1</item>\n  <item>2</item>\n</list>")
        XCTAssertEqual(try toXML("42", noDecl()).output, "<root>42</root>")
        let single = try toXML(#"{"users":[{"n":1},{"n":2}]}"#, noDecl())
        XCTAssertTrue(single.wrapped)
        XCTAssertTrue(single.output.hasPrefix("<root>"))
        XCTAssertEqual(try toXML(#"{"@_id":1,"a":1}"#, noDecl()).output, "<root id=\"1\">\n  <a>1</a>\n</root>")
        XCTAssertEqual(try toXML(#"{"r":{"a":null,"b":"","c":0,"d":false}}"#, noDecl()).output, "<r>\n  <a/>\n  <b/>\n  <c>0</c>\n  <d>false</d>\n</r>")
        XCTAssertEqual(try toXML(#"{"r":{"m":[[1,2],[3]]}}"#, noDecl("")).output, "<r><m><item>1</item><item>2</item></m><m><item>3</item></m></r>")
    }

    func testRenamingAndWarnings() throws {
        let r = try toXML(#"{"r":{"first name":"x","2fa":true,"中文":"值"}}"#, noDecl())
        XCTAssertTrue(r.output.contains("<first_name>x</first_name>"))
        XCTAssertTrue(r.output.contains("<_2fa>true</_2fa>"))
        XCTAssertTrue(r.output.contains("<中文>值</中文>"))
        XCTAssertTrue(r.warnings[0].contains("“first name” → first_name"))
        XCTAssertEqual(try toXML(#"{"r":{"a b":1,"a_b":2}}"#, noDecl("")).output, "<r><a_b>1</a_b><a_b_2>2</a_b_2></r>")
        let w = try toXML(#"{"r":{"list":[],"@_meta":{"x":1},"keep":1}}"#, noDecl())
        XCTAssertEqual(w.output, "<r meta=\"{&quot;x&quot;:1}\">\n  <keep>1</keep>\n</r>")
        XCTAssertTrue(w.warnings.contains { $0.contains("空数组") && $0.contains("r.list") })
        XCTAssertTrue(w.warnings.contains { $0.contains("JSON 字符串") })
        XCTAssertEqual(try toXML(#"{"r":{"@_q":"a\"b<c","t":"<tag> & \"q\" 's'"}}"#, noDecl("")).output,
                       "<r q=\"a&quot;b&lt;c\"><t>&lt;tag&gt; &amp; &quot;q&quot; &apos;s&apos;</t></r>")
        var badRoot = O()
        badRoot.rootName = "1 bad"
        let bad = try toXML(#"{"a":1,"b":2}"#, badRoot)
        XCTAssertTrue(bad.output.contains("<_1_bad>"))
        XCTAssertTrue(bad.warnings.joined().contains("根元素名 “1 bad” 不是合法的 XML 名称，已改为 _1_bad"))
        XCTAssertEqual(try toXML(#"{"a":{"b":1}}"#, badRoot).warnings, [])
        let en = try toXML(#"{"a":[[],[1]]}"#, O(), lang: .en)
        XCTAssertEqual(en.warnings, ["Empty arrays cannot be represented in XML and were left out: a[0]"])
        XCTAssertEqual(try toXML("[]").warnings, ["空数组无法用 XML 表示，已省略：（根数组）"])
        let pi = try toXML(#"{"?xml-stylesheet":{"@_href":"a.xsl"},"a":1}"#)
        XCTAssertFalse(pi.output.contains("xml-stylesheet"))
        XCTAssertTrue(pi.warnings.joined().contains("?xml-stylesheet"))
    }

    func testPrefixesTextKeysIndentAndDeclarations() throws {
        XCTAssertEqual(try toXML(#"{"r":{"$id":"1","_":"text"}}"#, O(attrPrefix: "$", textKey: "_", indent: "", declaration: false)).output, "<r id=\"1\">text</r>")
        XCTAssertEqual(try toXML(#"{"r":{"@_id":1}}"#, O(attrPrefix: "", indent: "", declaration: false)).output, "<r><__id>1</__id></r>")
        XCTAssertEqual(try toXML(#"{"a":{"b":1}}"#, noDecl("    ")).output, "<a>\n    <b>1</b>\n</a>")
        XCTAssertEqual(try toXML(#"{"a":{"b":1}}"#, noDecl("\t")).output, "<a>\n\t<b>1</b>\n</a>")
        XCTAssertEqual(try toXML(#"{"a":1}"#, O(indent: "")).output, "<?xml version=\"1.0\" encoding=\"UTF-8\"?><a>1</a>")
        let decl = #"{"?xml":{"@_version":"1.0","@_standalone":"yes"},"a":{"b":1}}"#
        XCTAssertEqual(try toXML(decl).output.split(separator: "\n").first, "<?xml version=\"1.0\" standalone=\"yes\"?>")
        XCTAssertEqual(try toXML(decl, noDecl()).output, "<a>\n  <b>1</b>\n</a>")
        var named = noDecl("")
        named.rootName = "my list"
        XCTAssertEqual(try toXML("[1]", named).output, "<my_list><item>1</item></my_list>")
        named.rootName = "  "
        XCTAssertEqual(try toXML("[1]", named).output, "<root><item>1</item></root>")
        XCTAssertEqual(try toXML("  ").output, "")
        XCTAssertTrue(try toXML(##"{"a":{"@_x":1,"#text":"t"}}"##, O(textKey: "")).output.contains("<a x=\"1\">t</a>"))
        XCTAssertTrue(try toXML(#"{"a":{"":1}}"#, O(textKey: "")).output.contains("<_>1</_>"))
        // 大数按原文输出
        XCTAssertEqual(try toXML(#"{"n":12345678901234567890123}"#, noDecl()).output, "<n>12345678901234567890123</n>")
    }

    func testJSONErrors() {
        XCTAssertThrowsError(try toXML("{\n  \"a\": 1\n  \"b\": 2\n}")) { error in
            let e = error as? ToolError
            XCTAssertEqual(e?.line, 3)
            XCTAssertTrue(e?.message.contains("逗号") ?? false)
        }
        let deep = String(repeating: "[", count: 20000) + String(repeating: "]", count: 20000)
        XCTAssertThrowsError(try toXML(deep))
    }

    let orderXML = """
    <?xml version="1.0"?>
    <order id="SO-1" vip="true">
      <item sku="A"><qty>1</qty><price>1.50</price><zip>007</zip></item>
      <item sku="B"><qty>2</qty><price>2.5</price></item>
      <note>a &amp; b</note>
      <remark><![CDATA[x < y]]></remark>
      <empty/>
    </order>
    """

    func testXMLToJSON() throws {
        let r = try toJSON(orderXML)
        XCTAssertEqual(r.output, #"{"order":{"@_id":"SO-1","@_vip":true,"item":[{"@_sku":"A","qty":1,"price":"1.50","zip":"007"},{"@_sku":"B","qty":2,"price":2.5}],"note":"a & b","remark":"x < y","empty":""}}"#)
        XCTAssertEqual(r.elements, 11)
        XCTAssertEqual(r.attributes, 4)
        XCTAssertEqual(try toJSON("<a n=\"1\"><b>2</b><c>true</c></a>", O(indent: "", parseValues: false)).output, #"{"a":{"@_n":"1","b":"2","c":"true"}}"#)
        XCTAssertEqual(try toJSON("<?xml version=\"1.0\"?><a>1</a>", O(indent: "", ignoreDeclaration: false)).output, #"{"?xml":{"@_version":"1.0"},"a":1}"#)
        XCTAssertEqual(try toJSON("<a id=\"1\">hi</a>", O(textKey: "_", indent: "")).output, #"{"a":{"@_id":1,"_":"hi"}}"#)
        XCTAssertEqual(try toJSON("<a id=\"1\"><b>2</b></a>", O(attrPrefix: "", indent: "")).output, #"{"a":{"id":1,"b":2}}"#)
        XCTAssertEqual(try toJSON("<soap:Envelope xmlns:soap=\"x\"><名字>张三 😀</名字></soap:Envelope>").output, #"{"soap:Envelope":{"@_xmlns:soap":"x","名字":"张三 😀"}}"#)
        XCTAssertEqual(try toJSON("<a>1</a>", O(indent: "    ")).output, "{\n    \"a\": 1\n}")
        XCTAssertEqual(try toJSON("<a>1</a>", O(indent: "\t")).output, "{\n\t\"a\": 1\n}")
        XCTAssertEqual(try toJSON("\u{FEFF}<a>1</a>").output, #"{"a":1}"#)
        XCTAssertEqual(try toJSON("   ").output, "")
        XCTAssertTrue(try toJSON("<a></a>\n<b/>").warnings[0].contains("2 个根元素"))
        XCTAssertEqual(try toJSON("<a x=\"&#65;\">&#20013;&#x6587;&#x1F600; &amp;#65; &lt;</a>").output, ##"{"a":{"@_x":"A","#text":"中文😀 &#65; <"}}"##)
        XCTAssertEqual(try toJSON("<a x=\"1\">t</a>", O(textKey: "", indent: "")).output, ##"{"a":{"@_x":1,"#text":"t"}}"##)
        XCTAssertEqual(try toJSON("<a x=\"1\">t<b/></a>", O(textKey: "")).elements, 2)
        XCTAssertEqual(try toJSON("<!DOCTYPE a [<!ENTITY w \"张三\">]><a>&w;</a>").output, #"{"a":"张三"}"#)
        XCTAssertEqual(try toJSON("<a><?pi x=\"1\"?><b>t</b><!-- c --></a>").output, #"{"a":{"?pi":{"@_x":"1"},"b":"t"}}"#)
    }

    func testLargeXML() throws {
        var xml = "<list>"
        for i in 0..<5000 { xml += "<i n=\"\(i)\">v\(i)</i>" }
        xml += "</list>"
        let r = try toJSON(xml)
        XCTAssertEqual(r.elements, 5001)
        XCTAssertEqual(try JSON.value(r.output)["list"]?["i"]?.items?.count, 5000)
    }

    func testXMLErrors() {
        func err(_ xml: String) -> ToolError? {
            do { _ = try toJSON(xml); return nil } catch { return error as? ToolError }
        }
        let e = err("<a>\n  <b>\n</a>")
        XCTAssertEqual([e?.line, e?.column], [3, 1])
        XCTAssertTrue(e?.message.contains("<b>（第 2 行第 3 列）没有闭合") ?? false)
        XCTAssertTrue(err("<a><b></b>")?.message.contains("标签 <a> 没有闭合") ?? false)
        let attr = err("<a>\n<input disabled/>\n</a>")
        XCTAssertTrue(attr?.message.contains("属性 disabled 缺少") ?? false)
        XCTAssertEqual(attr?.line, 2)
        XCTAssertTrue(err("hello")?.message.contains("没有找到任何 XML 元素") ?? false)
        XCTAssertTrue(err("<a>x & y</a>")?.message.contains("&amp;") ?? false)
        XCTAssertTrue(err("<a b=\"1\" b=\"2\"/>")?.message.contains("属性 b 重复") ?? false)
        XCTAssertTrue(err("<1a/>")?.message.contains("意外的 \"<\"") ?? false)
        let deep = String(repeating: "<a>", count: 1200) + String(repeating: "</a>", count: 1200)
        XCTAssertTrue(err(deep)?.message.contains("嵌套层级过深") ?? false)
    }

    func testRoundTrip() throws {
        let xml = """
        <catalog ver="2">
          <book id="b1" lang="zh">
            <title>三体</title>
            <price>23.5</price>
            <tags>
              <tag>科幻</tag>
              <tag>雨果奖</tag>
            </tags>
          </book>
          <book id="b2">
            <title>Note &amp; more</title>
            <price>45</price>
          </book>
        </catalog>
        """
        let json = try JSONXML.xmlToJSON(xml).output
        XCTAssertEqual(try JSONXML.jsonToXML(json, options: O(declaration: false)).output, xml)
    }

    func testToolSpec() throws {
        let tool = JSONXMLTool.spec
        let r = try tool(#"{"a":1}"#, options: ["declaration": "0"])
        XCTAssertEqual(r.primary?.value, "<a>1</a>")
        XCTAssertEqual(r.primary?.language, "xml")
        let back = try tool("<a>1</a>", options: ["mode": "xml2json", "indent": "0"])
        XCTAssertEqual(back.primary?.value, #"{"a":1}"#)
        XCTAssertEqual(back.primary?.language, "json")
        XCTAssertEqual(try tool("<a n=\"1\"/>", options: ["mode": "xml2json", "indent": "0", "attrPrefix": "", "parseValues": "0"]).primary?.value, #"{"a":{"n":"1"}}"#)
        XCTAssertThrowsError(try tool("{", lang: .en)) { error in
            XCTAssertTrue((error as? ToolError)?.message.hasPrefix("Line 1") ?? false)
        }
    }
}
