import Foundation

// 由网页版 src/lib/regex-tester-library.ts 生成：常用正则库（表达式与示例原样保留）。

extension RegexTester {
    public static let presets: [RegexPreset] = [
        RegexPreset(
            id: "cn-mobile",
            name: LocalizedText("中国大陆手机号", "Mainland China mobile number"),
            pattern: "^1[3-9]\\d{9}$",
            flags: "gm",
            summary: LocalizedText("11 位，以 1 开头，第二位为 3~9", "11 digits, starting with 1 and a second digit of 3–9"),
            sample: "13800138000\n19912345678\n12345678901\n1380013800\n+8613800138000\n15612345678",
            replacement: nil
        ),
        RegexPreset(
            id: "email",
            name: LocalizedText("邮箱", "Email"),
            pattern: "^[\\w.+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}$",
            flags: "gm",
            summary: LocalizedText("常见邮箱格式（支持 + 别名与多级域名）", "Common email format (with + aliases and multi-level domains)"),
            sample: "alice@example.com\nbob.smith+news@mail.co.uk\nuser_01@sub.domain.cn\nnot-an-email\nmissing@tld\n@example.com\nspace in@example.com",
            replacement: nil
        ),
        RegexPreset(
            id: "cn-id",
            name: LocalizedText("身份证号（18 位）", "Chinese ID number (18 digits)"),
            pattern: "^[1-9]\\d{5}(?<year>18|19|20)\\d{2}(?<month>0[1-9]|1[0-2])(?<day>0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]$",
            flags: "gm",
            summary: LocalizedText("6 位地区码 + 出生日期 + 3 位顺序码 + 校验位（不校验地区码与校验和）", "6-digit region + birth date + 3-digit sequence + check digit (region and checksum not verified)"),
            sample: "11010519491231002X\n440524188001010014\n110105194913310021\n12345678901234567\n010105199001011234",
            replacement: nil
        ),
        RegexPreset(
            id: "url",
            name: LocalizedText("URL 网址", "URL"),
            pattern: "https?:\\/\\/(?:[\\w-]+\\.)+[a-z]{2,}(?::\\d{2,5})?(?:\\/[\\w\\-.~%!$&'()*+,;=:@/]*)?(?:\\?[\\w\\-.~%!$&'()*+,;=:@/?]*)?(?:#[\\w\\-.~%!$&'()*+,;=:@/?]*)?",
            flags: "gi",
            summary: LocalizedText("在文本中查找 http / https 链接（含端口、路径、查询与锚点）", "Find http / https links in text (with port, path, query and fragment)"),
            sample: "官网 https://www.example.com/docs?page=2#intro ，接口 http://api.test.cn:8080/v1/users。\n不是链接：ftp://files.example.com、www.example.com、https://localhost",
            replacement: nil
        ),
        RegexPreset(
            id: "ipv4",
            name: LocalizedText("IPv4 地址", "IPv4 address"),
            pattern: "^(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$",
            flags: "gm",
            summary: LocalizedText("每段 0~255，不允许前导零", "Each part 0–255, no leading zeros"),
            sample: "192.168.1.1\n10.0.0.255\n255.255.255.255\n256.1.1.1\n192.168.01.1\n1.2.3",
            replacement: nil
        ),
        RegexPreset(
            id: "ipv6",
            name: LocalizedText("IPv6 地址", "IPv6 address"),
            pattern: "^(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:|(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,5}(?::[0-9a-f]{1,4}){1,2}|(?:[0-9a-f]{1,4}:){1,4}(?::[0-9a-f]{1,4}){1,3}|(?:[0-9a-f]{1,4}:){1,3}(?::[0-9a-f]{1,4}){1,4}|(?:[0-9a-f]{1,4}:){1,2}(?::[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:(?::[0-9a-f]{1,4}){1,6}|:(?:(?::[0-9a-f]{1,4}){1,7}|:))$",
            flags: "gim",
            summary: LocalizedText("完整与 :: 压缩写法（不含 IPv4 映射与区域 ID）", "Full and :: compressed forms (no IPv4 mapping or zone ID)"),
            sample: "2001:0db8:85a3:0000:0000:8a2e:0370:7334\n2001:db8::1\n::1\n::\nfe80::1ff:fe23:4567:890a\n2001:db8::1::1\n12345::\ngggg::1",
            replacement: nil
        ),
        RegexPreset(
            id: "date",
            name: LocalizedText("日期 yyyy-MM-dd", "Date yyyy-MM-dd"),
            pattern: "^(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])$",
            flags: "gm",
            summary: LocalizedText("年-月-日，月份 01~12、日期 01~31（不校验大小月与闰年）", "Year-month-day, month 01–12, day 01–31 (month lengths and leap years not checked)"),
            sample: "2024-01-31\n2024-12-01\n1999-02-28\n2024-13-01\n2024-1-5\n2024/01/31",
            replacement: nil
        ),
        RegexPreset(
            id: "time",
            name: LocalizedText("时间 HH:mm[:ss]", "Time HH:mm[:ss]"),
            pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$",
            flags: "gm",
            summary: LocalizedText("24 小时制，秒可选", "24-hour clock, seconds optional"),
            sample: "09:30\n23:59:59\n00:00:00\n24:00\n12:60\n7:05",
            replacement: nil
        ),
        RegexPreset(
            id: "chinese",
            name: LocalizedText("中文字符", "Chinese characters"),
            pattern: "\\p{Script=Han}+",
            flags: "gu",
            summary: LocalizedText("连续的汉字（基于 Unicode 属性，包含扩展区汉字）", "Runs of Han characters (Unicode property, including extension blocks)"),
            sample: "Hello 世界！正则表达式 regex 很强大，𠮷野家也能匹配。",
            replacement: nil
        ),
        RegexPreset(
            id: "postcode",
            name: LocalizedText("邮政编码", "Postal code (China)"),
            pattern: "^[1-9]\\d{5}$",
            flags: "gm",
            summary: LocalizedText("中国大陆 6 位邮政编码，首位不为 0", "Mainland China 6-digit postal code, not starting with 0"),
            sample: "100000\n518000\n012345\n10000\n1000000",
            replacement: nil
        ),
        RegexPreset(
            id: "plate",
            name: LocalizedText("车牌号", "License plate (China)"),
            pattern: "^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z](?:[A-HJ-NP-Z0-9]{5}|[DF][A-HJ-NP-Z0-9]\\d{4}|\\d{5}[DF])$",
            flags: "gm",
            summary: LocalizedText("普通车牌（7 位）与新能源车牌（8 位）；字母不含 I、O", "Regular (7 chars) and new-energy (8 chars) plates; letters exclude I and O"),
            sample: "京A12345\n粤B8F9Z1\n沪AD12345\n浙A12345F\n京I12345\n京A1234\nA12345",
            replacement: nil
        ),
        RegexPreset(
            id: "hex-color",
            name: LocalizedText("十六进制颜色", "Hex color"),
            pattern: "#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\\b",
            flags: "gi",
            summary: LocalizedText("#RGB、#RGBA、#RRGGBB、#RRGGBBAA", "#RGB, #RGBA, #RRGGBB, #RRGGBBAA"),
            sample: "color: #fff; background: #1D1D1F; border: #0071e3cc; 无效：#ggg #12345 #1234567",
            replacement: nil
        ),
        RegexPreset(
            id: "strong-password",
            name: LocalizedText("强密码", "Strong password"),
            pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{8,32}$",
            flags: "gm",
            summary: LocalizedText("8~32 位，必须同时包含大写、小写、数字和特殊符号", "8–32 characters with upper case, lower case, a digit and a symbol"),
            sample: "Passw0rd!\nAbcdef1@2024\npassword\nPASSWORD123!\nPass1!\nNoSymbol123",
            replacement: nil
        ),
        RegexPreset(
            id: "qq",
            name: LocalizedText("QQ 号", "QQ number"),
            pattern: "^[1-9]\\d{4,10}$",
            flags: "gm",
            summary: LocalizedText("5~11 位数字，首位不为 0", "5–11 digits, not starting with 0"),
            sample: "10000\n123456789\n01234567\n1234\n123456789012",
            replacement: nil
        ),
        RegexPreset(
            id: "username",
            name: LocalizedText("用户名", "Username"),
            pattern: "^[a-zA-Z][a-zA-Z0-9_]{3,15}$",
            flags: "gm",
            summary: LocalizedText("字母开头，4~16 位字母、数字或下划线", "Starts with a letter; 4–16 letters, digits or underscores"),
            sample: "alice\nuser_2024\nA1b2\n1user\nab\nthis_name_is_way_too_long",
            replacement: nil
        ),
        RegexPreset(
            id: "html-tag",
            name: LocalizedText("HTML 标签", "HTML tag"),
            pattern: "<\\/?(?<tag>[a-z][a-z0-9-]*)\\b[^>]*>",
            flags: "gi",
            summary: LocalizedText("开始或结束标签，分组 tag 为标签名", "Opening or closing tag; the group tag is the tag name"),
            sample: "<div class=\"card\"><p>你好，<b>世界</b></p><img src=\"a.png\" /><my-element></my-element></div>",
            replacement: nil
        ),
        RegexPreset(
            id: "cn-landline",
            name: LocalizedText("固定电话", "Landline (China)"),
            pattern: "^0\\d{2,3}-?\\d{7,8}$",
            flags: "gm",
            summary: LocalizedText("区号 + 号码，如 010-12345678、0755-1234567", "Area code + number, e.g. 010-12345678, 0755-1234567"),
            sample: "010-12345678\n0755-1234567\n02112345678\n123-12345678\n010-123456",
            replacement: nil
        ),
        RegexPreset(
            id: "number",
            name: LocalizedText("数字（整数 / 小数）", "Number (integer / decimal)"),
            pattern: "^-?\\d+(?:\\.\\d+)?$",
            flags: "gm",
            summary: LocalizedText("可带负号与小数部分", "Optional minus sign and fraction"),
            sample: "42\n-3.14\n0.5\n1e10\n.5\n12.",
            replacement: nil
        ),
        RegexPreset(
            id: "domain",
            name: LocalizedText("域名", "Domain name"),
            pattern: "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}$",
            flags: "gim",
            summary: LocalizedText("多级域名，每级 1~63 位，不以 - 开头或结尾", "Multi-level domain; each label 1–63 chars, not starting or ending with -"),
            sample: "example.com\nsub.domain.co.uk\nmy-site.cn\n-bad.com\nlocalhost\nexample..com",
            replacement: nil
        ),
        RegexPreset(
            id: "mac",
            name: LocalizedText("MAC 地址", "MAC address"),
            pattern: "^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$",
            flags: "gim",
            summary: LocalizedText("以 : 或 - 分隔的 6 组十六进制", "Six hex pairs separated by : or -"),
            sample: "00:1A:2B:3C:4D:5E\n00-1a-2b-3c-4d-5e\n001A2B3C4D5E\n00:1A:2B:3C:4D",
            replacement: nil
        ),
        RegexPreset(
            id: "semver",
            name: LocalizedText("语义化版本号", "Semantic version"),
            pattern: "^(?<major>0|[1-9]\\d*)\\.(?<minor>0|[1-9]\\d*)\\.(?<patch>0|[1-9]\\d*)(?:-(?<pre>[\\w.-]+))?(?:\\+(?<build>[\\w.-]+))?$",
            flags: "gm",
            summary: LocalizedText("SemVer：主版本.次版本.修订号，可带预发布与构建元数据", "SemVer major.minor.patch with optional pre-release and build metadata"),
            sample: "1.0.0\n2.10.3-beta.1\n1.0.0-rc.1+build.5\n01.0.0\n1.0\nv1.2.3",
            replacement: nil
        ),
        RegexPreset(
            id: "bank-card",
            name: LocalizedText("银行卡号", "Bank card number"),
            pattern: "^[1-9]\\d{15,18}$",
            flags: "gm",
            summary: LocalizedText("16~19 位数字（不做 Luhn 校验）", "16–19 digits (no Luhn check)"),
            sample: "6222021234567890123\n6228480402564890018\n622202123456789\n0222021234567890",
            replacement: nil
        ),
        RegexPreset(
            id: "duplicate-words",
            name: LocalizedText("重复单词", "Repeated words"),
            pattern: "\\b(\\w+)\\s+\\1\\b",
            flags: "gi",
            summary: LocalizedText("用反向引用找出连着写了两遍的单词", "Uses a backreference to find words written twice in a row"),
            sample: "This is is a test. The the quick brown fox fox jumps. No repeat here.",
            replacement: nil
        ),
        RegexPreset(
            id: "blank-lines",
            name: LocalizedText("空白行", "Blank lines"),
            pattern: "^[ \\t]*$\\n?",
            flags: "gm",
            summary: LocalizedText("只包含空格或制表符的行（替换为空即可删除）", "Lines with only spaces or tabs (replace with nothing to delete them)"),
            sample: "第一行\n\n   \n第二行\n\t\n第三行",
            replacement: ""
        ),
        RegexPreset(
            id: "thousands",
            name: LocalizedText("数字千分位", "Thousands separators"),
            pattern: "\\B(?=(?:\\d{3})+(?!\\d))",
            flags: "g",
            summary: LocalizedText("在每三位数字前插入逗号（零宽断言示例）", "Insert a comma before every three digits (lookahead example)"),
            sample: "1234567\n1000\n987654321.5",
            replacement: ","
        ),
        RegexPreset(
            id: "date-format",
            name: LocalizedText("日期格式转换", "Reformat dates"),
            pattern: "(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})",
            flags: "g",
            summary: LocalizedText("yyyy-MM-dd → dd/MM/yyyy（命名分组替换）", "yyyy-MM-dd → dd/MM/yyyy (named group replacement)"),
            sample: "发布日期：2024-01-31，更新于 2024-12-25。",
            replacement: "$<d>/$<m>/$<y>"
        ),
        RegexPreset(
            id: "camel-to-snake",
            name: LocalizedText("驼峰转下划线", "camelCase to snake_case"),
            pattern: "(?<=[a-z0-9])([A-Z])",
            flags: "g",
            summary: LocalizedText("userName → user_Name（配合小写转换即可得到 snake_case）", "userName → user_Name (lower-case it to get snake_case)"),
            sample: "userName\ngetHttpResponseCode\nisValid2Go",
            replacement: "_$1"
        ),
        RegexPreset(
            id: "trim",
            name: LocalizedText("首尾空白", "Leading / trailing whitespace"),
            pattern: "^[ \\t]+|[ \\t]+$",
            flags: "gm",
            summary: LocalizedText("每行开头和结尾的空格与制表符", "Spaces and tabs at the start and end of each line"),
            sample: "   前面有空格\n后面有空格   \n\t两边都有\t",
            replacement: ""
        ),
    ]
}
