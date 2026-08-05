import { history, undo } from '@codemirror/commands'
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { createMarkupRun } from '@sepia/core'

import { createState, readDoc } from '../src/base.ts'
import { applyMarkup, markupPlan, markupTransaction } from '../src/markup.ts'

// 150 §1.4 #3（CAS 行为，**不变量级**）与 #4（落笔原子性，纪律 19）。
//
// 全部在 state 上跑：本仓库单测无 DOM，起不了 EditorView。002 §1 的层级修正说得很清楚——
// 单测层该放的是「state 可判定性质」，而 CAS 判定与 transaction 形状正是这一类。

const ORIGINAL = '第一段。\n这里是要改的那一段。\n第三段。'
const FROM = ORIGINAL.indexOf('这里是要改的那一段。')
const TO = FROM + '这里是要改的那一段。'.length
const SNAPSHOT = '这里是要改的那一段。'

describe('落笔 · CAS 校验（纪律 9c）', () => {
  it('快照匹配 → 落得下去，且只改 range 内的字节', () => {
    const state = createState(ORIGINAL)
    const plan = markupPlan(state, {
      range: { from: FROM, to: TO },
      expectedText: SNAPSHOT,
      replacement: '这段被改写过了。',
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const next = state.update(plan.spec).state
    expect(readDoc(next)).toBe('第一段。\n这段被改写过了。\n第三段。')
    // range 之外逐字节保留（不变量 2）
    expect(readDoc(next).startsWith('第一段。\n')).toBe(true)
    expect(readDoc(next).endsWith('\n第三段。')).toBe(true)
  })

  it('生成期间用户改了这段字本身 → 中止，纸面一个字节不动（DoD 二）', () => {
    // 提交时拿到 SNAPSHOT，生成期间用户**在 range 之内**动了字
    const edited = ORIGINAL.replace(SNAPSHOT, '这里是刚被用户改过的那一段。')
    const state = createState(edited)

    const plan = markupPlan(state, {
      range: { from: FROM, to: TO },
      expectedText: SNAPSHOT,
      replacement: '这段被改写过了。',
    })

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toBe('stale')
    expect(plan.actualText).not.toBe(SNAPSHOT)
    // 最要紧的一条：没有 spec 就没有改动的可能——中止不是"改了再回滚"
    expect('spec' in plan).toBe(false)
    expect(readDoc(state)).toBe(edited)
  })

  it('生成期间用户在选区之前插字（区间整体位移）→ 也中止，不按旧坐标乱落', () => {
    // 这一条容易被漏：用户没碰那一段，但前面多了字，range 的坐标已经不指着原来的文本了。
    // 按旧坐标落笔会把无辜的字盖掉——CAS 拿现值一比就发现对不上，于是中止。
    // 位移后仍能落笔要等锚点（Stage 5a 的纯函数模块），本 stage 保守中止。
    const state = createState(`开头插入的一句。${ORIGINAL}`)

    const plan = markupPlan(state, {
      range: { from: FROM, to: TO },
      expectedText: SNAPSHOT,
      replacement: '这段被改写过了。',
    })

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toBe('stale')
  })

  it('用户在选区之后加字 → 照常落笔，且他刚加的字原样还在', () => {
    // 与上一条成对：range 之外的编辑不该阻塞落笔，否则用户在文末打字就永远落不了笔。
    const state = createState(`${ORIGINAL}\n用户在文末新写的一段。`)

    const plan = markupPlan(state, {
      range: { from: FROM, to: TO },
      expectedText: SNAPSHOT,
      replacement: '这段被改写过了。',
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(readDoc(state.update(plan.spec).state)).toBe(
      '第一段。\n这段被改写过了。\n第三段。\n用户在文末新写的一段。',
    )
  })

  it('生成期间文档被改短到区间越界 → 中止而不是抛异常', () => {
    const state = createState('短')
    const plan = markupPlan(state, {
      range: { from: FROM, to: TO },
      expectedText: SNAPSHOT,
      replacement: 'x',
    })

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toBe('out-of-range')
  })

  it('CRLF 文件上快照按 lineSeparator 取，不因换行被规范化而假报 stale', () => {
    // 这条守的是不变量 2 与 CAS 的交叉点：若快照走 doc.toString()（恒用 LF），
    // 一个 CRLF 文件在无人改字的情况下也会 compare 失败，落笔永远落不下去。
    const crlf = '一行\r\n要改的\r\n三行'
    const state = createState(crlf, { lineEnding: '\r\n' })
    const line = state.doc.line(2)

    const plan = markupPlan(state, {
      range: { from: line.from, to: line.to },
      expectedText: state.sliceDoc(line.from, line.to),
      replacement: '改过了',
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(readDoc(state.update(plan.spec).state)).toBe('一行\r\n改过了\r\n三行')
  })

  it('range 是 CM6 文档坐标，不是 JS 字符串下标——CRLF 上两者不等', () => {
    // 实施中撞出来的真陷阱，就地钉住：CM6 的一个换行**恒占 1 个位置**，
    // 与 lineSeparator 是 '\n' 还是 '\r\n' 无关。于是 CRLF 文件上
    // `read().indexOf(x)` 得到的下标比文档坐标大（每过一行大 1），
    // 拿它当 range 落笔会落偏——偏出去的字节正是不变量 2 要守的东西。
    // 结论写进契约：range 只能来自 CM6（selection() / doc.line()），
    // **不许由 app 侧对 read() 的结果做字符串检索得来**。
    const crlf = '一行\r\n要改的\r\n三行'
    const state = createState(crlf, { lineEnding: '\r\n' })

    expect(crlf.indexOf('要改的')).toBe(4)
    expect(state.doc.line(2).from).toBe(3)
    expect(state.doc.length).toBeLessThan(crlf.length)

    // 按 JS 下标落笔 → 取到的现值根本不是那一段，CAS 挡住
    const plan = markupPlan(state, {
      range: { from: crlf.indexOf('要改的'), to: crlf.indexOf('要改的') + 3 },
      expectedText: '要改的',
      replacement: '改过了',
    })
    expect(plan.ok).toBe(false)
  })
})

function historyState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [history()] })
}

describe('落笔 · 原子性与 undo 单元（纪律 19）', () => {
  it('applyMarkup 只 dispatch 一次，并在其后打 m5', () => {
    // 首轮反向验证暴露的洞（150 §1.5 #4）：把 dispatch 拆成"先删后插"两次，
    // 文档最终内容一模一样，undo 却要按两下。参数收窄成 MarkupTarget 之后，
    // 这里用记账桩把次数数出来，不必等 e2e。
    const dispatched: TransactionSpec[] = []
    const target = {
      state: createState(ORIGINAL),
      dispatch: (spec: TransactionSpec) => dispatched.push(spec),
    }
    const run = createMarkupRun(() => 42)

    const result = applyMarkup(
      target,
      { range: { from: FROM, to: TO }, expectedText: SNAPSHOT, replacement: '改写结果' },
      run,
    )

    expect(result.ok).toBe(true)
    expect(dispatched).toHaveLength(1)
    expect(run.timeline().m5).toBe(42)
  })

  it('CAS 不通过时一次都不 dispatch，也不打 m5——中止不是"改了再回滚"', () => {
    const dispatched: TransactionSpec[] = []
    const target = {
      state: createState(ORIGINAL),
      dispatch: (spec: TransactionSpec) => dispatched.push(spec),
    }
    const run = createMarkupRun(() => 42)

    const result = applyMarkup(
      target,
      { range: { from: FROM, to: TO }, expectedText: '这是一份对不上的旧快照。', replacement: '改写结果' },
      run,
    )

    expect(result.ok).toBe(false)
    expect(dispatched).toHaveLength(0)
    // 中止路径上纸面没动，m5 就不该有——否则 markupReport 会把一次没发生的落笔算进账里
    expect(run.timeline().m5).toBeUndefined()
  })

  it('是单次 transaction：一次 update 就位，不是先删后插两步', () => {
    const state = historyState(ORIGINAL)
    const transaction = state.update(markupTransaction({ from: FROM, to: TO }, '改写结果'))

    // changes 只有一段，覆盖 range，别处不动
    const ranges: Array<{ fromA: number; toA: number }> = []
    transaction.changes.iterChangedRanges((fromA, toA) => ranges.push({ fromA, toA }))
    expect(ranges).toEqual([{ fromA: FROM, toA: TO }])
    expect(readDoc(transaction.state)).toBe('第一段。\n改写结果\n第三段。')
  })

  it('⌘Z 一次撤干净，回到逐字节相同的原文', () => {
    const state = historyState(ORIGINAL)
    let current = state.update(markupTransaction({ from: FROM, to: TO }, '改写结果')).state
    expect(readDoc(current)).not.toBe(ORIGINAL)

    const undone = undo({
      state: current,
      dispatch: (transaction: Transaction) => {
        current = transaction.state
      },
    })

    expect(undone).toBe(true)
    expect(readDoc(current)).toBe(ORIGINAL)
  })

  it('落笔与用户紧挨着敲的字不合并：⌘Z 一次只撤掉落笔，用户的字还在', () => {
    // 纪律 19 里「隔离为独立 undo 单元」那半条。没有 isolateHistory，
    // CM6 会把**相邻**的编辑并成一个 history event，⌘Z 一下把用户自己刚写的字
    // 也撤掉——那是最难被察觉、也最伤人的一种"抢笔"。
    //
    // **打字位置是这条检查成立的关键，不是随手选的**（首轮反向验证的教训）：
    // 初稿让用户在**文首**打字，离选区十万八千里，CM6 本来就不会合并——
    // 于是摘掉 isolateHistory 测试照样绿，这条检查空转。CM6 的合并条件是
    // `isAdjacent`：两次改动的区间要挨着。所以这里让用户在**选区正后方**打字，
    // 那也正是真实场景（选中一段、⌘K、然后手没停继续往后写）。
    let current = historyState(ORIGINAL)
    current = current.update({ changes: { from: TO, insert: '手没停继续写的字。' } }).state
    const afterTyping = readDoc(current)

    // 用户的字落在 range 之外，range 内的快照没变 → CAS 放行
    expect(current.sliceDoc(FROM, TO)).toBe(SNAPSHOT)

    current = current.update(markupTransaction({ from: FROM, to: TO }, '改写结果')).state
    expect(readDoc(current)).not.toBe(afterTyping)

    undo({
      state: current,
      dispatch: (transaction: Transaction) => {
        current = transaction.state
      },
    })

    expect(readDoc(current)).toBe(afterTyping)
    expect(readDoc(current)).toContain('手没停继续写的字。')
  })
})
