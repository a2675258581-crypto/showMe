import Foundation

/// 本批工具：curl-converter、http-status、cidr-calculator、regex-tester、text-diff、text-toolkit、markdown-preview
public enum NetworkTextTools {
    public static let all: [ToolSpec] = [
        CurlConverterTool.spec,
        HTTPStatusTool.spec,
        CIDRCalculatorTool.spec,
        TextDiffTool.spec,
        RegexTesterTool.spec,
        MarkdownPreviewTool.spec,
        TextToolkitTool.spec,
    ]
}
