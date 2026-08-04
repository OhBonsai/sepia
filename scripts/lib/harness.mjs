import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const SKIP_DIRS = new Set([
  'node_modules',
  'out',
  'dist',
  'coverage',
  'vendor',
  '.git',
  '.turbo',
  '.vite',
])

/** 递归列出 repo 相对路径。刻意跳过 vendor/——那不是我们的代码（纪律 15、16）。 */
export function walk(dirRelative, extensions) {
  const absolute = join(ROOT, dirRelative)
  let entries
  try {
    entries = readdirSync(absolute, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    const childRelative = join(dirRelative, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...walk(childRelative, extensions))
    } else if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(childRelative)
    }
  }
  return out
}

export function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

export function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

export function exists(relativePath) {
  try {
    statSync(join(ROOT, relativePath))
    return true
  } catch {
    return false
  }
}

export function rel(absolutePath) {
  return relative(ROOT, absolutePath).split('\\').join('/')
}

/**
 * 去掉注释后再做文本匹配，免得「// 例如 #fff」这种说明文字被当成违规。
 * 代价是同一行里 URL 之后的内容也会被吃掉——只会漏报，不会误报。
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead) => lead)
}

const EXEMPT = /harness-exempt:\s*([^\s]+(?:\s+\d+)?)/g

/** 本行或上一行标了 `// harness-exempt: <号>` 就放行，并计入豁免总数。 */
export function isExempt(lines, index, ruleId) {
  const needle = ruleId.replace(/\s+/g, '')
  for (const line of [lines[index] ?? '', lines[index - 1] ?? '']) {
    EXEMPT.lastIndex = 0
    let match
    while ((match = EXEMPT.exec(line)) !== null) {
      if (match[1].replace(/\s+/g, '').startsWith(needle)) return true
    }
  }
  return false
}

/**
 * 统一的输出口径（002 §3）：
 * 明细随便打，但**最后一行**必须是 `OK: …` 或 `FAIL: <纪律号>（<纪律>）— <位置>`。
 * check.mjs 只认这一行，所以每个子检查都得守住它。
 */
export class Report {
  constructor(name) {
    this.name = name
    this.violations = []
    this.notes = []
  }

  note(line) {
    this.notes.push(line)
  }

  add(code, title, location, hint) {
    this.violations.push({ code, title, location, hint })
  }

  finish(okMessage) {
    for (const line of this.notes) process.stdout.write(`  ${line}\n`)
    if (this.violations.length === 0) {
      process.stdout.write(`OK: ${okMessage}\n`)
      return
    }
    for (const v of this.violations) {
      process.stdout.write(`  ✗ ${v.code}（${v.title}）— ${v.location}\n`)
      if (v.hint) process.stdout.write(`      ${v.hint}\n`)
    }
    const [first] = this.violations
    const more =
      this.violations.length > 1 ? `（共 ${this.violations.length} 处，见上）` : ''
    process.stdout.write(`FAIL: ${first.code}（${first.title}）— ${first.location}${more}\n`)
    process.exitCode = 1
  }
}
