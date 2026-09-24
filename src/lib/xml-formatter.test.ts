import { describe, expect, it } from 'vitest'
import {
  formatXml,
  formatXmlIssue,
  parseXml,
  xmlStats,
  type XmlFormatOptions,
  type XmlIssue,
} from './xml-formatter'

function out(src: string, opts: Partial<XmlFormatOptions> = {}): string {
  const r = formatXml(src, opts)
  if (!r.ok) throw new Error(`应当成功：${formatXmlIssue(r.error)}`)
  return r.output
}

function err(src: string): XmlIssue {
  const r = parseXml(src)
  if (r.ok) throw new Error('应当失败')
  return r.error
}

function warnings(src: string): string[] {
  const r = parseXml(src)
  if (!r.ok) throw new Error(formatXmlIssue(r.error))
  return r.warnings.map((w) => w.message)
}

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Maven 项目配置 -->
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd"><modelVersion>4.0.0</modelVersion>
<groupId>com.example</groupId><artifactId>demo</artifactId><name>示例项目</name>
<properties><java.version>21</java.version><skipTests/></properties>
<dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`

describe('formatXml · 美化', () => {
  it('基本缩进与短文本内联', () => {
    expect(out('<a><b>1</b><c><d>文本</d></c></a>')).toBe(
      '<a>\n  <b>1</b>\n  <c>\n    <d>文本</d>\n  </c>\n</a>',
    )
  })

  it('缩进 4 与 tab', () => {
    expect(out('<a><b/></a>', { indent: 4 })).toBe('<a>\n    <b/>\n</a>')
    expect(out('<a><b/></a>', { indent: 'tab' })).toBe('<a>\n\t<b/>\n</a>')
  })

  it('完整的 Maven POM：声明、注释、命名空间、长属性换行', () => {
    expect(out(POM)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
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
</project>`)
  })

  it('属性换行：never / always', () => {
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0h24v24H0z"/></svg>'
    expect(out(src, { attrWrap: 'never', printWidth: 20 })).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">\n  <path d="M0 0h24v24H0z"/>\n</svg>',
    )
    expect(out('<a x="1" y="2"><b z="3"/></a>', { attrWrap: 'always' })).toBe(
      '<a\n  x="1"\n  y="2"\n>\n  <b z="3"/>\n</a>',
    )
    expect(out('<a><b x="1" y="2"/></a>', { attrWrap: 'always' })).toBe(
      '<a>\n  <b\n    x="1"\n    y="2"\n  />\n</a>',
    )
  })

  it('保留属性原来的引号与实体引用', () => {
    expect(out(`<a  b='x "y"'   c="&amp;&lt;"/>`)).toBe(`<a b='x "y"' c="&amp;&lt;"/>`)
  })

  it('DOCTYPE（含内部子集）、处理指令、CDATA', () => {
    const src =
      '<!DOCTYPE note [<!ENTITY writer "张三"><!ELEMENT note (#PCDATA)>]><?xml-stylesheet href="a.xsl"?><note>&writer;<![CDATA[<b>原样</b> & ]]></note>'
    expect(out(src)).toBe(
      '<!DOCTYPE note [<!ENTITY writer "张三"><!ELEMENT note (#PCDATA)>]>\n<?xml-stylesheet href="a.xsl"?>\n<note>&writer;<![CDATA[<b>原样</b> & ]]></note>',
    )
  })

  it('多行 CDATA 单独成行并原样保留', () => {
    expect(out('<s><![CDATA[a\n  b]]></s>')).toBe('<s>\n  <![CDATA[a\n  b]]>\n</s>')
  })

  it('混合内容：短的整行保留，长的拆开', () => {
    expect(out('<p>Hello <b>world</b>, 你好！</p>')).toBe('<p>Hello <b>world</b>, 你好！</p>')
    const long = `<p>${'很长的文字'.repeat(10)} <b>加粗</b> ${'结尾'.repeat(10)}</p>`
    expect(out(long, { printWidth: 40 })).toBe(
      `<p>\n  ${'很长的文字'.repeat(10)}\n  <b>加粗</b>\n  ${'结尾'.repeat(10)}\n</p>`,
    )
  })

  it('多行文本折叠或按行缩进', () => {
    expect(out('<a>\n    第一行\n    第二行\n</a>')).toBe('<a>第一行 第二行</a>')
    expect(out('<a>\n    第一行\n    第二行\n</a>', { printWidth: 8 })).toBe(
      '<a>\n  第一行\n  第二行\n</a>',
    )
  })

  it('xml:space="preserve" 的内容原样保留', () => {
    const src = '<r><pre xml:space="preserve">  a\n    b  </pre><c>  x  </c></r>'
    expect(out(src)).toBe('<r>\n  <pre xml:space="preserve">  a\n    b  </pre>\n  <c>x</c>\n</r>')
  })

  it('自闭合空元素开关', () => {
    expect(out('<a><b></b><c/></a>', { selfClose: true })).toBe('<a>\n  <b/>\n  <c/>\n</a>')
    expect(out('<a><b></b><c/></a>', { selfClose: false })).toBe('<a>\n  <b></b>\n  <c/>\n</a>')
    expect(out('<a><b>  </b></a>', { selfClose: true })).toBe('<a>\n  <b/>\n</a>')
  })

  it('保留注释开关', () => {
    expect(out('<a><!-- 注释 --><b/></a>', { keepComments: true })).toBe(
      '<a>\n  <!-- 注释 -->\n  <b/>\n</a>',
    )
    expect(out('<a><!-- 注释 --><b/></a>', { keepComments: false })).toBe('<a>\n  <b/>\n</a>')
    // 文本旁的单行注释随文本内联，不在 "x" 和注释之间凭空插入空白
    expect(out('<a>x<!-- c --></a>')).toBe('<a>x<!-- c --></a>')
    expect(out('<a>x<!-- c -->y</a>', { keepComments: false })).toBe('<a>xy</a>')
    // 多行注释不能内联
    expect(out('<a>x<!-- 1\n2 --></a>')).toBe('<a>\n  x\n  <!-- 1\n2 -->\n</a>')
  })

  it('混合内容中元素之间的空格不会丢（回归）', () => {
    expect(out('<p>Hello <b>a</b> <i>b</i></p>')).toBe('<p>Hello <b>a</b> <i>b</i></p>')
    expect(out('<p>Hello <b>a</b>\n  <i>b</i>!</p>')).toBe('<p>Hello <b>a</b> <i>b</i>!</p>')
    expect(out('<p>Hello <b>a</b> <i>b</i></p>', { minify: true })).toBe(
      '<p>Hello <b>a</b> <i>b</i></p>',
    )
    // 纯元素内容里的空白仍视为排版空白
    expect(out('<a> <b>1</b> <c>2</c> </a>', { minify: true })).toBe('<a><b>1</b><c>2</c></a>')
    // 格式化结果依然幂等
    const once = out('<doc><p>中文 <em>强调</em> <code>x</code> 结尾</p></doc>')
    expect(once).toBe('<doc>\n  <p>中文 <em>强调</em> <code>x</code> 结尾</p>\n</doc>')
    expect(out(once)).toBe(once)
  })

  it('统一 \\r\\n 换行', () => {
    expect(out('<a>\r\n  <b>1</b>\r\n</a>')).toBe('<a>\n  <b>1</b>\n</a>')
  })

  it('跳过 BOM', () => {
    expect(out('\ufeff<?xml version="1.0"?><a/>')).toBe('<?xml version="1.0"?>\n<a/>')
  })

  it('格式化结果是幂等的，且可以再次解析', () => {
    const once = out(POM)
    expect(out(once)).toBe(once)
    expect(out(out(POM, { minify: true }))).toBe(once)
  })

  it('大文档也能快速处理', () => {
    const items = Array.from(
      { length: 5000 },
      (_, i) => `<item id="${i}"><name>商品${i}</name><price>9.9</price></item>`,
    ).join('')
    const t = performance.now()
    const r = formatXml(`<list>${items}</list>`)
    expect(performance.now() - t).toBeLessThan(3000)
    expect(r.ok && r.stats.elements).toBe(15001)
  })
})

describe('formatXml · 压缩', () => {
  it('去掉缩进空白、保留有意义的空格', () => {
    expect(out('<a>\n  <b> x </b>\n  <p>Hello <i>w</i> !</p>\n</a>', { minify: true })).toBe(
      '<a><b>x</b><p>Hello <i>w</i> !</p></a>',
    )
  })

  it('压缩时的注释与自闭合', () => {
    expect(out('<a>\n  <!-- c -->\n  <b></b>\n</a>', { minify: true, keepComments: false })).toBe(
      '<a><b/></a>',
    )
    expect(out('<a>\n  <!-- c -->\n  <b></b>\n</a>', { minify: true, selfClose: false })).toBe(
      '<a><!-- c --><b></b></a>',
    )
  })

  it('xml:space="preserve" 在压缩时也保留', () => {
    expect(out('<a>\n  <b xml:space="preserve">\n  x\n  </b>\n</a>', { minify: true })).toBe(
      '<a><b xml:space="preserve">\n  x\n  </b></a>',
    )
  })

  it('声明与多行文本', () => {
    expect(out('<?xml version="1.0"?>\n<a>\n  第一行\n  第二行\n</a>', { minify: true })).toBe(
      '<?xml version="1.0"?><a>第一行 第二行</a>',
    )
  })
})

describe('parseXml · 错误与行列号', () => {
  it('嵌套过深时报错而不是爆栈（回归）', () => {
    const deep = '<a>'.repeat(20000) + '</a>'.repeat(20000)
    const r = formatXml(deep)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.message).toContain('嵌套层级过深')
    expect(r.error).toMatchObject({ line: 1, column: 3001 })
    // 上限以内正常处理
    const ok = formatXml('<a>'.repeat(1000) + '</a>'.repeat(1000))
    expect(ok.ok && ok.stats.maxDepth).toBe(1000)
    expect(formatXml('<a>'.repeat(1000) + '</a>'.repeat(1000), { minify: true }).ok).toBe(true)
  })

  it('文本中的 "]]>"（回归）', () => {
    const e = err('<a>\n  x ]]> y\n</a>')
    expect(e).toMatchObject({ line: 2, column: 5 })
    expect(e.message).toContain(']]>')
    expect(parseXml('<a b="]]>">]]&gt;<![CDATA[x]]></a>').ok).toBe(true)
  })

  it('未闭合的标签', () => {
    const e = err('<a>\n  <b>\n</a>')
    expect(e).toMatchObject({ line: 3, column: 1 })
    expect(e.message).toContain('<b>（第 2 行第 3 列）没有闭合')
  })

  it('文档结束时仍未闭合', () => {
    const e = err('<root>\n  <child>文本</child>')
    expect(e).toMatchObject({ line: 1, column: 1 })
    expect(e.message).toBe('标签 <root> 没有闭合')
  })

  it('闭合标签不匹配', () => {
    const e = err('<a>\n  <b></c>\n</a>')
    expect(e).toMatchObject({ line: 2, column: 6 })
    expect(e.message).toContain('</c> 与开始标签 <b>')
    expect(e.hint).toBe('应为 </b>')
  })

  it('多余的闭合标签', () => {
    expect(err('<a/></a>').message).toContain('多余的闭合标签 </a>')
  })

  it('属性错误', () => {
    expect(err('<a b=1/>')).toMatchObject({ line: 1, column: 6, hint: '例如 b="1"' })
    expect(err('<a b></a>').message).toContain('缺少 "=" 和属性值')
    expect(err('<a b="1" b="2"/>').message).toBe('属性 b 重复')
    expect(err('<a b="1"c="2"/>').message).toContain('前面缺少空格')
    expect(err('<a b="x/>').message).toContain('缺少结束引号')
    expect(err('<a b="x<y"/>').message).toContain('出现了 "<"')
    expect(err('<a "x"/>').message).toContain('缺少属性名')
    expect(err('<a b="&x"/>').message).toContain('未转义的 "&"')
  })

  it('标签语法错误', () => {
    expect(err('<a').message).toContain('缺少 ">"')
    expect(err('<a <b/>').message).toContain('缺少 ">"')
    expect(err('<a/ >').message).toContain('"/" 后面应紧跟 ">"')
    expect(err('<a>1 < 2</a>')).toMatchObject({ line: 1, column: 6 })
    expect(err('<a>1 < 2</a>').hint).toContain('&lt;')
    expect(err('<1a/>').message).toContain('意外的 "<"')
    expect(err('<a></ >').message).toContain('缺少标签名')
    expect(err('<a></a').message).toContain('缺少 ">"')
  })

  it('文本中的 & 必须转义', () => {
    const e = err('<a>\n  AT&T\n</a>')
    expect(e).toMatchObject({ line: 2, column: 5 })
    expect(e.hint).toContain('&amp;')
    expect(parseXml('<a>&amp; &#169; &#x4E2D; &自定义;</a>').ok).toBe(true)
  })

  it('注释 / CDATA / PI / DOCTYPE 未结束', () => {
    expect(err('<a><!-- x</a>').message).toContain('缺少 "-->"')
    expect(err('<a><![CDATA[ x</a>').message).toContain('缺少 "]]>"')
    expect(err('<?xml version="1.0"<a/>').message).toContain('缺少 "?>"')
    expect(err('<!DOCTYPE a [ <!ENTITY x "1"> <a/>').message).toContain('DOCTYPE 没有结束')
    expect(err('<!ELEMENT a>').message).toContain('无法识别的声明')
  })

  it('XML 声明的位置与写法', () => {
    expect(err('<a/><?xml version="1.0"?>').message).toContain('只能出现在文档最开头')
    expect(err('<?XML version="1.0"?><a/>').message).toContain('必须小写')
    expect(err('<?xml encoding="UTF-8"?><a/>').message).toContain('缺少 version')
    expect(warnings('\n<?xml version="1.0"?><a/>')).toEqual(['XML 声明前面有空白'])
  })

  it('CDATA 只能在元素内部，DOCTYPE 只能在根元素之前', () => {
    expect(err('<![CDATA[x]]><a/>').message).toContain('只能出现在元素内部')
    expect(err('<a/><!DOCTYPE a>').message).toContain('之前')
    expect(err('<!DOCTYPE a><!DOCTYPE a><a/>').message).toContain('只能有一个')
  })

  it('没有元素', () => {
    expect(err('  hello')).toMatchObject({ line: 1, column: 3, message: '没有找到任何 XML 元素' })
    expect(err('<!-- 只有注释 -->').message).toBe('没有找到任何 XML 元素')
  })

  it('列号按码点计算', () => {
    expect(err('<名字>😀</名>')).toMatchObject({ line: 1, column: 6 })
  })
})

describe('parseXml · 警告', () => {
  it('多个根元素按片段处理', () => {
    expect(warnings('<a/><b/>')).toEqual(['发现多个根元素 <b>'])
    expect(out('<a/><b/>')).toBe('<a/>\n<b/>')
  })

  it('根元素之外的文本', () => {
    expect(warnings('<a/>尾巴')).toEqual(['根元素之外存在文本内容'])
  })

  it('未声明的命名空间前缀（每个前缀只提示一次）', () => {
    expect(warnings('<soap:Envelope><soap:Body x:y="1"/></soap:Envelope>')).toEqual([
      '命名空间前缀 "soap" 未声明',
      '命名空间前缀 "x" 未声明',
    ])
    expect(
      warnings(
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body xml:lang="zh"/></soap:Envelope>',
      ),
    ).toEqual([])
  })

  it('声明的作用域只在元素内部', () => {
    expect(warnings('<r><a xmlns:p="u"><p:x/></a><p:y/></r>')).toEqual(['命名空间前缀 "p" 未声明'])
  })

  it('注释里的 --', () => {
    expect(warnings('<a><!-- a -- b --></a>')).toEqual(['注释内容中不应出现 "--"'])
  })
})

describe('xmlStats', () => {
  it('统计元素、属性、深度', () => {
    const r = parseXml(POM)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(xmlStats(r.doc)).toEqual({
      elements: 12,
      attributes: 3,
      maxDepth: 4,
      comments: 1,
      cdata: 0,
    })
  })
})

describe('示例数据', () => {
  it('所有示例都能无警告地格式化，且压缩后再格式化结果一致', async () => {
    const { XML_SAMPLES } = await import('./xml-formatter-samples')
    for (const s of Object.values(XML_SAMPLES)) {
      const r = formatXml(s.text)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.warnings).toEqual([])
      expect(out(out(s.text, { minify: true }))).toBe(r.output)
    }
  })
})

describe('幂等性（确定性随机用例）', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
  const LEAVES = [
    'text',
    ' 空格 ',
    '\n  ',
    'x &amp; y',
    '<![CDATA[ <x> ]]>',
    '<!-- c -->',
    '<?pi data?>',
  ]
  const gen = (d: number): string => {
    const t = pick(['a', 'b', 'ns:c', '中'])
    const kids =
      d > 3
        ? []
        : Array.from({ length: Math.floor(rnd() * 4) }, () =>
            rnd() < 0.4 ? pick(LEAVES) : gen(d + 1),
          )
    const attrs = rnd() < 0.5 ? ` id="${Math.floor(rnd() * 9)}" name='v'` : ''
    return kids.length ? `<${t}${attrs}>${kids.join('')}</${t}>` : `<${t}${attrs}/>`
  }

  it('格式化 / 压缩的结果再处理一次保持不变', () => {
    const variants: Partial<XmlFormatOptions>[] = [
      {},
      { indent: 4 },
      { attrWrap: 'always' },
      { selfClose: false },
      { keepComments: false },
    ]
    for (let k = 0; k < 1500; k++) {
      const src = `<root xmlns:ns="urn:x">${gen(0)}</root>`
      const o = pick(variants)
      const once = out(src, o)
      expect(out(once, o)).toBe(once)
      const min = out(src, { ...o, minify: true })
      expect(out(min, { ...o, minify: true })).toBe(min)
    }
  })
})
