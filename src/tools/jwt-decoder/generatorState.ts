import { DEMO_SECRET } from '@/lib/jwt-decoder-samples'

/** 「生成令牌」页的编辑内容；放在父组件里保存，切换标签页后不会丢失 */
export interface GeneratorState {
  header: string
  payload: string
  secret: string
}

export function initialGeneratorState(): GeneratorState {
  const now = Math.floor(Date.now() / 1000)
  return {
    header: JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2),
    payload: JSON.stringify(
      {
        sub: 'user_42',
        name: '张三',
        roles: ['admin'],
        iss: 'https://auth.showme.dev',
        aud: 'showme-web',
        iat: now,
        exp: now + 3600,
      },
      null,
      2,
    ),
    secret: DEMO_SECRET,
  }
}
