import { describe, expect, it } from 'vitest'

import {
  applyLinkUpdates,
  findLinks,
  imageTarget,
  limitTree,
  matchRefs,
  pruneEmptyDirs,
  pushRecent,
  referencedPages,
  titleOf,
  type RefCandidate,
  type TreeEntry,
} from '../src/library/index.ts'

// 170 §2.4 #2 / #3 / #4：树上限与降级、`@` 匹配、recents 置顶截断。

const entry = (path: string, depth: number, kind: 'dir' | 'file' = 'file'): TreeEntry => ({
  path,
  name: path.split('/').pop() ?? path,
  kind,
  depth,
})

describe('树扫描上限与降级', () => {
  it('不超限：原样返回，degraded 为 false', () => {
    const entries = [entry('a.md', 0), entry('sub', 0, 'dir'), entry('sub/b.md', 1)]
    expect(limitTree(entries, 500)).toEqual({ entries, degraded: false, total: 3 })
  })

  it('**超限 → 降级到只剩第一层**，并且说出来（不是悄悄截断）', () => {
    const entries = [entry('a.md', 0), entry('sub', 0, 'dir'), ...Array.from({ length: 50 }, (_x, i) => entry(`sub/f${i}.md`, 1))]
    const scan = limitTree(entries, 10)
    expect(scan.degraded, '超限了却没说').toBe(true)
    expect(scan.entries.every((row) => row.depth === 0), '降级后不该还有深层条目').toBe(true)
    expect(scan.total, 'total 要报真实总数，降级提示才有意义').toBe(52)
  })

  it('降级留的是"顶层"不是"前 N 个"——随机截断的树比降级更糟', () => {
    const entries = [...Array.from({ length: 30 }, (_x, i) => entry(`deep/f${i}.md`, 1)), entry('top.md', 0)]
    const scan = limitTree(entries, 5)
    expect(scan.entries.map((candidate) => candidate.path)).toEqual(['top.md'])
  })
})

describe('`@` 匹配（只搜文件名 + 标题）', () => {
  const candidates: RefCandidate[] = [
    { path: 'arch.md', name: 'arch.md', title: '架构总览' },
    { path: 'notes/plan.md', name: 'plan.md', title: '实施计划' },
    { path: 'notes/archive.md', name: 'archive.md' },
    // **名字是故意挑的**：查 `plan` 时它是子串命中，而字母序又排在 `plan.md` 前面。
    // 少了它，"前缀优先"就无法与"字母序兜底"区分开——见下面那条注释。
    { path: 'notes/a-plan.md', name: 'a-plan.md' },
    // 同上的道理，换到**标题**这一侧：`架构` 在它的标题里是子串不是前缀，
    // 而字母序又排在 `arch.md` 前面。
    { path: 'notes/a-old.md', name: 'a-old.md', title: '旧版架构说明' },
  ]

  it('前缀命中排在子串命中之前', () => {
    expect(matchRefs(candidates, 'arch').map((candidate) => candidate.name)).toEqual(['arch.md', 'archive.md'])
  })

  it('**前缀优先，即使字母序相反**——这条才真正咬住"前缀优先"', () => {
    // 收尾补做反向验证时抓到的空转：原来只有上面那条 `arch`，而
    // `['arch.md', 'archive.md']` **恰好也是字母序**——把前缀分支整个删掉，
    // 两者一起掉到"子串 70 分"，再按 localeCompare 兜底，顺序**一模一样**，检查照绿。
    // 这里让两种排法给出相反答案，前缀分支一断就必红。
    expect(matchRefs(candidates, 'plan').map((candidate) => candidate.name)).toEqual([
      'plan.md',
      'a-plan.md',
    ])
  })

  it('标题也能命中（人裁 4：文件名 + 标题，就这两样）', () => {
    expect(matchRefs(candidates, '架构').map((candidate) => candidate.name)).toContain('arch.md')
  })

  it('**标题前缀也优先于标题子串**——与文件名那一侧同样的空转，收尾时一并抓到', () => {
    expect(matchRefs(candidates, '架构').map((candidate) => candidate.name)).toEqual([
      'arch.md',
      'a-old.md',
    ])
  })

  it('**标题没建好时仍然即时可用**——索引是后台补的，`@` 不能等它', () => {
    const noTitles = candidates.map(({ path, name }) => ({ path, name }))
    expect(
      matchRefs(noTitles, 'plan').map((candidate) => candidate.name),
      '纯文件名路径必须照常匹配',
    ).toEqual(['plan.md', 'a-plan.md'])
  })

  it('模糊（字符按序）也能捞到，**且真的排在精确之后**', () => {
    // 原来这条只 `toContain`，描述里的"排在精确之后"一个字都没断言——
    // 正是 002 §6.2 第三条元规则说的"描述与断言对不上"。
    const result = matchRefs([...candidates, { path: 'ahv.md', name: 'ahv.md' }], 'ahv').map(
      (candidate) => candidate.name,
    )
    expect(result[0], '精确命中没排在第一').toBe('ahv.md')
    expect(result).toContain('archive.md')
  })

  it('空 query 给全部（刚敲下 @ 的那一刻要先有东西看）', () => {
    expect(matchRefs(candidates, '')).toHaveLength(5)
  })

  it('完全不匹配就是空，不硬凑', () => {
    expect(matchRefs(candidates, 'zzzz')).toEqual([])
  })
})

describe('标题提取', () => {
  it('首个 H1', () => {
    expect(titleOf('前言\n\n# 真正的标题\n\n# 第二个\n')).toBe('真正的标题')
  })

  it('frontmatter 的 title 优先于 H1（人裁 4 的次序）', () => {
    expect(titleOf('---\ntitle: 元信息标题\n---\n\n# H1 标题\n')).toBe('元信息标题')
  })

  it('带引号的 frontmatter title 去引号', () => {
    expect(titleOf('---\ntitle: "带引号"\n---\n')).toBe('带引号')
  })

  it('两个都没有 → undefined（不编一个出来）', () => {
    expect(titleOf('就是一段正文。\n')).toBeUndefined()
  })
})

describe('recents', () => {
  it('置顶 + 去重 + 截断，三件事一起', () => {
    expect(pushRecent(['b', 'c'], 'b', 20)).toEqual(['b', 'c'])
    expect(pushRecent(['b', 'c'], 'a', 20)).toEqual(['a', 'b', 'c'])
  })

  it('**超过上限要截**——不截的话这张表会一直长', () => {
    const many = Array.from({ length: 30 }, (_x, i) => `p${i}`)
    expect(pushRecent(many, 'new', 20)).toHaveLength(20)
    expect(pushRecent(many, 'new', 20)[0]).toBe('new')
  })
})

describe('图片落点', () => {
  it('assets/<yyMMddHHmm>-<原名>：时间戳在前（天然按时间排），原名在后（还认得出）', () => {
    const target = imageTarget('照片.png', new Date(2026, 7, 6, 21, 5).getTime())
    expect(target).toBe('assets/2608062105-照片.png')
  })

  it('空格与特殊字符替成连字符——否则 markdown 链接会断', () => {
    expect(imageTarget('my photo (1).png', 0)).toMatch(/^assets\/\d{10}-my-photo-1-?\.png$/)
  })

  it('名字被清空时兜一个 image，不产生 `assets/2608-`', () => {
    expect(imageTarget('***', 0)).toMatch(/-image$/)
  })

  it('**目录可配**（D-40）：换成别的目录，落点跟着走', () => {
    expect(imageTarget('a.png', 0, 'img')).toMatch(/^img\/\d{10}-a\.png$/)
    // 两侧的斜杠都容忍——用户在设置里填 `/pics/` 是常事
    expect(imageTarget('a.png', 0, '/pics/')).toMatch(/^pics\//)
    // 填空了退回默认，不产生 `/2608-a.png` 这种落在 book 根的东西
    expect(imageTarget('a.png', 0, '')).toMatch(/^assets\//)
  })
})

describe('链接更新（§2.4 #5：只改指向旧路径的）', () => {
  const text = '见 [甲](a.md) 与 [乙](b.md)，还有 [甲again](./a.md) 和 [别的](aa.md)。\n![图](img/x.png)\n'

  it('找到所有指向旧路径的，含 `./` 写法', () => {
    const hits = findLinks(text, 'p.md', 'a.md')
    expect(hits).toHaveLength(2)
    expect(hits.every((hit) => text.slice(hit.from, hit.to).endsWith('a.md'))).toBe(true)
  })

  it('**不误伤前缀相同的别的链接**——`aa.md` 不是 `a.md`', () => {
    const hits = findLinks(text, 'p.md', 'a.md')
    expect(hits.some((hit) => text.slice(hit.from, hit.to) === 'aa.md'), '把 aa.md 也改了').toBe(false)
  })

  it('改写从后往前，前面的替换不会打乱后面的偏移', () => {
    const out = applyLinkUpdates(text, findLinks(text, 'p.md', 'a.md'), 'renamed.md')
    expect(out).toContain('[甲](renamed.md)')
    expect(out).toContain('[甲again](renamed.md)')
    expect(out, '无关链接必须原样').toContain('[乙](b.md)')
    expect(out, '无关链接必须原样').toContain('[别的](aa.md)')
  })

  it('没有命中就一个字节都不改', () => {
    expect(applyLinkUpdates(text, findLinks(text, 'p.md', '不存在.md'), 'x.md')).toBe(text)
  })
})

describe('空目录摘除（真人轮撞出来的，§2.9 条目 4）', () => {
  it('**一个 md 都没有的目录不进树**——它们是噪音，还会让人以为应用坏了', () => {
    // 真人轮那个 book 的形状：两个目录，底下全是图片，一个 .md 都没有
    const entries = [entry('scraps', 0, 'dir'), entry('uploads', 0, 'dir')]
    expect(pruneEmptyDirs(entries)).toEqual([])
  })

  it('有 md 的目录留下，连同它的每一层祖先', () => {
    const entries = [
      entry('a', 0, 'dir'),
      entry('a/b', 1, 'dir'),
      entry('a/b/note.md', 2),
      entry('empty', 0, 'dir'),
    ]
    expect(pruneEmptyDirs(entries).map((row) => row.path)).toEqual(['a', 'a/b', 'a/b/note.md'])
  })

  it('顶层的 md 一律留下', () => {
    const entries = [entry('top.md', 0), entry('junk', 0, 'dir')]
    expect(pruneEmptyDirs(entries).map((row) => row.path)).toEqual(['top.md'])
  })
})

describe('正文里引用到的 page（缺口 #4 / C4）', () => {
  it('抽出相对路径的 .md，按出现先后去重', () => {
    const text = '见 [甲](a.md)，又见 [甲](a.md)，还有 [乙](notes/b.md)。\n'
    expect(referencedPages(text)).toEqual(['a.md', 'notes/b.md'])
  })

  it('`./` 前缀算同一篇', () => {
    expect(referencedPages('[甲](./a.md) [甲again](a.md)')).toEqual(['a.md'])
  })

  it('**外链与绝对路径都不收**——外链归内嵌浏览器，绝对路径不该出现在 book 内引用里', () => {
    expect(referencedPages('[外](https://x.com/a.md) [绝](/tmp/a.md)')).toEqual([])
  })

  it('图片与非 md 不收', () => {
    expect(referencedPages('![图](assets/x.png) [表](data.csv)')).toEqual([])
  })
})
