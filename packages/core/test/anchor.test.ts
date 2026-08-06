import { describe, expect, it } from 'vitest'

import { createAnchor, realign, similarity } from '../src/anchor/index.ts'
import { PROSE_ARCHITECTURE, PROSE_PLAYBOOK } from './fixtures/prose.ts'

// §1.5 #5：锚点四级 + **误挂反证**。
//
// 标定集用**真实长文**（架构 §4.2 明写「用真实文章标定」）：取仓库自己的两篇文档各一段。
// 不用 `~/Downloads` 的私人文件——把用户的私人文档抄进仓库是另一回事，
// 而"真实中文技术散文"这个性质，仓库自己的文档同样满足（160 §1.9 记一笔）。

const ARCH = PROSE_ARCHITECTURE
const PLAY = PROSE_PLAYBOOK

/** 在文本里按引文建锚点（真实取材，不手编字符串）。 */
function anchorOn(text: string, quote: string) {
  const from = text.indexOf(quote)
  expect(from, `fixture 里应当有这段：${quote}`).toBeGreaterThanOrEqual(0)
  return createAnchor('a1', text, { from, to: from + quote.length })
}

describe('锚点四级对齐（真实长文标定集）', () => {
  describe('一级 · 位置未变', () => {
    it('原文一个字没动 → exact', () => {
      const anchor = anchorOn(ARCH, '**编辑器**：CodeMirror 6')
      expect(realign(anchor, ARCH).kind).toBe('exact')
    })

    it('改动发生在锚点之后 → 仍是 exact', () => {
      const anchor = anchorOn(ARCH, '**编辑器**：CodeMirror 6')
      const edited = `${ARCH}\n\n新增的一段尾巴。\n`
      expect(realign(anchor, edited).kind).toBe('exact')
    })
  })

  describe('二级 · 引文完好，位置挪了', () => {
    it('前面插入一大段 → shifted，且落在新位置上', () => {
      const quote = '**编辑器**：CodeMirror 6'
      const anchor = anchorOn(ARCH, quote)
      const inserted = `${PLAY}\n\n${ARCH}`
      const result = realign(anchor, inserted)
      expect(result.kind).toBe('shifted')
      if (result.kind !== 'orphan') {
        expect(inserted.slice(result.from, result.to)).toBe(quote)
      }
    })

    it('前面删掉一大段 → 同样 shifted', () => {
      const quote = '**D 类为什么排除**'
      const anchor = anchorOn(ARCH, quote)
      const cut = ARCH.slice(ARCH.indexOf('**B 类为什么最麻烦**'))
      const result = realign(anchor, cut)
      expect(result.kind).toBe('shifted')
      if (result.kind !== 'orphan') expect(cut.slice(result.from, result.to)).toBe(quote)
    })
  })

  describe('三级 · 引文被改了，靠前后文找回来', () => {
    it('段内改几个词 → fuzzy，且圈住的是同一段', () => {
      const quote = '任意 HTML 渲染带来安全与布局不可控'
      const anchor = anchorOn(ARCH, quote)
      const edited = ARCH.replace(quote, '任意 HTML 渲染会带来安全与布局上的不可控')
      const result = realign(anchor, edited)
      expect(result.kind).toBe('fuzzy')
      if (result.kind === 'fuzzy') {
        expect(edited.slice(result.from, result.to)).toContain('HTML')
        expect(result.score).toBeGreaterThanOrEqual(0.75)
      }
    })

    it('改动 + 位置也挪了 → 仍然 fuzzy', () => {
      const quote = '任意 HTML 渲染带来安全与布局不可控'
      const anchor = anchorOn(ARCH, quote)
      const edited = `${PLAY}\n\n${ARCH.replace(quote, '任意 HTML 渲染带来安全与布局的不可控')}`
      expect(realign(anchor, edited).kind).toBe('fuzzy')
    })
  })

  describe('四级 · 孤儿（**宁可孤儿不误挂**）', () => {
    it('整段被换成完全无关的文字 → orphan，不许硬挂到邻居身上', () => {
      const quote = '任意 HTML 渲染带来安全与布局不可控'
      const anchor = anchorOn(ARCH, quote)
      const edited = ARCH.replace(quote, '今天天气不错，适合出门散步，顺便买点水果回来')
      expect(realign(anchor, edited).kind).toBe('orphan')
    })

    it('整段连同前后文一起删掉 → orphan', () => {
      const anchor = anchorOn(ARCH, '**D 类为什么排除**')
      expect(realign(anchor, PLAY).kind).toBe('orphan')
    })

    // ── 误挂反证：**这两条才是这组检查存在的理由** ──────────────────────
    // **大幅改写但同主题**：实测相似度 0.606——它正落在"默认阈值判孤儿、放宽就误挂"
    // 那道缝上，是检验阈值方向的唯一有意义的样本。
    // （完全无关的文字相似度是 0.000，任何阈值都判孤儿，**证明不了阈值有没有用**——
    //   第一版反证例就选了它，于是那条断言其实在空转，实测才发现。）
    const heavilyRewritten = (): { anchor: ReturnType<typeof createAnchor>; text: string } => {
      const quote = '任意 HTML 渲染带来安全与布局不可控'
      const anchor = anchorOn(ARCH, quote)
      return { anchor, text: ARCH.replace(quote, '任意 HTML 渲染有安全问题') }
    }

    it('同主题的大幅改写 → 默认阈值下判孤儿（宁可丢，不可挂错）', () => {
      const { anchor, text } = heavilyRewritten()
      expect(realign(anchor, text).kind).toBe('orphan')
    })

    it('反证 · 阈值一放宽（0.75 → 0.4）同一段就被挂上了——所以默认阈值不能动', () => {
      const { anchor, text } = heavilyRewritten()
      expect(realign(anchor, text, { fuzzyThreshold: 0.4 }).kind).toBe('fuzzy')
    })

    // 真正分不清的场景不是"同一句出现两次"——那种情况前后文通常还认得出是哪一处。
    // 是**整块被复制了一份**：两处的前后文逐字相同，没有任何信息能分辨。
    // （第一版反证例就编错了：两处后文不同，于是前后文成功分辨、判了 shifted——
    //   那不是代码错，是**例子没瞄准要防的事故**，002 §6.2 说的正是这个。）
    // eslint-disable-next-line unicorn/consistent-function-scoping -- 与它服务的两条断言放在一起才读得懂
    const duplicatedBlock = (): { anchor: ReturnType<typeof createAnchor>; text: string } => {
      const before = '前文。\n\n'
      const block = '重复的一句话。'
      const after = '\n\n后文。'
      const one = `${before}${block}${after}`
      const anchor = createAnchor('a1', one, { from: before.length, to: before.length + block.length }, 5)
      // 前面垫一段，免得第一处正好落在老偏移上被一级直接认掉
      return { anchor, text: `插入的开头。\n\n${one}\n\n${one}` }
    }

    it('反证 · 整块被复制，两处前后文逐字相同 → orphan，不许随便挑一个', () => {
      const { anchor, text } = duplicatedBlock()
      expect(realign(anchor, text).kind, '分不清是哪一处就该判孤儿').toBe('orphan')
    })

    it('反证 · margin 放宽到 0 时才会在同文里硬挑一个', () => {
      const { anchor, text } = duplicatedBlock()
      expect(realign(anchor, text, { ambiguityMargin: 0 }).kind).toBe('shifted')
    })
  })

  describe('相似度本身', () => {
    it('逐字相同 = 1；面目全非 → 远低于阈值', () => {
      expect(similarity('一段中文正文', '一段中文正文')).toBe(1)
      expect(similarity('一段中文正文', '完全无关的另外一句话')).toBeLessThan(0.3)
    })

    it('改几个词仍然高于默认阈值——三级要认得出它', () => {
      expect(similarity('任意 HTML 渲染带来安全与布局不可控', '任意 HTML 渲染带来安全与布局上不可控')).toBeGreaterThan(
        0.75,
      )
    })
  })

  it('空引文锚不住任何东西 → orphan（不许 indexOf("") 匹配到处都是）', () => {
    expect(realign({ id: 'x', quote: '', before: '', after: '', from: 0, to: 0 }, ARCH).kind).toBe('orphan')
  })
})
