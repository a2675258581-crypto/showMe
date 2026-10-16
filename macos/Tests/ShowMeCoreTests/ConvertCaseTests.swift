import XCTest
@testable import ShowMeCore

final class ConvertCaseTests: XCTestCase {
    func testSplitWords() {
        XCTAssertEqual(CaseConverter.splitWords("XMLHttpRequest2Fast"), ["xml", "http", "request", "2", "fast"])
        XCTAssertEqual(CaseConverter.splitWords("helloWorld"), ["hello", "world"])
        XCTAssertEqual(CaseConverter.splitWords("hello_world-foo.bar baz"), ["hello", "world", "foo", "bar", "baz"])
        XCTAssertEqual(CaseConverter.splitWords("  "), [])
        XCTAssertEqual(CaseConverter.splitWords("getHTTPResponseCode"), ["get", "http", "response", "code"])
        // 与网页版一致：汉字不是小写字母，不会在「户I」之间断开
        XCTAssertEqual(CaseConverter.splitWords("用户ID列表"), ["用户id列表"])
        XCTAssertEqual(CaseConverter.splitWords("用户 ID 列表"), ["用户", "id", "列表"])
        XCTAssertEqual(CaseConverter.splitWords("ÉcoleNormale"), ["école", "normale"])
        XCTAssertEqual(CaseConverter.splitWords("v2Api"), ["v", "2", "api"])
    }

    func testStyles() {
        let expected: [CaseConverter.Style: String] = [
            .camel: "userProfileId", .pascal: "UserProfileId", .snake: "user_profile_id", .constant: "USER_PROFILE_ID",
            .kebab: "user-profile-id", .train: "User-Profile-Id", .dot: "user.profile.id", .path: "user/profile/id",
            .title: "User Profile Id", .sentence: "User profile id", .lower: "user profile id", .upper: "USER PROFILE ID",
        ]
        for (style, value) in expected {
            XCTAssertEqual(CaseConverter.convert("user profile ID", style), value, style.rawValue)
        }
        XCTAssertEqual(CaseConverter.convert("", .camel), "")
        XCTAssertEqual(CaseConverter.convertLines("foo_bar\n\nbaz-qux", .camel), "fooBar\n\nbazQux")
        XCTAssertEqual(CaseConverter.convertLines("foo_bar\r\nbaz", .kebab), "foo-bar\nbaz")
    }

    func testTool() throws {
        let tool = CaseConverterTool.spec
        let r = try tool("user profile id\nXMLHttpRequest\nget_http_response_code", options: ["target": "snake"])
        XCTAssertEqual(r.primary?.id, "snake")
        XCTAssertEqual(r.primary?.value, "user_profile_id\nxml_http_request\nget_http_response_code")
        XCTAssertEqual(r.outputs.count, 12)
        XCTAssertEqual(r.outputs.first { $0.id == "pascal" }?.value, "UserProfileId\nXmlHttpRequest\nGetHttpResponseCode")
        XCTAssertEqual(r.outputs.first { $0.id == "constant" }?.label, "SCREAMING_SNAKE")
        let empty = try tool("---", lang: .en)
        XCTAssertEqual(empty.notes.first?.message, "No words (letters or digits) were found in the input")
        let fallback = try tool("a b", options: ["target": "bogus"])
        XCTAssertEqual(fallback.primary?.value, "aB")
    }

    func testLargeInputIsFast() throws {
        let text = String(repeating: "someVariableName_withMIXEDCase2\n", count: 30_000)
        let started = Date()
        let r = try CaseConverterTool.spec(text)
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
        XCTAssertTrue(r.primary?.value.hasPrefix("someVariableNameWithMixedCase2\n") ?? false)
    }
}
