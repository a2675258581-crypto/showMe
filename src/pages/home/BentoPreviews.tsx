import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'
import { modKey } from '@/hooks/useHotkey'
import { cn } from '@/lib/cn'

/* ───────────────────────── 小工具 hooks ───────────────────────── */

/** 在视口内时每 ms 毫秒前进一步 */
function useTicker(count: number, ms: number, active: boolean) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setI((v) => (v + 1) % count), ms)
    return () => clearInterval(t)
  }, [count, ms, active])
  return i
}

/** 乱码逐位揭晓的文字效果 */
function useScramble(
  target: string,
  active: boolean,
  alphabet = '0123456789abcdef',
  duration = 900,
) {
  const [text, setText] = useState(target)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!active || reduce) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const reveal = Math.floor(p * target.length)
      let s = target.slice(0, reveal)
      for (let k = reveal; k < target.length; k++) {
        s += target[k] === ' ' ? ' ' : alphabet[Math.floor(Math.random() * alphabet.length)]
      }
      setText(s)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, active, alphabet, duration, reduce])
  return reduce ? target : text
}

function useVisible<T extends Element>() {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { amount: 0.3 })
  return [ref, inView] as const
}

/* ───────────────────────── JSON ───────────────────────── */

const JSON_MIN =
  '{"id":1024,"name":"张三","tags":["dev","json"],"vip":true,"profile":{"city":"上海","score":98.5},"deleted":null}'

type Tok = [string, string?]
const JSON_PRETTY: Tok[][] = [
  [['{']],
  [['  '], ['"id"', 'k'], [': '], ['1024', 'n'], [',']],
  [['  '], ['"name"', 'k'], [': '], ['"张三"', 's'], [',']],
  [['  '], ['"tags"', 'k'], [': ['], ['"dev"', 's'], [', '], ['"json"', 's'], ['],']],
  [['  '], ['"vip"', 'k'], [': '], ['true', 'b'], [',']],
  [['  '], ['"profile"', 'k'], [': {']],
  [['    '], ['"city"', 'k'], [': '], ['"上海"', 's'], [',']],
  [['    '], ['"score"', 'k'], [': '], ['98.5', 'n']],
  [['  },']],
  [['  '], ['"deleted"', 'k'], [': '], ['null', 'b']],
  [['}']],
]

const TOK_CLASS: Record<string, string> = {
  k: 'text-[#326d74] dark:text-[#67b7a4]',
  s: 'text-[#c41a16] dark:text-[#ff8170]',
  n: 'text-[#1c00cf] dark:text-[#d9c97c]',
  b: 'text-[#9b2393] dark:text-[#ff7ab2] font-semibold',
}

export function JsonPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const phase = useTicker(2, 3200, inView)
  const pretty = phase === 1
  return (
    <div ref={ref} className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-fill px-2.5 py-1 font-mono text-[11px] text-fg-2">
          response.json
        </span>
        <motion.span
          key={String(pretty)}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-semibold',
            pretty ? 'bg-sys-green/15 text-sys-green' : 'bg-sys-orange/15 text-sys-orange',
          )}
        >
          {pretty ? '✓ 已格式化' : '压缩的 JSON'}
        </motion.span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-surface-2 p-4 font-mono text-[12px] leading-[1.7] sm:text-[13px]">
        <AnimatePresence mode="wait" initial={false}>
          {pretty ? (
            <motion.div
              key="pretty"
              exit={{ opacity: 0, filter: 'blur(4px)' }}
              transition={{ duration: 0.25 }}
            >
              {JSON_PRETTY.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.045, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="whitespace-pre text-fg"
                >
                  {line.map(([t, c], j) => (
                    <span key={j} className={c ? TOK_CLASS[c] : undefined}>
                      {t}
                    </span>
                  ))}
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="min"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scaleY: 1.4, filter: 'blur(4px)' }}
              transition={{ duration: 0.3 }}
              className="break-all text-fg-2"
            >
              {JSON_MIN}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ───────────────────────── API 调试（深色终端风） ───────────────────────── */

export function ApiPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const phase = useTicker(3, 1500, inView) // 0 空闲 1 发送中 2 返回
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (phase !== 2) return
    const target = 80 + Math.round(Math.random() * 90)
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 500)
      setMs(Math.round(target * p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  return (
    <div ref={ref} className="flex h-full flex-col gap-3 font-mono text-[12px] sm:text-[13px]">
      <div className="flex items-center gap-2 rounded-xl bg-white/[0.07] p-1.5 pl-3">
        <span className="font-bold text-[#30d158]">GET</span>
        <span className="truncate text-white/80">https://api.showme.dev/v1/users?page=1</span>
        <motion.span
          animate={phase === 1 ? { scale: [1, 0.92, 1] } : { scale: 1 }}
          transition={{ duration: 0.4 }}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[#0a84ff] px-3 font-sans text-[12px] font-semibold text-white"
        >
          {phase === 1 && <LoaderCircle className="size-3.5 animate-spin" />}
          {phase === 1 ? '发送中' : '发送'}
        </motion.span>
      </div>
      <div className="relative min-h-0 flex-1 rounded-xl bg-black/40 p-3">
        <AnimatePresence mode="wait">
          {phase === 2 ? (
            <motion.div
              key="res"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-1.5"
            >
              <div className="mb-1 flex items-center gap-2 font-sans text-[12px]">
                <motion.span
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                  className="rounded-full bg-[#30d158]/20 px-2 py-0.5 font-semibold text-[#30d158]"
                >
                  200 OK
                </motion.span>
                <span className="text-white/50 tabular-nums">{ms} ms</span>
                <span className="text-white/50">· 1.2 KB</span>
              </div>
              {[
                '{ "total": 128,',
                '  "data": [ { "id": 1, "name": "张三" },',
                '            { "id": 2, "name": "李四" } ] }',
              ].map((l, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.08 }}
                  className="whitespace-pre text-white/75"
                >
                  {l}
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="wait"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full items-center justify-center font-sans text-white/35"
            >
              {phase === 1 ? '正在等待响应…' : `按 ${modKey} Enter 发送请求`}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ───────────────────────── 哈希 ───────────────────────── */

const HASHES = [
  { input: 'hello', md5: '5d41402abc4b2a76b9719d911017c592' },
  { input: 'showMe', md5: '3ae45a6b4a8d004b8b18012f89eb77b0' },
  { input: '你好，世界', md5: 'dbefd3ada018615b35588a01e216ae6e' },
]

export function HashPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const i = useTicker(HASHES.length, 2600, inView)
  const h = HASHES[i]
  const text = useScramble(h.md5, inView)
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-2">
      <div className="text-xs text-fg-3">
        MD5(<span className="font-medium text-fg">&quot;{h.input}&quot;</span>)
      </div>
      <div className="font-mono text-[15px] leading-snug font-semibold break-all text-fg sm:text-[17px]">
        {text}
      </div>
    </div>
  )
}

/* ───────────────────────── 时间戳 ───────────────────────── */

export function TimestampPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!inView) return
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [inView])
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now * 1000),
    [now],
  )
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-1">
      <div className="flex font-mono text-[26px] font-bold tracking-tight text-fg tabular-nums sm:text-[30px]">
        {String(now)
          .split('')
          .map((d, idx) => (
            <span key={idx} className="relative inline-block h-[1.2em] w-[0.62em] overflow-hidden">
              <AnimatePresence initial={false}>
                <motion.span
                  key={d}
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: '0%', opacity: 1 }}
                  exit={{ y: '-100%', opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {d}
                </motion.span>
              </AnimatePresence>
            </span>
          ))}
      </div>
      <div className="text-xs text-fg-3 tabular-nums">北京时间 {date}</div>
    </div>
  )
}

/* ───────────────────────── 颜色 ───────────────────────── */

const COLORS = ['#0A84FF', '#BF5AF2', '#FF375F', '#FF9F0A', '#30D158', '#64D2FF']

export function ColorPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const i = useTicker(COLORS.length, 1800, inView)
  const hex = useScramble(COLORS[i], inView, '0123456789ABCDEF', 600)
  return (
    <div ref={ref} className="flex h-full items-center gap-4">
      <motion.div
        animate={{ backgroundColor: COLORS[i], boxShadow: `0 12px 32px -8px ${COLORS[i]}` }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="size-16 shrink-0 rounded-full sm:size-20"
      />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="font-mono text-lg font-bold text-fg">{hex}</div>
        <div className="flex gap-1.5">
          {COLORS.map((c, k) => (
            <motion.span
              key={c}
              animate={{ scale: k === i ? 1.3 : 1 }}
              className="size-3 rounded-full"
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── 二维码 ───────────────────────── */

const QR_N = 21

function qrModules(seed: number) {
  let s = seed
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const grid: boolean[] = []
  const finder = (x: number, y: number, ox: number, oy: number) => {
    const dx = x - ox
    const dy = y - oy
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null
    const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
    return ring !== 2
  }
  for (let y = 0; y < QR_N; y++)
    for (let x = 0; x < QR_N; x++) {
      const f = finder(x, y, 0, 0) ?? finder(x, y, QR_N - 7, 0) ?? finder(x, y, 0, QR_N - 7)
      if (f !== null) grid.push(f)
      else if ((x === 7 || y === 7) && (x < 8 || y < 8 || x > QR_N - 9 || y > QR_N - 9))
        grid.push(false)
      else grid.push(rand() > 0.52)
    }
  return grid
}

export function QrPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const seed = useTicker(4, 2400, inView)
  const grid = useMemo(() => qrModules(seed * 7919 + 17), [seed])
  return (
    <div ref={ref} className="flex h-full items-center justify-center">
      <svg
        viewBox={`-1 -1 ${QR_N + 2} ${QR_N + 2}`}
        className="size-full max-h-36 max-w-36"
        aria-hidden
      >
        <rect x="-1" y="-1" width={QR_N + 2} height={QR_N + 2} rx="2" className="fill-white" />
        {grid.map((on, k) => {
          const x = k % QR_N
          const y = Math.floor(k / QR_N)
          return (
            <rect
              key={k}
              x={x + 0.08}
              y={y + 0.08}
              width={0.84}
              height={0.84}
              rx={0.28}
              fill="#1d1d1f"
              style={{
                opacity: on ? 1 : 0,
                transform: on ? 'scale(1)' : 'scale(0.3)',
                transformOrigin: `${x + 0.5}px ${y + 0.5}px`,
                transition: `opacity .35s ${(x + y) * 12}ms, transform .45s cubic-bezier(.34,1.56,.64,1) ${(x + y) * 12}ms`,
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}

/* ───────────────────────── 密码 ───────────────────────── */

const PASSWORDS = ['q7#Lm2$Vx9!Rt4&Kp', 'Zt8@wN3%hB6^yC1*e', 'Rx5!Jd9#sQ2&vM7$u']
const PW_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*'

export function PasswordPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const i = useTicker(PASSWORDS.length, 2800, inView)
  const text = useScramble(PASSWORDS[i], inView, PW_ALPHABET, 800)
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-3">
      <div className="font-mono text-[17px] font-semibold tracking-wide break-all sm:text-[19px]">
        {Array.from(text).map((c, k) => (
          <span
            key={k}
            className={
              /\d/.test(c) ? 'text-sys-blue' : /[^A-Za-z0-9]/.test(c) ? 'text-sys-pink' : 'text-fg'
            }
          >
            {c}
          </span>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-fill">
        <motion.div
          key={i}
          initial={{ width: '8%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="h-full rounded-full bg-gradient-to-r from-sys-orange via-sys-yellow to-sys-green"
        />
      </div>
      <div className="text-xs text-fg-3">强度：极强 · 约 112 位熵</div>
    </div>
  )
}

/* ───────────────────────── 正则 ───────────────────────── */

const REGEX_CASES = [
  {
    pattern: '/1[3-9]\\d{9}/g',
    parts: ['联系我 ', '[13812345678]', ' 或者 ', '[15900001111]', '，工作日 9 点到 18 点。'],
  },
  {
    pattern: '/[\\w.]+@[\\w.]+\\.\\w+/g',
    parts: ['邮件发给 ', '[hi@showme.dev]', '，抄送 ', '[ops@example.com]', ' 即可。'],
  },
]

export function RegexPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const i = useTicker(REGEX_CASES.length, 3200, inView)
  const c = REGEX_CASES[i]
  let m = 0
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-4">
      <div className="inline-flex w-fit items-center gap-2 rounded-xl bg-fill-2 px-3 py-2 font-mono text-[13px] text-fg sm:text-[15px]">
        <AnimatePresence mode="wait">
          <motion.span
            key={c.pattern}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            {c.pattern}
          </motion.span>
        </AnimatePresence>
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-[15px] leading-loose text-fg-2 sm:text-[17px]"
        >
          {c.parts.map((p, k) => {
            if (!p.startsWith('[')) return <span key={k}>{p}</span>
            const idx = m++
            return (
              <span key={k} className="relative mx-0.5 inline-block font-mono text-fg">
                <motion.span
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.3 + idx * 0.45, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'absolute -inset-x-1 inset-y-0 origin-left rounded-md',
                    idx % 2 ? 'bg-sys-purple/20' : 'bg-sys-blue/20',
                  )}
                />
                <span className="relative">{p.slice(1, -1)}</span>
              </span>
            )
          })}
        </motion.p>
      </AnimatePresence>
      <div className="text-xs text-fg-3">实时高亮 · 分组 · 替换 · 常用正则库</div>
    </div>
  )
}

/* ───────────────────────── Diff ───────────────────────── */

const DIFF_LINES: { t: string; k: ' ' | '-' | '+' }[] = [
  { t: 'const api = "v1"', k: '-' },
  { t: 'const api = "v2"', k: '+' },
  { t: 'const timeout = 3000', k: ' ' },
  { t: 'retry(3)', k: '+' },
]

export function DiffPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className="flex h-full flex-col justify-center gap-1 font-mono text-[12px] sm:text-[13px]"
    >
      {DIFF_LINES.map((l, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: l.k === '+' ? 16 : l.k === '-' ? -16 : 0 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ delay: 0.15 + i * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'flex gap-2 rounded-md px-2 py-1',
            l.k === '-' && 'bg-sys-red/12 text-sys-red',
            l.k === '+' && 'bg-sys-green/12 text-sys-green',
            l.k === ' ' && 'text-fg-2',
          )}
        >
          <span className="w-2 select-none">{l.k}</span>
          <span className="truncate">{l.t}</span>
        </motion.div>
      ))}
    </div>
  )
}

/* ───────────────────────── JWT ───────────────────────── */

const JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIxMDI0IiwibmFtZSI6IuW8oOS4iSIsImlhdCI6MTczNTY4OTYwMH0',
  'pTC0ebd4FLLy7KYkIF-6kWjLL4VDRgzBwDaTzMzjNC8',
]

export function JwtPreview() {
  const [ref, inView] = useVisible<HTMLDivElement>()
  const colors = ['text-sys-pink', 'text-sys-purple', 'text-sys-cyan']
  return (
    <div ref={ref} className="grid h-full gap-4 sm:grid-cols-[1.3fr_1fr]">
      <div className="self-center font-mono text-[12px] leading-relaxed break-all sm:text-[13px]">
        {JWT.map((seg, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ delay: 0.2 + i * 0.35, duration: 0.5 }}
          >
            <span className={colors[i]}>{seg}</span>
            {i < 2 && <span className="text-fg-3">.</span>}
          </motion.span>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 1.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="hidden flex-col gap-1.5 self-center rounded-2xl bg-surface-2 p-3 font-mono text-[12px] sm:flex"
      >
        <Claim k="alg" v='"HS256"' c="text-sys-pink" />
        <Claim k="sub" v='"1024"' c="text-sys-purple" />
        <Claim k="name" v='"张三"' c="text-sys-purple" />
        <div className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-sys-green/15 px-2 py-0.5 font-sans text-[11px] font-semibold text-sys-green">
          ✓ 签名有效
        </div>
      </motion.div>
    </div>
  )
}

function Claim({ k, v, c }: { k: string; v: ReactNode; c: string }) {
  return (
    <div className="truncate">
      <span className={c}>{k}</span>
      <span className="text-fg-3">: </span>
      <span className="text-fg">{v}</span>
    </div>
  )
}
