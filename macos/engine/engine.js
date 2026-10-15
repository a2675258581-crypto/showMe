// showMe 原生 App 的 JavaScript 引擎入口：打包成单个 IIFE，在 JavaScriptCore 里运行。
// 构建：npm run build:engine（输出 macos/Resources/engine/showme-engine.js，提交进仓库）。
// 约定：每个函数接收「全是字符串」的参数对象，返回字符串（或 Promise<string>）；出错直接抛。
import * as prettier from 'prettier/standalone'
import babel from 'prettier/plugins/babel'
import estree from 'prettier/plugins/estree'
import postcss from 'prettier/plugins/postcss'
import html from 'prettier/plugins/html'
import markdown from 'prettier/plugins/markdown'
import yaml from 'prettier/plugins/yaml'
import graphql from 'prettier/plugins/graphql'
import { format as formatSql } from 'sql-formatter'
import { load as loadYaml, loadAll as loadAllYaml, dump as dumpYaml } from 'js-yaml'
import { marked } from 'marked'
import cronstrue from 'cronstrue/i18n'

const PLUGINS = [babel, estree, postcss, html, markdown, yaml, graphql]
const on = (v, fallback = false) =>
  v === undefined || v === '' ? fallback : v === '1' || v === 'true'
const num = (v, fallback) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function format(a) {
  return prettier.format(a.code ?? '', {
    parser: a.parser || 'babel',
    plugins: PLUGINS,
    tabWidth: num(a.tabWidth, 2),
    useTabs: on(a.useTabs),
    printWidth: num(a.printWidth, 80),
    singleQuote: on(a.singleQuote),
    semi: on(a.semi, true),
    trailingComma: a.trailingComma || 'all',
    proseWrap: 'preserve',
  })
}

function sql(a) {
  return formatSql(a.code ?? '', {
    language: a.language || 'sql',
    keywordCase: a.keywordCase || 'preserve',
    tabWidth: num(a.tabWidth, 2),
    useTabs: on(a.useTabs),
    linesBetweenQueries: num(a.linesBetweenQueries, 1),
  })
}

function yamlToJson(a) {
  const docs = loadAllYaml(a.code ?? '')
  const value = docs.length === 0 ? null : docs.length === 1 ? docs[0] : docs
  return JSON.stringify(value === undefined ? null : value)
}

function jsonToYaml(a) {
  return dumpYaml(JSON.parse(a.json ?? 'null'), {
    indent: num(a.indent, 2),
    sortKeys: on(a.sortKeys),
    lineWidth: -1,
    noRefs: true,
  })
}

function markdownToHtml(a) {
  return marked.parse(a.code ?? '', { gfm: on(a.gfm, true), breaks: on(a.breaks), async: false })
}

function cron(a) {
  return cronstrue.toString(a.expr ?? '', {
    locale: a.locale || 'zh_CN',
    use24HourTimeFormat: on(a.use24Hour, true),
    throwExceptionOnParseError: true,
  })
}

// 校验 YAML（编辑器保存前提示语法错误用）
function yamlCheck(a) {
  loadYaml(a.code ?? '')
  return 'ok'
}

const FUNCTIONS = { format, sql, yamlToJson, jsonToYaml, markdown: markdownToHtml, cron, yamlCheck }

/** 把各家库的错误统一成 { message, line, column }（1 起始） */
function describeError(e) {
  const out = { message: String((e && e.message) || e) }
  if (e && e.loc && e.loc.start) {
    out.line = e.loc.start.line
    out.column = e.loc.start.column
  } else if (e && e.mark && typeof e.mark.line === 'number') {
    out.line = e.mark.line + 1
    out.column = (e.mark.column || 0) + 1
  }
  // prettier 的消息里自带代码帧，只保留第一行
  out.message = out.message.split('\n')[0].replace(/\s*\(\d+:\d+\)$/, '')
  return out
}

/**
 * 原生侧唯一的入口：__showmeCall(name, argsJSON, token)
 * 结果通过 __showmeResults[token] = { ok } | { error } 交回（兼容同步与 Promise）。
 */
globalThis.__showmeResults = {}
globalThis.__showmeCall = function (name, argsJSON, token) {
  const done = (r) => {
    globalThis.__showmeResults[token] = r
  }
  try {
    const fn = FUNCTIONS[name]
    if (!fn) throw new Error('Unknown engine function: ' + name)
    const result = fn(JSON.parse(argsJSON))
    if (result && typeof result.then === 'function') {
      result.then(
        (v) => done({ ok: String(v) }),
        (e) => done({ error: describeError(e) }),
      )
    } else {
      done({ ok: String(result) })
    }
  } catch (e) {
    done({ error: describeError(e) })
  }
}
globalThis.ShowMeEngine = FUNCTIONS
