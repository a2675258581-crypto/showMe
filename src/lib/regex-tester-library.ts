/** 常用正则库：点击即可载入表达式、标志与示例文本 */

export interface RegexPreset {
  id: string
  name: string
  /** 分类，用于筛选 */
  group: '常用' | '网络' | '证件与号码' | '日期时间' | '文本' | '替换'
  pattern: string
  flags: string
  desc: string
  sample: string
  /** 替换示例：载入后自动切到替换模式 */
  replacement?: string
}

const H16 = '[0-9a-f]{1,4}'
const IPV6 = [
  `(?:${H16}:){7}${H16}`,
  `(?:${H16}:){1,7}:`,
  `(?:${H16}:){1,6}:${H16}`,
  `(?:${H16}:){1,5}(?::${H16}){1,2}`,
  `(?:${H16}:){1,4}(?::${H16}){1,3}`,
  `(?:${H16}:){1,3}(?::${H16}){1,4}`,
  `(?:${H16}:){1,2}(?::${H16}){1,5}`,
  `${H16}:(?::${H16}){1,6}`,
  `:(?:(?::${H16}){1,7}|:)`,
].join('|')

export const REGEX_PRESETS: RegexPreset[] = [
  {
    id: 'cn-mobile',
    name: '中国大陆手机号',
    group: '证件与号码',
    pattern: '^1[3-9]\\d{9}$',
    flags: 'gm',
    desc: '11 位，以 1 开头，第二位为 3~9',
    sample: '13800138000\n19912345678\n12345678901\n1380013800\n+8613800138000\n15612345678',
  },
  {
    id: 'email',
    name: '邮箱',
    group: '常用',
    pattern: '^[\\w.+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}$',
    flags: 'gm',
    desc: '常见邮箱格式（支持 + 别名与多级域名）',
    sample:
      'alice@example.com\nbob.smith+news@mail.co.uk\nuser_01@sub.domain.cn\nnot-an-email\nmissing@tld\n@example.com\nspace in@example.com',
  },
  {
    id: 'cn-id',
    name: '身份证号（18 位）',
    group: '证件与号码',
    pattern:
      '^[1-9]\\d{5}(?<year>18|19|20)\\d{2}(?<month>0[1-9]|1[0-2])(?<day>0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]$',
    flags: 'gm',
    desc: '6 位地区码 + 出生日期 + 3 位顺序码 + 校验位（不校验地区码与校验和）',
    sample:
      '11010519491231002X\n440524188001010014\n110105194913310021\n12345678901234567\n010105199001011234',
  },
  {
    id: 'url',
    name: 'URL 网址',
    group: '网络',
    pattern:
      "https?:\\/\\/(?:[\\w-]+\\.)+[a-z]{2,}(?::\\d{2,5})?(?:\\/[\\w\\-.~%!$&'()*+,;=:@/]*)?(?:\\?[\\w\\-.~%!$&'()*+,;=:@/?]*)?(?:#[\\w\\-.~%!$&'()*+,;=:@/?]*)?",
    flags: 'gi',
    desc: '在文本中查找 http / https 链接（含端口、路径、查询与锚点）',
    sample:
      '官网 https://www.example.com/docs?page=2#intro ，接口 http://api.test.cn:8080/v1/users。\n不是链接：ftp://files.example.com、www.example.com、https://localhost',
  },
  {
    id: 'ipv4',
    name: 'IPv4 地址',
    group: '网络',
    pattern:
      '^(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$',
    flags: 'gm',
    desc: '每段 0~255，不允许前导零',
    sample: '192.168.1.1\n10.0.0.255\n255.255.255.255\n256.1.1.1\n192.168.01.1\n1.2.3',
  },
  {
    id: 'ipv6',
    name: 'IPv6 地址',
    group: '网络',
    pattern: `^(?:${IPV6})$`,
    flags: 'gim',
    desc: '完整与 :: 压缩写法（不含 IPv4 映射与区域 ID）',
    sample:
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334\n2001:db8::1\n::1\n::\nfe80::1ff:fe23:4567:890a\n2001:db8::1::1\n12345::\ngggg::1',
  },
  {
    id: 'date',
    name: '日期 yyyy-MM-dd',
    group: '日期时间',
    pattern: '^(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])$',
    flags: 'gm',
    desc: '年-月-日，月份 01~12、日期 01~31（不校验大小月与闰年）',
    sample: '2024-01-31\n2024-12-01\n1999-02-28\n2024-13-01\n2024-1-5\n2024/01/31',
  },
  {
    id: 'time',
    name: '时间 HH:mm[:ss]',
    group: '日期时间',
    pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$',
    flags: 'gm',
    desc: '24 小时制，秒可选',
    sample: '09:30\n23:59:59\n00:00:00\n24:00\n12:60\n7:05',
  },
  {
    id: 'chinese',
    name: '中文字符',
    group: '文本',
    pattern: '\\p{Script=Han}+',
    flags: 'gu',
    desc: '连续的汉字（基于 Unicode 属性，包含扩展区汉字）',
    sample: 'Hello 世界！正则表达式 regex 很强大，𠮷野家也能匹配。',
  },
  {
    id: 'postcode',
    name: '邮政编码',
    group: '证件与号码',
    pattern: '^[1-9]\\d{5}$',
    flags: 'gm',
    desc: '中国大陆 6 位邮政编码，首位不为 0',
    sample: '100000\n518000\n012345\n10000\n1000000',
  },
  {
    id: 'plate',
    name: '车牌号',
    group: '证件与号码',
    pattern:
      '^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z](?:[A-HJ-NP-Z0-9]{5}|[DF][A-HJ-NP-Z0-9]\\d{4}|\\d{5}[DF])$',
    flags: 'gm',
    desc: '普通车牌（7 位）与新能源车牌（8 位）；字母不含 I、O',
    sample: '京A12345\n粤B8F9Z1\n沪AD12345\n浙A12345F\n京I12345\n京A1234\nA12345',
  },
  {
    id: 'hex-color',
    name: '十六进制颜色',
    group: '常用',
    pattern: '#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\\b',
    flags: 'gi',
    desc: '#RGB、#RGBA、#RRGGBB、#RRGGBBAA',
    sample: 'color: #fff; background: #1D1D1F; border: #0071e3cc; 无效：#ggg #12345 #1234567',
  },
  {
    id: 'strong-password',
    name: '强密码',
    group: '常用',
    pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{8,32}$',
    flags: 'gm',
    desc: '8~32 位，必须同时包含大写、小写、数字和特殊符号',
    sample: 'Passw0rd!\nAbcdef1@2024\npassword\nPASSWORD123!\nPass1!\nNoSymbol123',
  },
  {
    id: 'qq',
    name: 'QQ 号',
    group: '证件与号码',
    pattern: '^[1-9]\\d{4,10}$',
    flags: 'gm',
    desc: '5~11 位数字，首位不为 0',
    sample: '10000\n123456789\n01234567\n1234\n123456789012',
  },
  {
    id: 'username',
    name: '用户名',
    group: '常用',
    pattern: '^[a-zA-Z][a-zA-Z0-9_]{3,15}$',
    flags: 'gm',
    desc: '字母开头，4~16 位字母、数字或下划线',
    sample: 'alice\nuser_2024\nA1b2\n1user\nab\nthis_name_is_way_too_long',
  },
  {
    id: 'html-tag',
    name: 'HTML 标签',
    group: '文本',
    pattern: '<\\/?(?<tag>[a-z][a-z0-9-]*)\\b[^>]*>',
    flags: 'gi',
    desc: '开始或结束标签，分组 tag 为标签名',
    sample:
      '<div class="card"><p>你好，<b>世界</b></p><img src="a.png" /><my-element></my-element></div>',
  },
  {
    id: 'cn-landline',
    name: '固定电话',
    group: '证件与号码',
    pattern: '^0\\d{2,3}-?\\d{7,8}$',
    flags: 'gm',
    desc: '区号 + 号码，如 010-12345678、0755-1234567',
    sample: '010-12345678\n0755-1234567\n02112345678\n123-12345678\n010-123456',
  },
  {
    id: 'number',
    name: '数字（整数 / 小数）',
    group: '常用',
    pattern: '^-?\\d+(?:\\.\\d+)?$',
    flags: 'gm',
    desc: '可带负号与小数部分',
    sample: '42\n-3.14\n0.5\n1e10\n.5\n12.',
  },
  {
    id: 'domain',
    name: '域名',
    group: '网络',
    pattern: '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}$',
    flags: 'gim',
    desc: '多级域名，每级 1~63 位，不以 - 开头或结尾',
    sample: 'example.com\nsub.domain.co.uk\nmy-site.cn\n-bad.com\nlocalhost\nexample..com',
  },
  {
    id: 'mac',
    name: 'MAC 地址',
    group: '网络',
    pattern: '^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$',
    flags: 'gim',
    desc: '以 : 或 - 分隔的 6 组十六进制',
    sample: '00:1A:2B:3C:4D:5E\n00-1a-2b-3c-4d-5e\n001A2B3C4D5E\n00:1A:2B:3C:4D',
  },
  {
    id: 'semver',
    name: '语义化版本号',
    group: '文本',
    pattern:
      '^(?<major>0|[1-9]\\d*)\\.(?<minor>0|[1-9]\\d*)\\.(?<patch>0|[1-9]\\d*)(?:-(?<pre>[\\w.-]+))?(?:\\+(?<build>[\\w.-]+))?$',
    flags: 'gm',
    desc: 'SemVer：主版本.次版本.修订号，可带预发布与构建元数据',
    sample: '1.0.0\n2.10.3-beta.1\n1.0.0-rc.1+build.5\n01.0.0\n1.0\nv1.2.3',
  },
  {
    id: 'bank-card',
    name: '银行卡号',
    group: '证件与号码',
    pattern: '^[1-9]\\d{15,18}$',
    flags: 'gm',
    desc: '16~19 位数字（不做 Luhn 校验）',
    sample: '6222021234567890123\n6228480402564890018\n622202123456789\n0222021234567890',
  },
  {
    id: 'duplicate-words',
    name: '重复单词',
    group: '文本',
    pattern: '\\b(\\w+)\\s+\\1\\b',
    flags: 'gi',
    desc: '用反向引用找出连着写了两遍的单词',
    sample: 'This is is a test. The the quick brown fox fox jumps. No repeat here.',
  },
  {
    id: 'blank-lines',
    name: '空白行',
    group: '文本',
    pattern: '^[ \\t]*$\\n?',
    flags: 'gm',
    desc: '只包含空格或制表符的行（替换为空即可删除）',
    sample: '第一行\n\n   \n第二行\n\t\n第三行',
    replacement: '',
  },
  {
    id: 'thousands',
    name: '数字千分位',
    group: '替换',
    pattern: '\\B(?=(?:\\d{3})+(?!\\d))',
    flags: 'g',
    desc: '在每三位数字前插入逗号（零宽断言示例）',
    sample: '1234567\n1000\n987654321.5',
    replacement: ',',
  },
  {
    id: 'date-format',
    name: '日期格式转换',
    group: '替换',
    pattern: '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})',
    flags: 'g',
    desc: 'yyyy-MM-dd → dd/MM/yyyy（命名分组替换）',
    sample: '发布日期：2024-01-31，更新于 2024-12-25。',
    replacement: '$<d>/$<m>/$<y>',
  },
  {
    id: 'camel-to-snake',
    name: '驼峰转下划线',
    group: '替换',
    pattern: '(?<=[a-z0-9])([A-Z])',
    flags: 'g',
    desc: 'userName → user_Name（配合小写转换即可得到 snake_case）',
    sample: 'userName\ngetHttpResponseCode\nisValid2Go',
    replacement: '_$1',
  },
  {
    id: 'trim',
    name: '首尾空白',
    group: '替换',
    pattern: '^[ \\t]+|[ \\t]+$',
    flags: 'gm',
    desc: '每行开头和结尾的空格与制表符',
    sample: '   前面有空格\n后面有空格   \n\t两边都有\t',
    replacement: '',
  },
]
