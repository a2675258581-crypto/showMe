import Foundation
import XCTest
@testable import ShowMeCore

final class FormatConvertTypesTests: XCTestCase {
    typealias T = JSONToTypes
    typealias Names = JSONToTypes.Names

    func show(_ t: T.TypeRef, _ m: T.Model) -> String {
        var s: String
        switch t.kind {
        case .primitive(let p): s = p.rawValue
        case .any: s = "any"
        case .array(let i): s = show(i, m) + "[]"
        case .map(let v): s = "map<\(show(v, m))>"
        case .object(let id): s = m.def(id).name
        case .union(let ms): s = "(" + ms.map { show($0, m) }.joined(separator: "|") + ")"
        }
        return t.nullable ? s + "?" : s
    }

    func model(_ json: String, _ root: String = "Root") throws -> T.Model {
        T.inferModel(try T.parseSamples(json).values, rootName: root)
    }

    func fields(_ m: T.Model, _ name: String) -> [String: String] {
        guard let d = m.objects.first(where: { $0.name == name }) else {
            XCTFail("no \(name) in \(m.objects.map(\.name))")
            return [:]
        }
        var out: [String: String] = [:]
        for f in d.fields { out[f.key + (f.optional ? "~" : "")] = show(f.type, m) }
        return out
    }

    func names(_ m: T.Model) -> [String] { m.objects.map(\.name) }

    func gen(_ json: String, _ target: T.Target = .typescript, root: String = "Root", _ o: T.RenderOptions = T.RenderOptions()) throws -> String {
        try T.generate(json, target: target, rootName: root, options: o).code
    }

    let sample = #"{"id":1,"first name":"x","class":"c","tags":["a"],"address":{"city":"x"},"items":[{"sku":"a","qty":1},{"sku":"b","qty":2.5,"note":null}],"meta":{}}"#

    // MARK: 命名

    func testSingularize() {
        let pairs = [
            ("items", "item"), ("users", "user"), ("categories", "category"), ("countries", "country"), ("properties", "property"),
            ("addresses", "address"), ("classes", "class"), ("statuses", "status"), ("buses", "bus"), ("aliases", "alias"),
            ("boxes", "box"), ("indexes", "index"), ("matches", "match"), ("dishes", "dish"), ("caches", "cache"),
            ("movies", "movie"), ("cookies", "cookie"), ("people", "person"), ("children", "child"), ("indices", "index"),
            ("analyses", "analysis"), ("leaves", "leaf"), ("heroes", "hero"), ("shoes", "shoe"), ("quizzes", "quiz"),
            ("menus", "menu"), ("emojis", "emoji"), ("apis", "api"), ("ids", "id"), ("keys", "key"), ("responses", "response"),
            ("courses", "course"), ("sizes", "size"),
        ]
        for (p, s) in pairs { XCTAssertEqual(Names.singularize(p), s, p) }
        for w in ["data", "news", "series", "status", "address", "analysis", "info", "metadata", "list", "商品", "Items", ""] {
            XCTAssertEqual(Names.singularize(w), w, w)
        }
    }

    func testKeyWordsAndCases() {
        XCTAssertEqual(Names.keyWords("userProfileID"), ["user", "profile", "id"])
        XCTAssertEqual(Names.keyWords("first name"), ["first", "name"])
        XCTAssertEqual(Names.keyWords("data-id"), ["data", "id"])
        XCTAssertEqual(Names.keyWords("base64Data"), ["base64", "data"])
        XCTAssertEqual(Names.keyWords("2fa-enabled"), ["2fa", "enabled"])
        XCTAssertEqual(Names.keyWords("XMLHttpRequest"), ["xml", "http", "request"])
        XCTAssertEqual(Names.keyWords("$ref"), ["ref"])
        XCTAssertEqual(Names.keyWords("🔥🔥"), [])
        XCTAssertEqual(Names.camelCase("user_name"), "userName")
        XCTAssertEqual(Names.pascalCase("user_name"), "UserName")
        XCTAssertEqual(Names.snakeCase("userName"), "user_name")
        XCTAssertEqual(Names.snakeCase("avatarURL"), "avatar_url")
        XCTAssertEqual(Names.camelCase("用户名"), "用户名")
        XCTAssertEqual(Names.camelCase(""), "")
        XCTAssertEqual(Names.goPascalCase("userId"), "UserID")
        XCTAssertEqual(Names.goPascalCase("avatar_url"), "AvatarURL")
        XCTAssertEqual(Names.goPascalCase("apiKey"), "APIKey")
        XCTAssertEqual(Names.goPascalCase("ids"), "IDs")
        XCTAssertEqual(Names.goPascalCase("http_status"), "HTTPStatus")
        XCTAssertEqual(Names.goExport("Name"), "Name")
        XCTAssertEqual(Names.goExport("name"), "Name")
        XCTAssertEqual(Names.goExport("用户"), "X用户")
        XCTAssertEqual(Names.goExport("2fa"), "X2fa")
        XCTAssertEqual(Names.typeName(fromKey: "shipping_address"), "ShippingAddress")
        XCTAssertEqual(Names.typeName(fromKey: "2fa"), "T2fa")
        XCTAssertEqual(Names.typeName(fromKey: "🔥"), "")
        XCTAssertEqual(Names.typeName(fromKey: "items", plural: true), "Item")
        XCTAssertEqual(Names.typeName(fromKey: "order_items", plural: true), "OrderItem")
        XCTAssertEqual(Names.typeName(fromKey: "people", plural: true), "Person")
        XCTAssertEqual(Names.typeName(fromKey: "data", plural: true), "DataItem")
        XCTAssertEqual(Names.typeName(fromKey: "list", plural: true), "ListItem")
        XCTAssertEqual(Names.typeName(fromKey: "商品", plural: true), "商品Item")
        XCTAssertEqual(Names.typeName(fromKey: "", plural: true), "Item")
        XCTAssertEqual(Names.commonSuffixName(["BillingAddress", "ShippingAddress"]), "Address")
        XCTAssertEqual(Names.commonSuffixName(["HomeUserAddress", "WorkUserAddress"]), "UserAddress")
        XCTAssertNil(Names.commonSuffixName(["Foo", "Bar"]))
        XCTAssertNil(Names.commonSuffixName([]))
        XCTAssertTrue(Names.isJSIdentifier("userName"))
        XCTAssertTrue(Names.isJSIdentifier("$ref"))
        XCTAssertTrue(Names.isJSIdentifier("用户名"))
        XCTAssertFalse(Names.isJSIdentifier("first name"))
        XCTAssertFalse(Names.isJSIdentifier("2fa"))
        XCTAssertTrue(Names.isPlainIdentifier("_x1"))
        XCTAssertFalse(Names.isPlainIdentifier("$ref"))
        var used = Set<String>()
        XCTAssertEqual(Names.uniqueName("a", &used), "a")
        XCTAssertEqual(Names.uniqueName("a", &used), "a2")
        var folded = Set<String>()
        XCTAssertEqual(Names.uniqueName("Item", &folded, fold: true), "Item")
        XCTAssertEqual(Names.uniqueName("item", &folded, fold: true), "item2")
    }

    // MARK: 推断

    func testParseSamples() throws {
        XCTAssertEqual(try T.parseSamples("{\"a\":1}").values.count, 1)
        XCTAssertTrue(try T.parseSamples("  \n ").empty)
        XCTAssertEqual(try T.parseSamples("\u{FEFF}[1]").values, [.array([.number("1")])])
        let lines = try T.parseSamples("{\"a\":1}\n\n{\"a\":2,\"b\":\"x\"}\r\n")
        XCTAssertTrue(lines.jsonLines)
        XCTAssertEqual(lines.values.count, 2)
        XCTAssertThrowsError(try T.parseSamples("{\n  \"a\": 1,\n  \"b\": \n}")) { error in
            XCTAssertEqual((error as? ToolError)?.line, 4)
            XCTAssertEqual((error as? ToolError)?.column, 1)
        }
        XCTAssertThrowsError(try T.parseSamples("{\"a\":1}\n\n{\"a\":2,\n{\"a\":3}")) { error in
            let e = error as? ToolError
            XCTAssertTrue(e?.message.hasPrefix("JSON Lines 第 3 行：") ?? false, e?.message ?? "")
            XCTAssertEqual(e?.line, 3)
            // 核心 JSON 解析器把「对象没有闭合」指向开头的 {
            XCTAssertEqual(e?.column, 1)
        }
        XCTAssertThrowsError(try T.parseSamples("{\n  \"a\": 1,\n}")) { error in
            XCTAssertFalse((error as? ToolError)?.message.contains("JSON Lines") ?? true)
        }
    }

    func testPrimitivesAndRoots() throws {
        XCTAssertEqual(fields(try model(#"{"s":"x","i":1,"f":1.5,"b":true,"n":null}"#), "Root"),
                       ["s": "string", "i": "integer", "f": "number", "b": "boolean", "n": "any?"])
        XCTAssertEqual(fields(try model(#"{"price": 1.0, "count": 1, "exp": 1e3}"#), "Root"), ["price": "number", "count": "integer", "exp": "number"])
        XCTAssertEqual(fields(try model(#"{"big": 1e20, "huge": 99999999999999999999}"#), "Root"), ["big": "number", "huge": "number"])
        let m1 = try model("[1, 2, 3]")
        XCTAssertEqual(show(m1.root, m1), "integer[]")
        let m2 = try model("\"x\"")
        XCTAssertEqual(show(m2.root, m2), "string")
        let m3 = try model("null")
        XCTAssertEqual(show(m3.root, m3), "any?")
        let m4 = try model("[]")
        XCTAssertEqual(show(m4.root, m4), "any[]")
        XCTAssertTrue(m4.objects.isEmpty)
        let r1 = try model(#"[{"a":1}]"#)
        XCTAssertEqual(show(r1.root, r1), "RootItem[]")
        let r2 = try model(#"[{"a":1}]"#, "Users")
        XCTAssertEqual(show(r2.root, r2), "User[]")
        let r3 = try model(#"[{"a":1}]"#, "user list")
        XCTAssertEqual(show(r3.root, r3), "UserListItem[]")
        XCTAssertEqual(T.normalizeRootName("api response"), "ApiResponse")
        XCTAssertEqual(T.normalizeRootName(""), "Root")
        XCTAssertEqual(T.normalizeRootName("   "), "Root")
        XCTAssertEqual(T.normalizeRootName("🔥"), "Root")
        XCTAssertEqual(T.normalizeRootName("用户"), "用户")
        XCTAssertEqual(names(try model(#"{"a":1}"#, "my_model")), ["MyModel"])
    }

    func testMerging() throws {
        XCTAssertEqual(fields(try model(#"{"items":[{"id":1,"name":"a"},{"id":2,"price":1.5},{"id":3,"name":null,"price":2}]}"#), "Item"),
                       ["id": "integer", "name~": "string?", "price~": "number"])
        XCTAssertEqual(fields(try model(#"{"v":[1,"a",true,null]}"#), "Root"), ["v": "(string|integer|boolean)?[]"])
        XCTAssertEqual(fields(try model(#"{"v":[1, 2.5]}"#), "Root"), ["v": "number[]"])
        XCTAssertEqual(fields(try model(#"{"a":[],"b":{}}"#), "Root"), ["a": "any[]", "b": "map<any>"])
        XCTAssertEqual(fields(try model(#"{"rows":[{"tags":[]},{"tags":["x"]}]}"#), "Row"), ["tags": "string[]"])
        let nested = fields(try model(#"{"matrix":[[1,2],[3]],"groups":[[{"a":1}]]}"#), "Root")
        XCTAssertEqual(nested["matrix"], "integer[][]")
        XCTAssertTrue(nested["groups"]?.hasSuffix("[][]") ?? false)
        XCTAssertEqual(fields(try model(#"{"v":[{"a":1},"x"]}"#), "Root"), ["v": "(string|VItem)[]"])
        XCTAssertEqual(fields(try model(#"[{"a":1},{"a":null}]"#), "RootItem"), ["a": "integer?"])
        XCTAssertEqual(fields(try model("{\"a\":1}\n{\"a\":2,\"b\":\"x\"}"), "Root"), ["a": "integer", "b~": "string"])
        let stats = T.stats(try model(#"[{"a":1,"b":null},{"a":2,"c":{"d":1}}]"#))
        XCTAssertEqual(stats, T.Stats(types: 2, fields: 4, optional: 2, nullable: 1))
    }

    func testNamingAndDedupe() throws {
        XCTAssertEqual(names(try model(#"{"userProfile":{"a":1},"order_items":[{"b":1}],"categories":[{"c":1}]}"#)), ["Root", "UserProfile", "OrderItem", "Category"])
        let addr = try model(#"{"billingAddress":{"city":"a","zip":"1"},"shippingAddress":{"zip":"2","city":"b"}}"#)
        XCTAssertEqual(names(addr), ["Root", "Address"])
        XCTAssertEqual(fields(addr, "Root"), ["billingAddress": "Address", "shippingAddress": "Address"])
        XCTAssertEqual(names(try model(#"{"a":{"x":1},"b":{"x":"s"}}"#)), ["Root", "A", "B"])
        XCTAssertEqual(names(try model(#"{"order":{"items":[{"sku":"a"}]},"cart":{"items":[{"qty":1}]}}"#)), ["Root", "Order", "Item", "Cart", "CartItem"])
        XCTAssertEqual(names(try model(#"{"data":{"a":1},"string":{"b":1}}"#)), ["Root", "RootData", "RootString"])
        XCTAssertEqual(names(try model(#"{"a":1}"#, "Data")), ["Data"])
        XCTAssertEqual(names(try model(#"{"data":[{"a":1}],"🔥":{"b":1},"2fa":{"c":1},"用户":{"d":1}}"#)), ["Root", "DataItem", "RootType", "T2fa", "用户"])
        XCTAssertEqual(names(try model(#"{"root":{"a":1}}"#)), ["Root", "RootRoot"])
        XCTAssertEqual(try model(#"[{"b":1,"a":2},{"c":3,"a":1}]"#).objects[0].fields.map(\.key), ["b", "a", "c"])
    }

    func testLargeArray() throws {
        var rows: [String] = []
        for i in 0..<20000 {
            rows.append("{\"id\":\(i),\"name\":\"user\(i)\"" + (i % 3 != 0 ? ",\"email\":\"a@b.c\"" : "") + ",\"tags\":" + (i % 2 != 0 ? "[\"a\"]" : "[]") + "}")
        }
        let start = Date()
        let m = try model("[" + rows.joined(separator: ",") + "]")
        XCTAssertLessThan(Date().timeIntervalSince(start), 10)
        XCTAssertEqual(fields(m, "RootItem"), ["id": "integer", "name": "string", "email~": "string", "tags": "string[]"])
    }

    // MARK: 渲染

    func testQuote() {
        let bs = "\\"
        XCTAssertEqual(T.quote("a\"b\\c\nd"), "\"a\\\"b\\\\c\\nd\"")
        XCTAssertEqual(T.quote("\u{1}"), "\"" + bs + "u0001\"")
        XCTAssertEqual(T.quote("\u{1}", .swift), "\"" + bs + "u{1}\"")
        XCTAssertEqual(T.quote("\u{1}", .rust), "\"" + bs + "u{1}\"")
        XCTAssertEqual(T.quote("$ref", .kotlin), "\"\\$ref\"")
        XCTAssertEqual(T.quote("$ref"), "\"$ref\"")
        XCTAssertEqual(T.quote("中文😀"), "\"中文😀\"")
    }

    func testEveryTargetRendersSamples() throws {
        for target in T.Target.allCases {
            for json in [sample, "[]", "{}", "null", "\"s\"", "[[1]]", #"[{"a":[{"b":{}}]}]"#] {
                let code = try gen(json, target)
                XCTAssertTrue(code.hasSuffix("\n"), "\(target) \(json)")
            }
        }
        XCTAssertEqual(T.Target.allCases.map { $0.fileName(rootName: "Root") },
                       ["types.ts", "types.go", "Root.java", "Root.kt", "types.rs", "Root.swift", "models.py", "Root.cs"])
        XCTAssertTrue(try gen(#"{"a":1}"#, root: "api response").contains("interface ApiResponse {"))
        XCTAssertEqual(try T.generate("   ", target: .go).code, "")
    }

    func testTypeScript() throws {
        XCTAssertEqual(try gen(sample), """
        export interface Root {
          id: number;
          "first name": string;
          class: string;
          tags: string[];
          address: Address;
          items: Item[];
          meta: Record<string, unknown>;
        }

        export interface Address {
          city: string;
        }

        export interface Item {
          sku: string;
          qty: number;
          note?: unknown;
        }

        """)
        XCTAssertEqual(try gen(#"{"a":[1],"b":{"c":null}}"#, .typescript, T.RenderOptions(tsInterface: false, tsReadonly: true, tsExport: false)), """
        type Root = {
          readonly a: readonly number[];
          readonly b: B;
        };

        type B = {
          readonly c: unknown;
        };

        """)
        let u = try gen(#"[{"a":1,"u":[1,"x"],"n":"s"},{"a":2,"u":[],"n":null}]"#)
        XCTAssertTrue(u.contains("export type Root = RootItem[];"))
        XCTAssertTrue(u.contains("  u: (string | number)[];"))
        XCTAssertTrue(u.contains("  n: string | null;"))
        let keys = try gen(#"{"data-id":1,"2fa":true,"用户名":"x","$ref":"r","_ok":1}"#)
        XCTAssertTrue(keys.contains("  \"data-id\": number;"))
        XCTAssertTrue(keys.contains("  \"2fa\": boolean;"))
        XCTAssertTrue(keys.contains("  用户名: string;"))
        XCTAssertTrue(keys.contains("  $ref: string;"))
        XCTAssertEqual(try gen("\"x\""), "export type Root = string;\n")
        XCTAssertEqual(try gen("[]"), "export type Root = unknown[];\n")
        XCTAssertEqual(try gen("[[1,2]]"), "export type Root = number[][];\n")
    }

    func testGo() throws {
        XCTAssertEqual(try gen(sample, .go), """
        type Root struct {
        \tID        int64          `json:"id"`
        \tFirstName string         `json:"first name"`
        \tClass     string         `json:"class"`
        \tTags      []string       `json:"tags"`
        \tAddress   Address        `json:"address"`
        \tItems     []Item         `json:"items"`
        \tMeta      map[string]any `json:"meta"`
        }

        type Address struct {
        \tCity string `json:"city"`
        }

        type Item struct {
        \tSku  string  `json:"sku"`
        \tQty  float64 `json:"qty"`
        \tNote any     `json:"note,omitempty"`
        }

        """)
        let ptr = try gen(#"[{"a":1,"o":{"x":1},"s":"x"},{"a":null,"s":"y"}]"#, .go)
        XCTAssertTrue(ptr.contains("A *int64 `json:\"a\"`") || ptr.range(of: #"A +\*int64 +`json:"a"`"#, options: .regularExpression) != nil, ptr)
        XCTAssertNotNil(ptr.range(of: #"O +\*O +`json:"o,omitempty"`"#, options: .regularExpression), ptr)
        XCTAssertTrue(try gen(#"[{"n":1},{}]"#, .go).contains("N int64 `json:\"n,omitempty\"`"))
        let special = try gen(#"{"-":1,"用户":2,"2fa":3,"a,b":4,"q\"k":5,"userId":6,"user_id":7}"#, .go)
        XCTAssertTrue(special.contains("`json:\"-,\"`"))
        XCTAssertNotNil(special.range(of: "X用户 +int64", options: .regularExpression))
        XCTAssertNotNil(special.range(of: "X2fa +int64", options: .regularExpression))
        XCTAssertTrue(special.contains("// 注意：键 \"a,b\""))
        XCTAssertTrue(special.contains(#"`json:"q\"k"`"#))
        XCTAssertNotNil(special.range(of: #"UserID +int64 +`json:"userId"`"#, options: .regularExpression))
        XCTAssertNotNil(special.range(of: #"UserID2 +int64 +`json:"user_id"`"#, options: .regularExpression))
        XCTAssertEqual(try gen(#"[{"a":1}]"#, .go), "type Root []RootItem\n\ntype RootItem struct {\n\tA int64 `json:\"a\"`\n}\n")
    }

    func testJava() throws {
        let code = try gen(sample, .java)
        XCTAssertTrue(code.hasPrefix("import com.fasterxml.jackson.annotation.JsonProperty;\n"))
        for part in [
            "import java.util.List;", "import java.util.Map;", "public class Root {",
            "    @JsonProperty(\"first name\")\n    private String firstName;", "    @JsonProperty(\"class\")\n    private String classValue;",
            "    private long id;", "    public long getId() {\n        return id;\n    }", "    public void setId(long id) {\n        this.id = id;\n    }",
            "    public static class Item {", "        private double qty;", "        private Object note;",
        ] {
            XCTAssertTrue(code.contains(part), part)
        }
        let boxed = try gen(#"[{"ok":true,"n":1,"f":1.5},{"ok":false,"f":null}]"#, .java)
        for part in ["private boolean ok;", "public boolean isOk()", "private Long n;", "private Double f;", "public Long getN()"] {
            XCTAssertTrue(boxed.contains(part), part)
        }
        let lombok = try gen(#"{"a":1,"b":{"c":"x"}}"#, .java, T.RenderOptions(javaLombok: true))
        XCTAssertTrue(lombok.contains("import lombok.Data;"))
        XCTAssertTrue(lombok.contains("@Data\npublic class Root {"))
        XCTAssertTrue(lombok.contains("    @Data\n    public static class B {"))
        XCTAssertFalse(lombok.contains("getA"))
        let rootList = try gen(#"[{"a":1}]"#, .java)
        XCTAssertFalse(rootList.contains("import java.util.List;"))
        XCTAssertTrue(rootList.contains("// JSON 根节点是 List<RootItem>"))
        XCTAssertTrue(rootList.contains("public class RootItem {"))
        XCTAssertEqual(try gen("[1,2]", .java), "// JSON 根节点是 List<Long>，没有需要生成的类\n")
        let isFields = try gen(#"{"isVerified":true,"isbn":"x","active":false}"#, .java, T.RenderOptions(javaLombok: true))
        XCTAssertTrue(isFields.contains("@JsonProperty(\"isVerified\")\n    private boolean isVerified;"))
        XCTAssertFalse(isFields.contains("@JsonProperty(\"active\")"))
        let plain = try gen(#"{"isVerified":true}"#, .java)
        XCTAssertFalse(plain.contains("@JsonProperty"))
        XCTAssertTrue(plain.contains("public boolean isIsVerified()"))
        let m = try model(#"[{"id":1}]"#)
        XCTAssertEqual(T.mainTypeName(m), "RootItem")
        XCTAssertEqual(T.Target.java.fileName(rootName: m.rootName, mainName: T.mainTypeName(m)), "RootItem.java")
        XCTAssertEqual(T.mainTypeName(try model(#"{"a":1}"#, "Resp")), "Resp")
    }

    func testKotlinAndRust() throws {
        let k = try gen(sample, .kotlin)
        XCTAssertTrue(k.contains("import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonElement"))
        XCTAssertTrue(k.contains("@Serializable\ndata class Root(\n    val id: Long,"))
        XCTAssertTrue(k.contains("    @SerialName(\"first name\") val firstName: String,"))
        XCTAssertTrue(k.contains("    val `class`: String,"))
        XCTAssertTrue(k.contains("    val note: JsonElement? = null,"))
        XCTAssertTrue(k.contains("    val meta: Map<String, JsonElement>,"))
        XCTAssertTrue(try gen(#"{"$ref":"x"}"#, .kotlin).contains("@SerialName(\"\\$ref\") val ref: String,"))
        XCTAssertTrue(try gen(#"[{"a":1}]"#, .kotlin).contains("typealias Root = List<RootItem>"))

        XCTAssertEqual(try gen(sample, .rust), """
        use serde::{Deserialize, Serialize};
        use std::collections::HashMap;

        #[derive(Debug, Clone, Serialize, Deserialize)]
        pub struct Root {
            pub id: i64,
            #[serde(rename = "first name")]
            pub first_name: String,
            pub class: String,
            pub tags: Vec<String>,
            pub address: Address,
            pub items: Vec<Item>,
            pub meta: HashMap<String, serde_json::Value>,
        }

        #[derive(Debug, Clone, Serialize, Deserialize)]
        pub struct Address {
            pub city: String,
        }

        #[derive(Debug, Clone, Serialize, Deserialize)]
        pub struct Item {
            pub sku: String,
            pub qty: f64,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub note: Option<serde_json::Value>,
        }

        """)
        let camel = try gen(#"{"userName":"a","createdAt":"b","id":1,"first-name":"x"}"#, .rust)
        XCTAssertTrue(camel.contains("#[serde(rename_all = \"camelCase\")]"))
        XCTAssertTrue(camel.contains("    pub user_name: String,"))
        XCTAssertFalse(camel.contains("rename = \"userName\""))
        XCTAssertTrue(camel.contains("    #[serde(rename = \"first-name\")]\n    pub first_name: String,"))
        let kw = try gen(#"[{"type":"a","self":1,"v":[1,null]},{"type":"b","self":2,"v":[],"o":1}]"#, .rust)
        XCTAssertTrue(kw.contains("    pub r#type: String,"))
        XCTAssertTrue(kw.contains("    #[serde(rename = \"self\")]\n    pub self_: i64,"))
        XCTAssertTrue(kw.contains("    pub v: Vec<Option<i64>>,"))
        XCTAssertTrue(kw.contains("    #[serde(skip_serializing_if = \"Option::is_none\")]\n    pub o: Option<i64>,"))
        XCTAssertTrue(kw.contains("pub type Root = Vec<RootItem>;"))
    }

    func testSwiftPythonCSharp() throws {
        let s = try gen(sample, .swift)
        XCTAssertTrue(s.hasPrefix("import Foundation\n\nstruct Root: Codable {\n    let id: Int\n"))
        for part in ["    let `class`: String", "        case firstName = \"first name\"", "        case `class`",
                     "struct Address: Codable {\n    let city: String\n}", "    let note: JSONValue?", "enum JSONValue: Codable, Hashable {"] {
            XCTAssertTrue(s.contains(part), part)
        }
        let plain = try gen(#"{"a":1,"b":[true]}"#, .swift)
        XCTAssertFalse(plain.contains("JSONValue"))
        XCTAssertFalse(plain.contains("CodingKeys"))
        XCTAssertTrue(plain.contains("    let b: [Bool]"))
        let control = try gen("{\"a" + "\\" + "u0001\":1}", .swift)
        XCTAssertTrue(control.contains("case a = \"a" + "\\" + "u{1}\""), control)

        let py = try gen(sample, .python)
        XCTAssertTrue(py.contains("from __future__ import annotations\n\nfrom dataclasses import dataclass\nfrom typing import Any"))
        XCTAssertLessThan(py.range(of: "class Address")?.lowerBound ?? py.endIndex, py.range(of: "class Root")?.lowerBound ?? py.startIndex)
        XCTAssertTrue(py.contains("    first_name: str  # JSON 键：\"first name\""))
        XCTAssertTrue(py.contains("    class_: str  # JSON 键：\"class\""))
        XCTAssertTrue(py.contains("    note: Any = None"))
        XCTAssertTrue(try gen(#"[{"b":1,"a":"x"},{"a":"y"}]"#, .python).contains("    a: str\n    b: int | None = None"))
        let td = try gen(#"[{"a":1,"b":{"c":null}},{"a":2}]"#, .python, T.RenderOptions(pythonTypedDict: true))
        XCTAssertTrue(td.contains("from typing import Any, NotRequired, TypedDict"))
        XCTAssertTrue(td.contains("class RootItem(TypedDict):\n    a: int\n    b: NotRequired[B]"))
        XCTAssertTrue(td.contains("class B(TypedDict):\n    c: Any"))
        XCTAssertTrue(td.hasSuffix("Root = list[RootItem]\n"))
        let fn = try gen(#"{"first name":"x","class":1}"#, .python, T.RenderOptions(pythonTypedDict: true))
        XCTAssertTrue(fn.contains("Root = TypedDict(\n    \"Root\",\n    {\n        \"first name\": str,\n        \"class\": int,\n    },\n)"))
        let dep = try gen(#"{"outer":{"x y":{"a":1}}}"#, .python, T.RenderOptions(pythonTypedDict: true))
        XCTAssertLessThan(dep.range(of: "class XY(TypedDict)")?.lowerBound ?? dep.endIndex, dep.range(of: "Outer = TypedDict")?.lowerBound ?? dep.startIndex)

        let cs = try gen(sample, .csharp)
        XCTAssertTrue(cs.hasPrefix("using System.Collections.Generic;\nusing System.Text.Json.Serialization;\n"))
        for part in ["    [JsonPropertyName(\"id\")]\n    public long Id { get; set; }",
                     "    [JsonPropertyName(\"first name\")]\n    public string FirstName { get; set; } = string.Empty;",
                     "    public List<string> Tags { get; set; } = new();", "    public Dictionary<string, object?> Meta { get; set; } = new();",
                     "    public object? Note { get; set; }"] {
            XCTAssertTrue(cs.contains(part), part)
        }
        let clash = try gen(#"{"item":1}"#, .csharp, root: "Item")
        XCTAssertTrue(clash.contains("public class Item\n{"))
        XCTAssertTrue(clash.contains("    public long Item2 { get; set; }"))
        let rows = try gen(#"[{"n":1,"s":"x"},{"n":2}]"#, .csharp, root: "Rows")
        XCTAssertTrue(rows.contains("// JSON 根节点是 List<Row>"))
        XCTAssertTrue(rows.contains("    public string? S { get; set; }"))
        XCTAssertFalse(rows.contains("System.Collections.Generic"))

        let expected: [(T.Target, String)] = [
            (.typescript, "用户名: string;"), (.go, "X用户名"), (.java, "private String 用户名;"), (.kotlin, "val 用户名: String,"),
            (.rust, "pub 用户名: String,"), (.swift, "let 用户名: String"), (.python, "用户名: str"), (.csharp, "public string 用户名 { get; set; }"),
        ]
        for (target, part) in expected { XCTAssertTrue(try gen(#"{"用户名":"张三"}"#, target).contains(part), "\(target)") }
    }

    func testToolSpec() throws {
        let tool = JSONToTypesTool.spec
        let r = try tool(#"[{"a":1},{"a":2,"b":null}]"#)
        XCTAssertEqual(r.primary?.language, "typescript")
        XCTAssertTrue(r.primary?.value.contains("export interface RootItem {") ?? false)
        XCTAssertEqual(r.notes[0].message, "1 个类型 · 2 个字段 · 1 个可选 · 1 个可空 · 样本 2 个")
        let go = try tool(#"{"userId":1}"#, options: ["target": "go", "rootName": "user"], lang: .en)
        XCTAssertEqual(go.primary?.value, "type User struct {\n\tUserID int64 `json:\"userId\"`\n}\n")
        XCTAssertEqual(go.primary?.language, "go")
        XCTAssertEqual(go.notes[1].message, "Suggested file name: types.go")
        let lines = try tool("{\"a\":1}\n{\"a\":2}\n{\"a\":3}", options: ["target": "python", "pythonStyle": "typeddict"])
        XCTAssertTrue(lines.notes[0].message.contains("JSON Lines 3 行"))
        XCTAssertTrue(lines.primary?.value.contains("class Root(TypedDict):") ?? false)
        XCTAssertEqual(try tool("[1,2]", options: ["target": "java"], lang: .en).primary?.value,
                       "// The JSON root is List<Long>; there are no classes to generate\n")
        XCTAssertTrue(try tool(#"{"first name":"x"}"#, options: ["target": "python"], lang: .en).primary?.value.contains("  # JSON key: \"first name\"") ?? false)
        XCTAssertTrue(try tool(#"{"a":null}"#, options: ["target": "swift"], lang: .en).primary?.value.contains("/// Any JSON value") ?? false)
        XCTAssertThrowsError(try tool(#"{"a": 1,"#, lang: .en)) { error in
            XCTAssertTrue((error as? ToolError)?.message.hasPrefix("Line 1") ?? false)
        }
    }
}
