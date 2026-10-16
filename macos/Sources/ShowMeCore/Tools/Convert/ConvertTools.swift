import Foundation

/// 本批工具：timestamp、base-converter、color-converter、case-converter、cron-parser、uuid-generator、password-generator、mock-data
public enum ConvertTools {
    public static let all: [ToolSpec] = [
        TimestampTool.spec,
        BaseConverterTool.spec,
        ColorConverterTool.spec,
        CaseConverterTool.spec,
        CronParserTool.spec,
        UUIDGeneratorTool.spec,
        PasswordGeneratorTool.spec,
        MockDataTool.spec,
    ]
}
