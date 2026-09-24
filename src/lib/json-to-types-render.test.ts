import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RENDER_OPTIONS,
  TARGETS,
  generateTypes,
  mainTypeName,
  quote,
  type TargetLang,
  type TypeGenOptions,
} from './json-to-types-render'

const SAMPLE = JSON.stringify({
  id: 1,
  'first name': 'x',
  class: 'c',
  tags: ['a'],
  address: { city: 'x' },
  items: [
    { sku: 'a', qty: 1 },
    { sku: 'b', qty: 2.5, note: null },
  ],
  meta: {},
})

function gen(json: string, opts: Partial<TypeGenOptions> = {}): string {
  const r = generateTypes(json, opts)
  if (!r.ok) throw new Error(r.error.message)
  return r.code
}

describe('generateTypes', () => {
  it('returns empty code for empty input', () => {
    expect(generateTypes('   ')).toEqual({ ok: true, code: '', model: null, stats: null })
  })

  it('returns a located error for invalid JSON', () => {
    const r = generateTypes('{"a": 1,\n "b": }')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.line).toBe(2)
      expect(r.error.frame).toBeDefined()
    }
  })

  it('reports stats', () => {
    const r = generateTypes('[{"a":1},{"a":2,"b":null}]')
    expect(r.ok && r.stats).toEqual({
      types: 1,
      fields: 2,
      optional: 1,
      nullable: 1,
      samples: 2,
      jsonLines: false,
    })
    const l = generateTypes('{"a":1}\n{"a":2}\n{"a":3}')
    expect(l.ok && l.stats).toMatchObject({ samples: 3, jsonLines: true })
  })

  it.each(TARGETS.map((t) => t.id))('%s renders every sample without throwing', (lang) => {
    for (const json of [SAMPLE, '[]', '{}', 'null', '"s"', '[[1]]', '[{"a":[{"b":{}}]}]']) {
      const r = generateTypes(json, { lang })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.code.endsWith('\n')).toBe(true)
    }
  })

  it('uses the root name option', () => {
    expect(gen('{"a":1}', { rootName: 'api response' })).toContain('interface ApiResponse {')
  })

  it('has a file name for every target', () => {
    const names = TARGETS.map((t) => t.fileName('Root'))
    expect(names).toEqual([
      'types.ts',
      'types.go',
      'Root.java',
      'Root.kt',
      'types.rs',
      'Root.swift',
      'models.py',
      'Root.cs',
    ])
  })
})

describe('quote', () => {
  it('escapes per language', () => {
    expect(quote('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"')
    expect(quote('\u0001')).toBe('"\\u0001"')
    expect(quote('\u0001', 'swift')).toBe('"\\u{1}"')
    expect(quote('\u0001', 'rust')).toBe('"\\u{1}"')
    expect(quote('$ref', 'kotlin')).toBe('"\\$ref"')
    expect(quote('$ref')).toBe('"$ref"')
    expect(quote('中文😀')).toBe('"中文😀"')
  })
})

describe('TypeScript', () => {
  it('renders interfaces', () => {
    expect(gen(SAMPLE)).toBe(`export interface Root {
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
`)
  })

  it('supports type aliases, readonly and no export', () => {
    const code = gen('{"a":[1],"b":{"c":null}}', {
      tsDeclaration: 'type',
      tsReadonly: true,
      tsExport: false,
    })
    expect(code).toBe(`type Root = {
  readonly a: readonly number[];
  readonly b: B;
};

type B = {
  readonly c: unknown;
};
`)
  })

  it('renders nullable, unions and array unions', () => {
    const code = gen('[{"a":1,"u":[1,"x"],"n":"s"},{"a":2,"u":[],"n":null}]')
    expect(code).toContain('export type Root = RootItem[];')
    expect(code).toContain('  u: (string | number)[];')
    expect(code).toContain('  n: string | null;')
  })

  it('quotes invalid identifiers and keeps valid unicode keys', () => {
    const code = gen('{"data-id":1,"2fa":true,"用户名":"x","$ref":"r","_ok":1}')
    expect(code).toContain('  "data-id": number;')
    expect(code).toContain('  "2fa": boolean;')
    expect(code).toContain('  用户名: string;')
    expect(code).toContain('  $ref: string;')
    expect(code).toContain('  _ok: number;')
  })

  it('renders primitive roots', () => {
    expect(gen('"x"')).toBe('export type Root = string;\n')
    expect(gen('[]')).toBe('export type Root = unknown[];\n')
    expect(gen('[[1,2]]')).toBe('export type Root = number[][];\n')
  })
})

describe('Go', () => {
  it('renders gofmt-aligned structs with json tags', () => {
    expect(gen(SAMPLE, { lang: 'go' })).toBe(`type Root struct {
\tID        int64          \`json:"id"\`
\tFirstName string         \`json:"first name"\`
\tClass     string         \`json:"class"\`
\tTags      []string       \`json:"tags"\`
\tAddress   Address        \`json:"address"\`
\tItems     []Item         \`json:"items"\`
\tMeta      map[string]any \`json:"meta"\`
}

type Address struct {
\tCity string \`json:"city"\`
}

type Item struct {
\tSku  string  \`json:"sku"\`
\tQty  float64 \`json:"qty"\`
\tNote any     \`json:"note,omitempty"\`
}
`)
  })

  it('uses pointers for nullable values and optional objects, omitempty for optional', () => {
    const code = gen('[{"a":1,"o":{"x":1},"s":"x"},{"a":null,"s":"y"}]', { lang: 'go' })
    expect(code).toMatch(/A +\*int64 +`json:"a"`/)
    expect(code).toMatch(/O +\*O +`json:"o,omitempty"`/)
    expect(code).toMatch(/S +string +`json:"s"`/)
    const opt = gen('[{"n":1},{}]', { lang: 'go' })
    expect(opt).toMatch(/N int64 `json:"n,omitempty"`/)
  })

  it('handles special keys', () => {
    const code = gen('{"-":1,"用户":2,"2fa":3,"a,b":4,"q\\"k":5,"userId":6,"user_id":7}', {
      lang: 'go',
    })
    expect(code).toContain('`json:"-,"`')
    expect(code).toMatch(/X用户 +int64/)
    expect(code).toMatch(/X2fa +int64/)
    expect(code).toContain('// 注意：键 "a,b"')
    expect(code).toContain('`json:"q\\"k"`')
    expect(code).toMatch(/UserID +int64 +`json:"userId"`/)
    expect(code).toMatch(/UserID2 +int64 +`json:"user_id"`/)
  })

  it('renders array roots as named slice types', () => {
    expect(gen('[{"a":1}]', { lang: 'go' })).toBe(`type Root []RootItem

type RootItem struct {
\tA int64 \`json:"a"\`
}
`)
  })
})

describe('Java', () => {
  it('renders a class with getters, setters and nested static classes', () => {
    const code = gen(SAMPLE, { lang: 'java' })
    expect(code.startsWith('import com.fasterxml.jackson.annotation.JsonProperty;\n')).toBe(true)
    expect(code).toContain('import java.util.List;')
    expect(code).toContain('import java.util.Map;')
    expect(code).toContain('public class Root {')
    expect(code).toContain('    @JsonProperty("first name")\n    private String firstName;')
    expect(code).toContain('    @JsonProperty("class")\n    private String classValue;')
    expect(code).toContain('    private long id;')
    expect(code).toContain('    public long getId() {\n        return id;\n    }')
    expect(code).toContain('    public void setId(long id) {\n        this.id = id;\n    }')
    expect(code).toContain('    public static class Item {')
    expect(code).toContain('        private double qty;')
    expect(code).toContain('        private Object note;')
  })

  it('boxes optional and nullable primitives and uses is-getters for boolean', () => {
    const code = gen('[{"ok":true,"n":1,"f":1.5},{"ok":false,"f":null}]', { lang: 'java' })
    expect(code).toContain('private boolean ok;')
    expect(code).toContain('public boolean isOk()')
    expect(code).toContain('private Long n;')
    expect(code).toContain('private Double f;')
    expect(code).toContain('public Long getN()')
  })

  it('supports Lombok', () => {
    const code = gen('{"a":1,"b":{"c":"x"}}', { lang: 'java', javaLombok: true })
    expect(code).toContain('import lombok.Data;')
    expect(code).toContain('@Data\npublic class Root {')
    expect(code).toContain('    @Data\n    public static class B {')
    expect(code).not.toContain('getA')
  })

  it('does not import List when only the root is a list', () => {
    const code = gen('[{"a":1}]', { lang: 'java' })
    expect(code).not.toContain('import java.util.List;')
    expect(code).toContain('// JSON 根节点是 List<RootItem>')
  })

  it('explains roots without classes', () => {
    expect(gen('[1,2]', { lang: 'java' })).toBe('// JSON 根节点是 List<Long>，没有需要生成的类\n')
  })
})

describe('Kotlin', () => {
  it('renders serializable data classes', () => {
    const code = gen(SAMPLE, { lang: 'kotlin' })
    expect(code).toContain(
      'import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonElement',
    )
    expect(code).toContain('@Serializable\ndata class Root(\n    val id: Long,')
    expect(code).toContain('    @SerialName("first name") val firstName: String,')
    expect(code).toContain('    val `class`: String,')
    expect(code).toContain('    val note: JsonElement? = null,')
    expect(code).toContain('    val meta: Map<String, JsonElement>,')
  })

  it('escapes $ in SerialName and aliases array roots', () => {
    expect(gen('{"$ref":"x"}', { lang: 'kotlin' })).toContain(
      '@SerialName("\\$ref") val ref: String,',
    )
    expect(gen('[{"a":1}]', { lang: 'kotlin' })).toContain('typealias Root = List<RootItem>')
  })
})

describe('Rust', () => {
  it('renders serde structs', () => {
    expect(gen(SAMPLE, { lang: 'rust' })).toBe(`use serde::{Deserialize, Serialize};
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
`)
  })

  it('uses rename_all when most keys are camelCase', () => {
    const code = gen('{"userName":"a","createdAt":"b","id":1,"first-name":"x"}', { lang: 'rust' })
    expect(code).toContain('#[serde(rename_all = "camelCase")]')
    expect(code).toContain('    pub user_name: String,')
    expect(code).not.toContain('rename = "userName"')
    expect(code).toContain('    #[serde(rename = "first-name")]\n    pub first_name: String,')
  })

  it('handles keywords, Option and nested nullability', () => {
    const code = gen('[{"type":"a","self":1,"v":[1,null]},{"type":"b","self":2,"v":[],"o":1}]', {
      lang: 'rust',
    })
    expect(code).toContain('    pub r#type: String,')
    expect(code).toContain('    #[serde(rename = "self")]\n    pub self_: i64,')
    expect(code).toContain('    pub v: Vec<Option<i64>>,')
    expect(code).toContain(
      '    #[serde(skip_serializing_if = "Option::is_none")]\n    pub o: Option<i64>,',
    )
    expect(code).toContain('pub type Root = Vec<RootItem>;')
  })
})

describe('Swift', () => {
  it('renders Codable structs with CodingKeys only when needed', () => {
    const code = gen(SAMPLE, { lang: 'swift' })
    expect(code.startsWith('import Foundation\n\nstruct Root: Codable {\n    let id: Int\n')).toBe(
      true,
    )
    expect(code).toContain('    let `class`: String')
    expect(code).toContain('        case firstName = "first name"')
    expect(code).toContain('        case `class`')
    expect(code).toContain('struct Address: Codable {\n    let city: String\n}')
    expect(code).toContain('    let note: JSONValue?')
    expect(code).toContain('enum JSONValue: Codable, Hashable {')
  })

  it('omits the JSONValue helper when unused', () => {
    const code = gen('{"a":1,"b":[true]}', { lang: 'swift' })
    expect(code).not.toContain('JSONValue')
    expect(code).not.toContain('CodingKeys')
    expect(code).toContain('    let b: [Bool]')
  })

  it('escapes control characters Swift-style', () => {
    expect(gen('{"a\\u0001":1}', { lang: 'swift' })).toContain('case a = "a\\u{1}"')
  })
})

describe('Python', () => {
  it('renders dataclasses in dependency order with defaults last', () => {
    const code = gen(SAMPLE, { lang: 'python' })
    expect(code).toContain(
      'from __future__ import annotations\n\nfrom dataclasses import dataclass\nfrom typing import Any',
    )
    expect(code.indexOf('class Address')).toBeLessThan(code.indexOf('class Root'))
    expect(code.indexOf('class Item')).toBeLessThan(code.indexOf('class Root'))
    expect(code).toContain('    first_name: str  # JSON 键："first name"')
    expect(code).toContain('    class_: str  # JSON 键："class"')
    expect(code).toContain('    note: Any = None')
    const opt = gen('[{"b":1,"a":"x"},{"a":"y"}]', { lang: 'python' })
    expect(opt).toContain('    a: str\n    b: int | None = None')
  })

  it('renders TypedDict with class or functional syntax', () => {
    const code = gen('[{"a":1,"b":{"c":null}},{"a":2}]', {
      lang: 'python',
      pythonStyle: 'typeddict',
    })
    expect(code).toContain('from typing import Any, NotRequired, TypedDict')
    expect(code).toContain('class RootItem(TypedDict):\n    a: int\n    b: NotRequired[B]')
    expect(code).toContain('class B(TypedDict):\n    c: Any')
    expect(code.trimEnd().endsWith('Root = list[RootItem]')).toBe(true)
    const fn = gen('{"first name":"x","class":1}', { lang: 'python', pythonStyle: 'typeddict' })
    expect(fn).toContain(
      'Root = TypedDict(\n    "Root",\n    {\n        "first name": str,\n        "class": int,\n    },\n)',
    )
  })

  it('keeps functional TypedDict definitions ahead of their users', () => {
    const code = gen('{"outer":{"x y":{"a":1}}}', { lang: 'python', pythonStyle: 'typeddict' })
    expect(code.indexOf('XY = TypedDict')).toBeLessThan(code.indexOf('Outer = TypedDict'))
  })
})

describe('C#', () => {
  it('renders classes with JsonPropertyName', () => {
    const code = gen(SAMPLE, { lang: 'csharp' })
    expect(
      code.startsWith('using System.Collections.Generic;\nusing System.Text.Json.Serialization;\n'),
    ).toBe(true)
    expect(code).toContain('    [JsonPropertyName("id")]\n    public long Id { get; set; }')
    expect(code).toContain(
      '    [JsonPropertyName("first name")]\n    public string FirstName { get; set; } = string.Empty;',
    )
    expect(code).toContain('    public List<string> Tags { get; set; } = new();')
    expect(code).toContain('    public Dictionary<string, object?> Meta { get; set; } = new();')
    expect(code).toContain('    public object? Note { get; set; }')
  })

  it('makes optional values nullable and avoids member names equal to the class', () => {
    const clash = gen('{"item":1}', { lang: 'csharp', rootName: 'Item' })
    expect(clash).toContain('public class Item\n{')
    expect(clash).toContain('    public long Item2 { get; set; }')
    const code = gen('[{"n":1,"s":"x"},{"n":2}]', { lang: 'csharp', rootName: 'Rows' })
    expect(code).toContain('// JSON 根节点是 List<Row>')
    expect(code).toContain('    public string? S { get; set; }')
    expect(code).not.toContain('System.Collections.Generic')
  })
})

describe('options', () => {
  it('has sane defaults', () => {
    expect(DEFAULT_RENDER_OPTIONS).toEqual({
      tsDeclaration: 'interface',
      tsReadonly: false,
      tsExport: true,
      javaLombok: false,
      pythonStyle: 'dataclass',
    })
  })

  it.each<[TargetLang, string]>([
    ['typescript', '用户名: string;'],
    ['go', 'X用户名'],
    ['java', 'private String 用户名;'],
    ['kotlin', 'val 用户名: String,'],
    ['rust', 'pub 用户名: String,'],
    ['swift', 'let 用户名: String'],
    ['python', '用户名: str'],
    ['csharp', 'public string 用户名 { get; set; }'],
  ])('%s keeps Chinese keys usable', (lang, expected) => {
    expect(gen('{"用户名":"张三"}', { lang })).toContain(expected)
  })
})

describe('regressions', () => {
  it('names the Java file after the public class when the root is an array', () => {
    const r = generateTypes('[{"id":1}]', { lang: 'java' })
    if (!r.ok || !r.model) throw new Error('expected a model')
    expect(r.code).toContain('public class RootItem {')
    const java = TARGETS.find((t) => t.id === 'java')!
    expect(java.fileName(r.model.rootName, mainTypeName(r.model))).toBe('RootItem.java')
    expect(mainTypeName(r.model)).toBe('RootItem')
  })

  it('uses the root type as the main type for objects', () => {
    const r = generateTypes('{"a":1}', { rootName: 'Resp' })
    if (!r.ok || !r.model) throw new Error('expected a model')
    expect(mainTypeName(r.model)).toBe('Resp')
  })

  it('annotates Lombok boolean fields named isXxx so Jackson keeps the key', () => {
    const lombok = gen('{"isVerified":true,"isbn":"x","active":false}', {
      lang: 'java',
      javaLombok: true,
    })
    expect(lombok).toContain('@JsonProperty("isVerified")\n    private boolean isVerified;')
    expect(lombok).not.toContain('@JsonProperty("active")')
    expect(lombok).toContain('import com.fasterxml.jackson.annotation.JsonProperty;')
    // 手写 getter（isIsVerified）时 Jackson 能推断出正确的键，不需要注解
    const plain = gen('{"isVerified":true}', { lang: 'java' })
    expect(plain).not.toContain('@JsonProperty')
    expect(plain).toContain('public boolean isIsVerified()')
  })

  it('never throws on absurdly deep input', () => {
    const deep = '['.repeat(100000) + ']'.repeat(100000)
    expect(() => generateTypes(deep)).not.toThrow()
  })
})
