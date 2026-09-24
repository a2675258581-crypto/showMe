import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SQL_OPTIONS,
  SQL_DIALECTS,
  applyOperatorKeywordCase,
  describeSqlError,
  findDelimiterCommands,
  formatSql,
  minifySql,
  tokenizeSql,
  type SqlOptions,
  type SqlResult,
} from './sql-formatter'
import { SQL_SAMPLE } from './sql-formatter-samples'

const o = (x: Partial<SqlOptions> = {}): SqlOptions => ({ ...DEFAULT_SQL_OPTIONS, ...x })
const ok = (r: SqlResult) => {
  if (!r.ok) throw new Error(r.error.message)
  return r
}
const min = (sql: string, d: SqlOptions['dialect'] = 'sql') => minifySql(sql, d).output

describe('tokenizeSql', () => {
  it('round-trips the source exactly', () => {
    for (const { value } of SQL_DIALECTS) {
      expect(
        tokenizeSql(SQL_SAMPLE, value)
          .map((t) => t.text)
          .join(''),
      ).toBe(SQL_SAMPLE)
    }
  })

  it('recognises strings, identifiers and comments', () => {
    const types = tokenizeSql(`SELECT 'a''b', "c", \`d\` -- x\n/* y */`, 'mysql')
      .filter((t) => t.type !== 'ws')
      .map((t) => `${t.type}:${t.text}`)
    expect(types).toEqual([
      'word:SELECT',
      "string:'a''b'",
      'punct:,',
      'ident:"c"',
      'punct:,',
      'ident:`d`',
      'comment:-- x',
      'comment:/* y */',
    ])
  })
})

describe('minifySql', () => {
  it('removes comments and collapses whitespace', () => {
    expect(
      min(`-- 头部注释
SELECT  a ,  b   -- 行尾注释
FROM   t   /* 块注释 */
WHERE  x = 1 ;`),
    ).toBe('SELECT a,b FROM t WHERE x = 1;')
  })

  it('never touches string literals or quoted identifiers', () => {
    const sql = `SELECT '  -- not a comment  ', "col  /* x */", 'it''s', 'a\n  b' FROM t`
    expect(min(sql)).toBe(`SELECT '  -- not a comment  ',"col  /* x */",'it''s','a\n  b' FROM t`)
  })

  it('handles backslash escapes per dialect', () => {
    // MySQL: \' 是转义，后面的 -- 在字符串里
    expect(min(`SELECT 'a\\' -- still string', 1 -- c`, 'mysql')).toBe(
      `SELECT 'a\\' -- still string',1`,
    )
    // PostgreSQL：标准字符串里的反斜杠是普通字符
    expect(min(`SELECT 'C:\\' -- comment\n, 2`, 'postgresql')).toBe(`SELECT 'C:\\',2`)
    // PostgreSQL 的 E'' 支持反斜杠转义
    expect(min(`SELECT E'a\\'b -- x' -- c`, 'postgresql')).toBe(`SELECT E'a\\'b -- x'`)
  })

  it('follows the MySQL rule that -- needs trailing whitespace', () => {
    expect(min('SELECT 1--1', 'mysql')).toBe('SELECT 1--1')
    expect(min('SELECT 1 -- 1\n+ 2', 'mysql')).toBe('SELECT 1 + 2')
    expect(min('SELECT 1 # comment\n, 2', 'mysql')).toBe('SELECT 1,2')
    // PostgreSQL 里 # 是运算符
    expect(min('SELECT 5 # 3', 'postgresql')).toBe('SELECT 5 # 3')
  })

  it('keeps optimizer hints and MySQL executable comments', () => {
    expect(min('SELECT /*+ INDEX(t idx_a) */ a FROM t /* drop me */', 'mysql')).toBe(
      'SELECT /*+ INDEX(t idx_a) */ a FROM t',
    )
    expect(min('/*!40101 SET NAMES utf8mb4 */;', 'mysql')).toBe('/*!40101 SET NAMES utf8mb4 */;')
  })

  it('keeps dollar-quoted bodies intact', () => {
    const body = `$fn$\nBEGIN\n  -- 注释要保留\n  RETURN 1;\nEND;\n$fn$`
    expect(min(`CREATE FUNCTION f() RETURNS int AS ${body} LANGUAGE plpgsql;`, 'postgresql')).toBe(
      `CREATE FUNCTION f() RETURNS int AS ${body} LANGUAGE plpgsql;`,
    )
    // $1 是参数，不是美元符引用
    expect(min('SELECT *\nFROM t WHERE id = $1', 'postgresql')).toBe(
      'SELECT * FROM t WHERE id = $1',
    )
  })

  it('supports nested block comments where the dialect does', () => {
    expect(min('SELECT /* a /* b */ c */ 1', 'postgresql')).toBe('SELECT 1')
    expect(min('SELECT /* a /* b */ 1', 'mysql')).toBe('SELECT 1')
  })

  it('handles bracket identifiers, Oracle q-quotes, BigQuery triple quotes and Snowflake //', () => {
    expect(min('SELECT [my -- col]  FROM t', 'transactsql')).toBe('SELECT [my -- col] FROM t')
    expect(min("SELECT q'[it's -- ok]' FROM dual -- c", 'plsql')).toBe(
      "SELECT q'[it's -- ok]' FROM dual",
    )
    expect(min("SELECT '''a\n-- b''' # c", 'bigquery')).toBe("SELECT '''a\n-- b'''")
    expect(min('SELECT 1 // c\n, 2', 'snowflake')).toBe('SELECT 1,2')
  })

  it('keeps MyBatis placeholders even in dialects with # comments', () => {
    expect(min('SELECT * FROM t WHERE id = #{id}\n  AND name = ${name}', 'mysql')).toBe(
      'SELECT * FROM t WHERE id = #{id} AND name = ${name}',
    )
  })

  it('does not glue tokens together when removing comments', () => {
    expect(min('SELECT a/**/FROM t')).toBe('SELECT a FROM t')
    expect(min('SELECT 1 -/* x */-1', 'mysql')).toBe('SELECT 1 - -1')
  })

  it('keeps client commands on their own lines', () => {
    expect(min('SELECT 1\nGO\nSELECT 2\nGO 5\n', 'transactsql')).toBe(
      'SELECT 1\nGO\nSELECT 2\nGO 5',
    )
    expect(min('BEGIN\n  NULL;\nEND;\n/\nSELECT 1 FROM dual', 'plsql')).toBe(
      'BEGIN NULL;END;\n/\nSELECT 1 FROM dual',
    )
    expect(
      min('DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;', 'mysql'),
    ).toBe('DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1;END$$\nDELIMITER ;')
  })

  it('warns about unterminated strings and keeps the rest', () => {
    const r = minifySql("SELECT 'abc -- x\n  FROM t", 'mysql')
    expect(r.output).toBe("SELECT 'abc -- x\n  FROM t")
    expect(r.warnings[0]).toContain('第 1 行第 8 列的字符串没有闭合')
    const c = minifySql('SELECT 1 /* never closed', 'mysql')
    expect(c.output).toBe('SELECT 1 /* never closed')
    expect(c.warnings[0]).toContain('块注释')
  })

  it('handles 中文 / emoji and full-width spaces', () => {
    expect(min('SELECT 名字\u3000AS "😀 别名"  FROM 用户表 -- 注释')).toBe(
      'SELECT 名字 AS "😀 别名" FROM 用户表',
    )
  })

  it('minifies the sample to a single line', () => {
    const r = minifySql(SQL_SAMPLE, 'mysql')
    expect(r.output.includes('\n')).toBe(false)
    expect(r.output).toContain("'%测试 -- 请忽略%'")
    expect(r.output).not.toContain('排除已注销用户')
    expect(r.commentsRemoved).toBe(2)
  })

  it('handles empty and large input', () => {
    expect(min('')).toBe('')
    expect(min('  -- only comment\n')).toBe('')
    const big = Array.from({ length: 5000 }, (_, i) => `-- c${i}\nSELECT ${i} AS "列${i}"`).join(
      ';\n',
    )
    const out = min(big, 'mysql')
    expect(out.split(';').length).toBe(5000)
    expect(out).not.toContain('--')
  })
})

describe('formatSql', () => {
  it('returns empty output for blank input', () => {
    expect(ok(formatSql('   \n'))).toEqual({ ok: true, output: '', warnings: [] })
  })

  it('formats with keyword case and indentation', () => {
    expect(ok(formatSql('select a, b from t where x = 1')).output).toBe(
      'SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1',
    )
    expect(ok(formatSql('SELECT a FROM t', o({ keywordCase: 'lower', indent: '4' }))).output).toBe(
      'select\n    a\nfrom\n    t',
    )
    expect(ok(formatSql('select a from t', o({ indent: 'tab' }))).output).toBe(
      'SELECT\n\ta\nFROM\n\tt',
    )
  })

  it('applies function and data type case', () => {
    const out = ok(
      formatSql(
        'select Count(*), cast(a as varchar(10)) from t',
        o({ functionCase: 'upper', dataTypeCase: 'lower' }),
      ),
    ).output
    expect(out).toContain('COUNT(*)')
    expect(out).toContain('CAST(a AS varchar(10))')
  })

  it('upper-cases IS / NULL / LIKE even in MySQL', () => {
    const out = ok(formatSql("select a from t where b is not null and c like 'x%'")).output
    expect(out).toContain('b IS NOT NULL')
    expect(out).toContain("c LIKE 'x%'")
    expect(
      applyOperatorKeywordCase("a.like, 'is null' -- is null\nb is null", 'mysql', 'upper'),
    ).toBe("a.like, 'is null' -- is null\nb IS NULL")
  })

  it('supports dense operators and lines between queries', () => {
    const out = ok(
      formatSql(
        'select a+1 from t where b = 2; select 1',
        o({ denseOperators: true, linesBetweenQueries: 2 }),
      ),
    ).output
    expect(out).toContain('a+1')
    expect(out).toContain('b=2')
    expect(out).toContain(';\n\n\nSELECT')
  })

  it('preserves MyBatis placeholders', () => {
    const out = ok(
      formatSql('select * from t where id = #{id} and name = ${name} and x = #{a.b}'),
    ).output
    expect(out).toContain('id = #{id}')
    expect(out).toContain('AND name = ${name}')
    expect(out).toContain('AND x = #{a.b}')
  })

  it('formats the sample in every dialect without errors', () => {
    for (const { value } of SQL_DIALECTS) {
      const r = formatSql(SQL_SAMPLE, o({ dialect: value }))
      expect(r.ok, value).toBe(true)
    }
    const out = ok(formatSql(SQL_SAMPLE)).output
    expect(out).toContain('WITH\n  monthly_orders AS (')
    expect(out).toContain('row_number() OVER (')
    expect(out).toContain('AS "消费冠军"')
    expect(out).toContain("NOT LIKE '%测试 -- 请忽略%'")
    expect(out).toContain(';\n\nUPDATE users')
  })

  it('reports parse errors with line / column and a hint', () => {
    const r = formatSql('select a\nfrom t\nwhere b = 1 )')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.message).toContain('右括号')
    expect([r.error.line, r.error.column]).toEqual([3, 13])
    expect(r.error.hint).toContain('MySQL')
    expect(r.error.frame?.lines.find((l) => l.error)?.text).toBe('where b = 1 )')
  })

  it('explains unexpected end and unterminated strings', () => {
    const eof = formatSql('select (a from t')
    expect(!eof.ok && eof.error.message).toContain('意外结束')
    const str = formatSql("select a from t where b = 'abc")
    expect(!str.ok && str.error.message).toContain('没有闭合')
    expect(!str.ok && str.error.column).toBe(27)
  })

  it('reports errors at the original position when placeholders are present', () => {
    const r = formatSql('select #{id} from t where (a')
    expect(r.ok).toBe(false)
  })

  it('minify mode goes through minifySql', () => {
    expect(ok(formatSql('select 1 -- c\n, 2', o({ mode: 'minify' }))).output).toBe('select 1,2')
  })
})

describe('describeSqlError', () => {
  it('falls back to the raw message', () => {
    expect(describeSqlError(new Error('boom\nstack'), 'x', 'sql').message).toBe('格式化失败：boom')
  })

  it('reports columns in code points when emoji precede the error (regression)', () => {
    // sql-formatter 按 UTF-16 计列：😀 算 2 列，未换算时会报第 32 列
    const sql = "select '😀😀', x from t where ("
    const r = formatSql(sql, o())
    if (r.ok) throw new Error('expected error')
    expect([r.error.line, r.error.column]).toEqual([1, 30])
    expect(r.error.frame?.caretPrefix).toBe(sql)
  })

  it('never leaves half an emoji in the unexpected-token message', () => {
    // 报错片段按 UTF-16 截 10 个字符：¥ + 4 个半 emoji
    const r = formatSql("select 1 from t where a = 'x' ¥😀😀😀😀😀", o())
    if (r.ok) throw new Error('expected error')
    expect(r.error.message).toBe('无法识别的内容：¥😀😀😀😀')
    // 含孤立代理项的字符串无法 URI 编码
    expect(() => encodeURIComponent(r.error.message)).not.toThrow()
    expect(r.error.column).toBe(31)
    expect(r.error.frame?.caretWidth).toBe(5)
  })

  it('shows only the offending word, not the following text', () => {
    const r = formatSql('select a ¥ b from t', o())
    if (r.ok) throw new Error('expected error')
    expect(r.error.message).toBe('无法识别的内容：¥')
  })
})

describe('Oracle q-quotes (regression)', () => {
  it('does not swallow the preceding punctuation into the string token', () => {
    const toks = tokenizeSql("values(q'[it's]')", 'plsql')
    expect(toks.map((t) => [t.type, t.text])).toEqual([
      ['word', 'values'],
      ['punct', '('],
      ['string', "q'[it's]'"],
      ['punct', ')'],
    ])
  })
})

describe('MySQL DELIMITER scripts (regression)', () => {
  const proc =
    'DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1; -- one\n  SELECT 2;\nEND //\nDELIMITER ;\nCALL p();'

  it('keeps DELIMITER commands intact instead of splitting them into "/ /"', () => {
    const out = ok(formatSql(proc, o())).output
    expect(out).not.toContain('/ /')
    expect(out.split('\n')[0]).toBe('DELIMITER //')
    expect(out).toContain('\nEND//\nDELIMITER ;\nCALL p ();')
    expect(out).toContain('-- one')
  })

  it('does not split on the delimiter inside strings and handles $$', () => {
    const out = ok(
      formatSql("DELIMITER $$\nselect '$$' as a$$\nDELIMITER ;\nselect #{id};", o()),
    ).output
    expect(out).toBe("DELIMITER $$\nSELECT\n  '$$' AS a$$\nDELIMITER ;\nSELECT\n  #{id};")
  })

  it('ignores DELIMITER inside comments / strings and in other dialects', () => {
    expect(findDelimiterCommands("-- DELIMITER //\nselect 'DELIMITER //'", 'mysql')).toEqual([])
    expect(findDelimiterCommands('DELIMITER $$ -- note\nselect 1', 'mysql')[0]).toMatchObject({
      delimiter: '$$',
    })
  })

  it('reports errors at their position in the whole script', () => {
    const r = formatSql('DELIMITER //\nselect (1 //\nDELIMITER ;', o())
    if (r.ok) throw new Error('expected error')
    expect([r.error.line, r.error.column]).toEqual([2, 11])
    expect(r.error.frame?.lines.find((l) => l.error)?.text).toBe('select (1 //')
  })
})
