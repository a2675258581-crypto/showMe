import XCTest
@testable import ShowMeCore

final class EditorCoreLanguageTests: XCTestCase {
    func testDetectByFileName() {
        let table: [(String, String)] = [
            ("a.json", "json"), ("A.JSON", "json"), ("x.jsonc", "json"), ("x.json5", "json"), ("map.geojson", "json"),
            ("site.webmanifest", "json"), ("/Users/me/proj/package.json", "json"),
            ("README.md", "markdown"), ("notes.markdown", "markdown"), ("doc.mdx", "markdown"),
            ("a.js", "javascript"), ("a.mjs", "javascript"), ("a.cjs", "javascript"), ("App.jsx", "javascript"),
            ("a.ts", "typescript"), ("App.tsx", "typescript"), ("a.mts", "typescript"), ("a.cts", "typescript"),
            ("a.css", "css"), ("a.scss", "scss"), ("a.less", "less"),
            ("index.html", "html"), ("a.htm", "html"), ("App.vue", "html"),
            ("a.xml", "xml"), ("Info.plist", "xml"), ("icon.svg", "xml"), ("s.xsd", "xml"), ("t.xsl", "xml"),
            ("feed.rss", "xml"), ("feed.atom", "xml"), ("Main.storyboard", "xml"),
            ("a.yaml", "yaml"), ("C:\\proj\\ci.yml", "yaml"), ("Cargo.toml", "toml"), ("Cargo.lock", "toml"),
            ("a.ini", "ini"), ("setup.cfg", "ini"), ("nginx.conf", "ini"), ("app.properties", "ini"), (".env", "ini"),
            (".env.local", "ini"), ("prod.env", "ini"), (".editorconfig", "ini"),
            ("q.sql", "sql"), ("a.sh", "shell"), ("a.bash", "shell"), ("a.zsh", "shell"), ("a.fish", "shell"),
            ("run.command", "shell"), (".zshrc", "shell"),
            ("a.py", "python"), ("a.go", "go"), ("A.java", "java"), ("a.kt", "kotlin"), ("build.gradle.kts", "kotlin"),
            ("a.swift", "swift"), ("lib.rs", "rust"), ("a.c", "c"), ("a.h", "c"), ("a.cpp", "cpp"), ("a.cc", "cpp"),
            ("a.cxx", "cpp"), ("a.hpp", "cpp"), ("a.hh", "cpp"), ("a.m", "objective-c"), ("a.mm", "objective-c"),
            ("a.cs", "csharp"), ("a.php", "php"), ("a.rb", "ruby"), ("Gemfile", "ruby"), ("Podfile", "ruby"),
            ("a.lua", "lua"), ("a.dart", "dart"), ("a.scala", "scala"), ("build.sbt", "scala"), ("a.r", "r"), ("a.R", "r"),
            ("schema.graphql", "graphql"), ("q.gql", "graphql"),
            ("Dockerfile", "dockerfile"), ("Dockerfile.dev", "dockerfile"), ("dockerfile", "dockerfile"),
            ("Makefile", "makefile"), ("makefile", "makefile"), ("GNUmakefile", "makefile"), ("rules.mk", "makefile"),
            ("a.diff", "diff"), ("fix.patch", "diff"), ("app.log", "log"), ("data.csv", "csv"), ("data.tsv", "csv"),
            (".gitignore", "ignore"), (".dockerignore", "ignore"),
            ("notes.txt", "plain"),
        ]
        for (name, id) in table {
            XCTAssertEqual(EditorLanguage.detect(fileName: name, content: nil).id, id, name)
        }
        XCTAssertNil(EditorLanguage.detect(fileName: "archive.tar.gz"))
        XCTAssertNil(EditorLanguage.detect(fileName: ""))
        XCTAssertEqual(EditorLanguage.detect(fileName: "archive.tar.gz", content: nil).id, "plain")
    }

    func testRequiredLanguagesExist() {
        let required = """
            plain markdown json javascript typescript css scss less html xml yaml toml ini sql shell python go java kotlin \
            swift rust c cpp objective-c csharp php ruby lua dart scala r graphql dockerfile makefile diff log csv
            """
        let ids = Set(EditorLanguage.all.map(\.id))
        for id in required.split(separator: " ") {
            XCTAssertTrue(ids.contains(String(id)), "缺少 \(id)")
        }
        // id 唯一、扩展名小写、除纯文本外都有扫描器
        XCTAssertEqual(ids.count, EditorLanguage.all.count)
        for lang in EditorLanguage.all {
            for ext in lang.extensions { XCTAssertEqual(ext, ext.lowercased(), lang.id) }
            XCTAssertEqual(Highlighter.supports(lang.id), lang.id != "plain", lang.id)
        }
    }

    func testFormatters() {
        func formatter(_ name: String) -> FormatterKind? {
            let lang = EditorLanguage.detect(fileName: name, content: nil)
            return lang.formatter(forFileName: name)
        }
        XCTAssertEqual(formatter("a.json"), .json)
        XCTAssertEqual(formatter("a.json5"), .prettier(parser: "json5"))
        XCTAssertEqual(formatter("a.jsonc"), .prettier(parser: "json5"))
        XCTAssertEqual(formatter(".babelrc"), .prettier(parser: "json5"))
        XCTAssertEqual(formatter("a.geojson"), .json)
        XCTAssertEqual(formatter("a.js"), .prettier(parser: "babel"))
        XCTAssertEqual(formatter("a.tsx"), .prettier(parser: "babel-ts"))
        XCTAssertEqual(formatter("a.css"), .prettier(parser: "css"))
        XCTAssertEqual(formatter("a.scss"), .prettier(parser: "scss"))
        XCTAssertEqual(formatter("a.less"), .prettier(parser: "less"))
        XCTAssertEqual(formatter("a.html"), .prettier(parser: "html"))
        XCTAssertEqual(formatter("App.vue"), .prettier(parser: "vue"))
        XCTAssertEqual(formatter("a.md"), .prettier(parser: "markdown"))
        XCTAssertEqual(formatter("a.yml"), .prettier(parser: "yaml"))
        XCTAssertEqual(formatter("a.graphql"), .prettier(parser: "graphql"))
        XCTAssertEqual(formatter("Info.plist"), .xml)
        XCTAssertEqual(formatter("q.sql"), .sql(dialect: "sql"))
        XCTAssertNil(formatter("main.go"))
        XCTAssertNil(formatter("notes.txt"))
        XCTAssertEqual(EditorLanguage.byID("json").formatter(forFileName: nil), .json)
    }

    func testMetadata() {
        let plain = EditorLanguage.byID("plain")
        XCTAssertEqual(plain.displayName(.zh), "纯文本")
        XCTAssertEqual(plain.displayName(.en), "Plain Text")
        XCTAssertEqual(EditorLanguage.byID("json").displayName(.zh), "JSON")
        XCTAssertEqual(EditorLanguage.byID("cpp").name, "C++")
        XCTAssertTrue(plain.isProse)
        XCTAssertTrue(EditorLanguage.byID("markdown").isProse)
        XCTAssertFalse(EditorLanguage.byID("json").isProse)
        XCTAssertEqual(EditorLanguage.byID("python").lineComment, "#")
        XCTAssertEqual(EditorLanguage.byID("sql").lineComment, "--")
        XCTAssertEqual(EditorLanguage.byID("swift").blockComment, BlockComment("/*", "*/"))
        XCTAssertEqual(EditorLanguage.byID("html").blockComment, BlockComment("<!--", "-->"))
        XCTAssertNil(EditorLanguage.byID("json").lineComment)
        XCTAssertTrue(EditorLanguage.byID("python").indentsAfterColon)
        XCTAssertFalse(EditorLanguage.byID("swift").indentsAfterColon)
        XCTAssertTrue(EditorLanguage.byID("dockerfile").fileNames.contains("Dockerfile"))
    }

    func testByIDAndAliases() {
        XCTAssertEqual(EditorLanguage.byID("json").id, "json")
        XCTAssertEqual(EditorLanguage.byID("SWIFT").id, "swift")
        XCTAssertEqual(EditorLanguage.byID("js").id, "javascript")
        XCTAssertEqual(EditorLanguage.byID("ts").id, "typescript")
        XCTAssertEqual(EditorLanguage.byID("yml").id, "yaml")
        XCTAssertEqual(EditorLanguage.byID("sh").id, "shell")
        XCTAssertEqual(EditorLanguage.byID("objc").id, "objective-c")
        XCTAssertEqual(EditorLanguage.byID("c#").id, "csharp")
        XCTAssertEqual(EditorLanguage.byID("svg").id, "xml") // 扩展名兜底
        XCTAssertEqual(EditorLanguage.byID("no-such-language").id, "plain")
        XCTAssertEqual(EditorLanguage.byID("").id, "plain")
        XCTAssertEqual(EditorLanguage.byExtension(".RS")?.id, "rust")
        XCTAssertNil(EditorLanguage.byExtension("zzz"))
    }

    func testSniffContent() {
        func sniff(_ s: String) -> String { EditorLanguage.detect(fileName: nil, content: s).id }
        XCTAssertEqual(sniff(#"{"a": [1, 2]}"#), "json")
        XCTAssertEqual(sniff("\n  [1, 2, 3]\n"), "json")
        XCTAssertEqual(sniff("\u{FEFF}{\"bom\": true}"), "json")
        XCTAssertNotEqual(sniff("{ not json"), "json")
        XCTAssertNotEqual(sniff("[link](x) and more"), "json")
        XCTAssertEqual(sniff(#"<?xml version="1.0"?><a/>"#), "xml")
        XCTAssertEqual(sniff("<!DOCTYPE html>\n<html></html>"), "html")
        XCTAssertEqual(sniff("<div class=\"x\">hi</div>"), "html")
        XCTAssertEqual(sniff("<note><to>Tove</to></note>"), "xml")
        XCTAssertEqual(sniff("#!/usr/bin/env python3\nprint(1)"), "python")
        XCTAssertEqual(sniff("#!/bin/bash\necho hi"), "shell")
        XCTAssertEqual(sniff("#!/bin/sh"), "shell")
        XCTAssertEqual(sniff("#!/usr/bin/env node\nconsole.log(1)"), "javascript")
        XCTAssertEqual(sniff("#!/usr/bin/env -S deno run --allow-net"), "javascript")
        XCTAssertEqual(sniff("#!/usr/bin/ruby -w"), "ruby")
        XCTAssertEqual(sniff("# 标题\n\n正文"), "markdown")
        XCTAssertEqual(sniff("- 苹果\n- 香蕉\n"), "markdown")
        XCTAssertEqual(sniff("1. first\n2. second\n"), "markdown")
        XCTAssertEqual(sniff("diff --git a/x b/x\nindex 1..2\n"), "diff")
        XCTAssertEqual(sniff("hello world"), "plain")
        XCTAssertEqual(sniff(""), "plain")
        XCTAssertEqual(sniff("   \n\t"), "plain")
        XCTAssertEqual(sniff("#hashtag not heading"), "plain")
        // 文件名优先；未知扩展名再看内容
        XCTAssertEqual(EditorLanguage.detect(fileName: "notes.txt", content: "{}").id, "plain")
        XCTAssertEqual(EditorLanguage.detect(fileName: "data", content: "{\"a\":1}").id, "json")
        XCTAssertEqual(EditorLanguage.detect(fileName: "script", content: "#!/usr/bin/env bash\n").id, "shell")
    }
}
