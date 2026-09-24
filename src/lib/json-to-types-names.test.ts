import { describe, expect, it } from 'vitest'
import {
  camelCase,
  commonSuffixName,
  goExport,
  goPascalCase,
  isJsIdentifier,
  isPlainIdentifier,
  keyWords,
  pascalCase,
  singularize,
  snakeCase,
  typeNameFromKey,
  uniqueName,
} from './json-to-types-names'

describe('singularize', () => {
  it.each([
    ['items', 'item'],
    ['users', 'user'],
    ['categories', 'category'],
    ['countries', 'country'],
    ['properties', 'property'],
    ['addresses', 'address'],
    ['classes', 'class'],
    ['statuses', 'status'],
    ['buses', 'bus'],
    ['aliases', 'alias'],
    ['boxes', 'box'],
    ['indexes', 'index'],
    ['matches', 'match'],
    ['dishes', 'dish'],
    ['caches', 'cache'],
    ['movies', 'movie'],
    ['cookies', 'cookie'],
    ['people', 'person'],
    ['children', 'child'],
    ['indices', 'index'],
    ['analyses', 'analysis'],
    ['leaves', 'leaf'],
    ['heroes', 'hero'],
    ['shoes', 'shoe'],
    ['quizzes', 'quiz'],
    ['menus', 'menu'],
    ['emojis', 'emoji'],
    ['apis', 'api'],
    ['ids', 'id'],
    ['keys', 'key'],
    ['responses', 'response'],
    ['courses', 'course'],
    ['sizes', 'size'],
  ])('%s → %s', (plural, single) => {
    expect(singularize(plural)).toBe(single)
  })

  it.each(['data', 'news', 'series', 'status', 'address', 'analysis', 'info', 'metadata', 'list'])(
    'keeps %s unchanged',
    (w) => {
      expect(singularize(w)).toBe(w)
    },
  )

  it('ignores non-ASCII and mixed-case words', () => {
    expect(singularize('商品')).toBe('商品')
    expect(singularize('Items')).toBe('Items')
    expect(singularize('')).toBe('')
  })
})

describe('keyWords & case conversion', () => {
  it('splits camel, snake, kebab and spaces but keeps letter-digit runs', () => {
    expect(keyWords('userProfileID')).toEqual(['user', 'profile', 'id'])
    expect(keyWords('first name')).toEqual(['first', 'name'])
    expect(keyWords('data-id')).toEqual(['data', 'id'])
    expect(keyWords('base64Data')).toEqual(['base64', 'data'])
    expect(keyWords('2fa-enabled')).toEqual(['2fa', 'enabled'])
    expect(keyWords('XMLHttpRequest')).toEqual(['xml', 'http', 'request'])
    expect(keyWords('$ref')).toEqual(['ref'])
    expect(keyWords('🔥🔥')).toEqual([])
  })

  it('converts to camel / pascal / snake', () => {
    expect(camelCase('user_name')).toBe('userName')
    expect(pascalCase('user_name')).toBe('UserName')
    expect(snakeCase('userName')).toBe('user_name')
    expect(snakeCase('avatarURL')).toBe('avatar_url')
    expect(camelCase('用户名')).toBe('用户名')
    expect(camelCase('')).toBe('')
  })

  it('uses Go initialisms', () => {
    expect(goPascalCase('userId')).toBe('UserID')
    expect(goPascalCase('avatar_url')).toBe('AvatarURL')
    expect(goPascalCase('apiKey')).toBe('APIKey')
    expect(goPascalCase('ids')).toBe('IDs')
    expect(goPascalCase('http_status')).toBe('HTTPStatus')
    expect(goPascalCase('name')).toBe('Name')
  })

  it('exports Go names that do not start with an uppercase letter', () => {
    expect(goExport('Name')).toBe('Name')
    expect(goExport('name')).toBe('Name')
    expect(goExport('用户')).toBe('X用户')
    expect(goExport('2fa')).toBe('X2fa')
  })
})

describe('typeNameFromKey', () => {
  it('builds PascalCase type names', () => {
    expect(typeNameFromKey('shipping_address')).toBe('ShippingAddress')
    expect(typeNameFromKey('userProfile')).toBe('UserProfile')
    expect(typeNameFromKey('2fa')).toBe('T2fa')
    expect(typeNameFromKey('🔥')).toBe('')
  })

  it('singularizes array item names', () => {
    expect(typeNameFromKey('items', true)).toBe('Item')
    expect(typeNameFromKey('categories', true)).toBe('Category')
    expect(typeNameFromKey('addresses', true)).toBe('Address')
    expect(typeNameFromKey('order_items', true)).toBe('OrderItem')
    expect(typeNameFromKey('people', true)).toBe('Person')
    expect(typeNameFromKey('data', true)).toBe('DataItem')
    expect(typeNameFromKey('list', true)).toBe('ListItem')
    expect(typeNameFromKey('商品', true)).toBe('商品Item')
    expect(typeNameFromKey('', true)).toBe('Item')
  })
})

describe('helpers', () => {
  it('finds the common suffix of candidate names', () => {
    expect(commonSuffixName(['BillingAddress', 'ShippingAddress'])).toBe('Address')
    expect(commonSuffixName(['HomeUserAddress', 'WorkUserAddress'])).toBe('UserAddress')
    expect(commonSuffixName(['Foo', 'Bar'])).toBeNull()
    expect(commonSuffixName([])).toBeNull()
  })

  it('checks identifiers', () => {
    expect(isJsIdentifier('userName')).toBe(true)
    expect(isJsIdentifier('$ref')).toBe(true)
    expect(isJsIdentifier('用户名')).toBe(true)
    expect(isJsIdentifier('first name')).toBe(false)
    expect(isJsIdentifier('2fa')).toBe(false)
    expect(isJsIdentifier('data-id')).toBe(false)
    expect(isPlainIdentifier('_x1')).toBe(true)
    expect(isPlainIdentifier('$ref')).toBe(false)
  })

  it('generates unique names', () => {
    const used = new Set<string>()
    expect(uniqueName('a', used)).toBe('a')
    expect(uniqueName('a', used)).toBe('a2')
    expect(uniqueName('a', used)).toBe('a3')
    const folded = new Set<string>()
    expect(uniqueName('Item', folded, true)).toBe('Item')
    expect(uniqueName('item', folded, true)).toBe('item2')
  })
})
