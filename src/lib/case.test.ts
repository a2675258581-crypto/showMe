import { describe, expect, it } from 'vitest'
import { convertCase, convertLines, splitWords } from './case'

describe('splitWords', () => {
  it('splits camel, pascal, acronyms and digits', () => {
    expect(splitWords('XMLHttpRequest2Fast')).toEqual(['xml', 'http', 'request', '2', 'fast'])
    expect(splitWords('helloWorld')).toEqual(['hello', 'world'])
    expect(splitWords('hello_world-foo.bar baz')).toEqual(['hello', 'world', 'foo', 'bar', 'baz'])
    expect(splitWords('  ')).toEqual([])
  })
})

describe('convertCase', () => {
  const src = 'user profile ID'
  it.each([
    ['camel', 'userProfileId'],
    ['pascal', 'UserProfileId'],
    ['snake', 'user_profile_id'],
    ['constant', 'USER_PROFILE_ID'],
    ['kebab', 'user-profile-id'],
    ['train', 'User-Profile-Id'],
    ['dot', 'user.profile.id'],
    ['path', 'user/profile/id'],
    ['title', 'User Profile Id'],
    ['sentence', 'User profile id'],
    ['lower', 'user profile id'],
    ['upper', 'USER PROFILE ID'],
  ] as const)('%s', (style, expected) => {
    expect(convertCase(src, style)).toBe(expected)
  })

  it('handles empty input', () => {
    expect(convertCase('', 'camel')).toBe('')
  })

  it('converts line by line keeping blank lines', () => {
    expect(convertLines('foo_bar\n\nbaz-qux', 'camel')).toBe('fooBar\n\nbazQux')
  })
})
