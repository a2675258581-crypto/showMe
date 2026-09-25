/**
 * 《临江仙 · 江湖》——页面的全部文案都在这里。
 * 词依苏轼《夜饮东坡醒复醉》一体填写，押词林正韵第十一部（名、晴、轻、声、盟、星）。
 */

export type SceneTone = 'day' | 'dusk' | 'night' | 'dawn'

export interface SceneDef {
  id: 'wind' | 'rain' | 'bridge' | 'river' | 'lamp' | 'stars'
  /** 幕次，如「第一幕」 */
  chapter: string
  /** 幕名，取自词中意象 */
  name: string
  /** 竖排的词句：一个元素一列，不含标点 */
  verses: string[]
  /** 旁白：一句白话，点出这一幕的故事 */
  narration: string
  tone: SceneTone
}

export const POEM = {
  tune: '临江仙',
  title: '江湖',
  /** 上、下片；每句含标点，竖排时一句一列 */
  stanzas: [
    ['一剑一囊风满袂，', '十年不问功名。', '酒旗斜挂雨初晴。', '马蹄惊落叶，', '人影过桥轻。'],
    ['多少恩仇随水去，', '江湖处处秋声。', '灯前犹记旧时盟。', '醉中横铁笛，', '一曲送残星。'],
  ],
  notes: [
    '词牌《临江仙》，双调六十字，前后段各五句、三平韵。',
    '依苏轼《夜饮东坡醒复醉》一体，押词林正韵第十一部：名、晴、轻、声、盟、星。',
  ],
} as const

export const PROLOGUE = {
  subtitle: '一阕词，一段路。',
  hint: '向下展卷',
  seal: '一阕江湖',
} as const

export const SCENES: SceneDef[] = [
  {
    id: 'wind',
    chapter: '第一幕',
    name: '风满袂',
    verses: ['一剑一囊风满袂', '十年不问功名'],
    narration: '一把剑，一只行囊。风从西边来，他已经走了十年。',
    tone: 'day',
  },
  {
    id: 'rain',
    chapter: '第二幕',
    name: '雨初晴',
    verses: ['酒旗斜挂雨初晴'],
    narration: '雨停的时候，镇口的酒旗刚好斜斜地挂着。',
    tone: 'day',
  },
  {
    id: 'bridge',
    chapter: '第三幕',
    name: '过桥',
    verses: ['马蹄惊落叶', '人影过桥轻'],
    narration: '马蹄踏碎落叶。桥上的人影很轻，轻得像十年前。',
    tone: 'day',
  },
  {
    id: 'river',
    chapter: '第四幕',
    name: '秋声',
    verses: ['多少恩仇随水去', '江湖处处秋声'],
    narration: '恩也罢，仇也罢，都随水去了。江湖从此只剩秋声。',
    tone: 'dusk',
  },
  {
    id: 'lamp',
    chapter: '第五幕',
    name: '灯前',
    verses: ['灯前犹记旧时盟'],
    narration: '可是灯一亮，旧日的盟约就回来了。',
    tone: 'night',
  },
  {
    id: 'stars',
    chapter: '第六幕',
    name: '残星',
    verses: ['醉中横铁笛', '一曲送残星'],
    narration: '他醉了，横起铁笛。一曲吹完，星也落尽。',
    tone: 'night',
  },
]

export const FINALE = {
  chapter: '终章',
  name: '全词',
  narration: '天亮了。他又上路。',
  seal: '江湖客',
  again: '再读一遍',
  back: '回百宝箱',
  credits:
    '字体：马善政毛笔楷书、思源宋体（SIL Open Font License）。页面在浏览器本地渲染，没有音频与追踪。',
} as const
