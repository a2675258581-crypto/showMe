import { describe, expect, it } from 'vitest'
import {
  csvEscape,
  formatRows,
  quoteIdent,
  sqlLiteral,
  toCSV,
  toJSON,
  toMarkdown,
  toSQL,
  toTSV,
} from './mock-data-format'
import type { Cell } from './mock-data'

const cols = ['id', 'name', 'note', 'ok']
const rows: Cell[][] = [
  [1, '张三', 'a,b', true],
  [2, "O'Brien", 'say "hi"\nbye', false],
  [3, '😀 表情', null, true],
]

describe('toJSON', () => {
  it('builds objects keyed by column', () => {
    expect(JSON.parse(toJSON(cols, rows))).toEqual([
      { id: 1, name: '张三', note: 'a,b', ok: true },
      { id: 2, name: "O'Brien", note: 'say "hi"\nbye', ok: false },
      { id: 3, name: '😀 表情', note: null, ok: true },
    ])
    expect(toJSON([], [])).toBe('[]')
  })
})

describe('CSV / TSV', () => {
  it('quotes per RFC 4180', () => {
    expect(csvEscape('plain')).toBe('plain')
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('x\ny')).toBe('"x\ny"')
    expect(csvEscape(' pad')).toBe('" pad"')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(false)).toBe('false')
  })

  it('renders header and rows', () => {
    expect(toCSV(cols, rows)).toBe(
      'id,name,note,ok\n1,张三,"a,b",true\n2,O\'Brien,"say ""hi""\nbye",false\n3,😀 表情,,true',
    )
  })

  it('TSV replaces tabs and newlines', () => {
    expect(toTSV(['a', 'b'], [['x\ty', 'l1\r\nl2']])).toBe('a\tb\nx y\tl1 l2')
  })
})

describe('SQL', () => {
  it('quotes identifiers per dialect, including schema.table', () => {
    expect(quoteIdent('user', 'mysql')).toBe('`user`')
    expect(quoteIdent('a`b', 'mysql')).toBe('`a``b`')
    expect(quoteIdent('public.users', 'postgres', true)).toBe('"public"."users"')
    expect(quoteIdent('dbo.t]x', 'sqlserver', true)).toBe('[dbo].[t]]x]')
    expect(quoteIdent('db. users ', 'mysql', true)).toBe('`db`.`users`')
    expect(quoteIdent('db.', 'mysql', true)).toBe('`db`')
  })

  it('never splits dotted column names (regression)', () => {
    expect(quoteIdent('user.name', 'mysql')).toBe('`user.name`')
    const sql = toSQL(['user.name', '姓名'], [['a', 'b']], {
      table: 'app.users',
      batch: 10,
      dialect: 'postgres',
    })
    expect(sql).toBe(`INSERT INTO "app"."users" ("user.name", "姓名") VALUES ('a', 'b');`)
  })

  it('escapes literals', () => {
    expect(sqlLiteral("O'Brien", 'postgres')).toBe("'O''Brien'")
    expect(sqlLiteral('C:\\path', 'mysql')).toBe("'C:\\\\path'")
    expect(sqlLiteral('C:\\path', 'postgres')).toBe("'C:\\path'")
    expect(sqlLiteral('中文', 'sqlserver')).toBe("N'中文'")
    expect(sqlLiteral(true, 'mysql')).toBe('TRUE')
    expect(sqlLiteral(true, 'sqlserver')).toBe('1')
    expect(sqlLiteral(null, 'mysql')).toBe('NULL')
    expect(sqlLiteral(1.5, 'mysql')).toBe('1.5')
    expect(sqlLiteral(NaN, 'mysql')).toBe('NULL')
  })

  it('batches rows into multi-row INSERTs', () => {
    const one = toSQL(
      ['id', 'n'],
      [
        [1, 'a'],
        [2, 'b'],
        [3, 'c'],
      ],
      {
        table: 'users',
        batch: 1,
        dialect: 'mysql',
      },
    )
    expect(one.split('\n')).toEqual([
      "INSERT INTO `users` (`id`, `n`) VALUES (1, 'a');",
      "INSERT INTO `users` (`id`, `n`) VALUES (2, 'b');",
      "INSERT INTO `users` (`id`, `n`) VALUES (3, 'c');",
    ])
    const two = toSQL(['id'], [[1], [2], [3]], { table: '', batch: 2, dialect: 'postgres' })
    expect(two).toBe(
      'INSERT INTO "mock_data" ("id") VALUES\n  (1),\n  (2);\nINSERT INTO "mock_data" ("id") VALUES (3);',
    )
    expect(toSQL(['id'], [], { table: 't', batch: 10, dialect: 'mysql' })).toBe('')
  })
})

describe('Markdown', () => {
  it('escapes pipes/newlines and right-aligns numeric columns', () => {
    const md = toMarkdown(
      ['n', 's'],
      [
        [1, 'a|b'],
        [2, 'x\ny'],
      ],
    )
    expect(md).toBe('| n | s |\n| ---: | --- |\n| 1 | a\\|b |\n| 2 | x<br>y |')
  })
})

describe('formatRows', () => {
  it('dispatches by format', () => {
    const sql = { table: 't', batch: 100, dialect: 'mysql' as const }
    expect(formatRows(['a'], [[1]], 'json', sql)).toBe('[\n  {\n    "a": 1\n  }\n]')
    expect(formatRows(['a'], [[1]], 'csv', sql)).toBe('a\n1')
    expect(formatRows(['a'], [[1]], 'tsv', sql)).toBe('a\n1')
    expect(formatRows(['a'], [[1]], 'sql', sql)).toBe('INSERT INTO `t` (`a`) VALUES (1);')
    expect(formatRows(['a'], [[1]], 'markdown', sql)).toBe('| a |\n| ---: |\n| 1 |')
  })

  it('handles 1000 rows quickly', () => {
    const big: Cell[][] = Array.from({ length: 1000 }, (_, i) => [
      i,
      `名字${i}`,
      'x,y',
      i % 2 === 0,
    ])
    for (const f of ['json', 'csv', 'tsv', 'sql', 'markdown'] as const) {
      const out = formatRows(cols, big, f, { table: 't', batch: 100, dialect: 'mysql' })
      expect(out.length).toBeGreaterThan(1000)
    }
  })
})
