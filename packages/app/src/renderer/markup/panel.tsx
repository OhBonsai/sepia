import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { verbsFor, type SelectionKind } from '@sepia/agent/tasks'
import {
  advanceReveal,
  diffWords,
  REVEAL_BATCH_MS,
  REVEAL_INITIAL,
  revealAtOnce,
  t,
  type DiffSegment,
  type RevealState,
} from '@sepia/core'

import { StreamPreview } from './preview.tsx'
import { startMarkup, type MarkupHandle, type MarkupProgress } from './run.ts'
import type { MarkupRequest } from './run.ts'

// markup 浮层：D-29 的**三阶段家具**（W6/W7）。
//
// 「按阶段发家具」是这个组件唯一的结构原则：唤起给一行输入 + 动词列；提交后**立刻**
// 换成流式状态 + 停止（不等首 token —— 架构 §4.3b 条目 6，等首 token 会让用户以为没按上）；
// 出结果换成 diff + 落笔/放弃/重试。三段之间**即时切换、无过渡动画**（130 已裁的
// opencode 气质；动效只出现在流式揭示的 24ms 批次里）。

export interface MarkupPanelProps {
  selection: string
  selectionKind: SelectionKind
  request: Omit<MarkupRequest, 'instruction'>
  /** 落笔。**run 必须一起交出去**——m5 要落在 m0–m4 同一条时间轴上（纪律 22）。 */
  onApply: (revised: string, run: MarkupHandle['run']) => void
  onClose: () => void
}

type Stage = 'compose' | 'generating' | 'result'

/** `prefers-reduced-motion` 命中则整块秒显——不是「动画慢一点」，是跳过揭示本身。 */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function MarkupPanel(props: MarkupPanelProps): React.JSX.Element {
  const { selection, selectionKind, request, onApply, onClose } = props
  const [instruction, setInstruction] = useState('')
  const [stage, setStage] = useState<Stage>('compose')
  const [progress, setProgress] = useState<MarkupProgress | null>(null)
  const [reveal, setReveal] = useState<RevealState>(REVEAL_INITIAL)
  const [followUp, setFollowUp] = useState('')
  const handle = useRef<MarkupHandle | null>(null)
  const received = progress?.received ?? ''
  const frozen = progress?.phase === 'done' || progress?.phase === 'aborted' || progress?.phase === 'failed'

  // 揭示节奏由**时钟**驱动，不由 token 到达驱动（稳定性第四条：节奏与到达率解耦）。
  useEffect(() => {
    if (stage !== 'generating') return undefined
    if (prefersReducedMotion()) {
      setReveal(revealAtOnce(received))
      return undefined
    }
    const timer = setInterval(() => {
      setReveal((current) => advanceReveal(current, received, frozen))
    }, REVEAL_BATCH_MS)
    return () => clearInterval(timer)
  }, [stage, received, frozen])

  // 流结束 → 出结果。**揭示完与流结束是两件事**：流早结束了，字可能还在往外揭。
  useEffect(() => {
    if (progress?.phase === 'done' && reveal.revealed >= received.length) setStage('result')
  }, [progress?.phase, reveal.revealed, received.length])

  const submit = useCallback(
    (text: string) => {
      if (text.trim() === '') return
      // 家具在提交这一瞬间就位——先切 stage，再发请求
      setStage('generating')
      setReveal(REVEAL_INITIAL)
      handle.current = startMarkup({ ...request, instruction: text }, setProgress)
    },
    [request],
  )

  const stop = useCallback(() => {
    handle.current?.stop()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // Esc 在生成中 = 停止，在其它阶段 = 关闭。同一个键，按阶段给不同的出口。
      if (stage === 'generating') stop()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, stop, onClose])

  const verbs = useMemo(() => verbsFor(selectionKind), [selectionKind])
  const revised = received.slice(0, reveal.revealed)
  const segments = useMemo(
    () => (stage === 'result' ? diffWords(selection, received) : []),
    [stage, selection, received],
  )

  return (
    <div className="sepia-markup" data-sepia-markup={stage}>
      {stage === 'compose' && (
        <>
          <input
            className="sepia-markup-input"
            autoFocus
            value={instruction}
            placeholder={selection === '' ? t('markup.empty') : t('markup.placeholder')}
            disabled={selection === ''}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit(instruction)
            }}
          />
          {/* 打字即隐藏动词（W6）——输入框里有字时，动词列就是噪声了 */}
          {instruction === '' && selection !== '' && (
            <div className="sepia-markup-verbs">
              {verbs.map((verb) => (
                <button key={verb.id} type="button" onClick={() => submit(verb.label)}>
                  {verb.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {stage === 'generating' && (
        <div className="sepia-markup-stream">
          <div className="sepia-markup-status">
            {progress?.phase === 'failed' ? (progress.reason ?? t('markup.failed')) : t('markup.streaming')}
          </div>
          <StreamPreview text={revised} />
          <button type="button" onClick={stop}>
            {t('markup.stop')}
          </button>
        </div>
      )}

      {stage === 'result' && (
        <div className="sepia-markup-result">
          <DiffView segments={segments} />
          <div className="sepia-markup-actions">
            <button
              type="button"
              onClick={() => {
                if (handle.current !== null) onApply(received, handle.current.run)
              }}
            >
              {t('markup.apply')}
            </button>
            <button type="button" onClick={onClose}>
              {t('markup.discard')}
            </button>
            <button type="button" onClick={() => submit(instruction)}>
              {t('markup.retry')}
            </button>
          </div>
          {/* F10 同线程追问：同一个 session 再来一轮，diff 更新 */}
          <input
            className="sepia-markup-followup"
            value={followUp}
            placeholder={t('markup.followup')}
            onChange={(event) => setFollowUp(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || followUp.trim() === '') return
              setStage('generating')
              setReveal(REVEAL_INITIAL)
              handle.current?.followUp(followUp)
              setFollowUp('')
            }}
          />
        </div>
      )}
    </div>
  )
}

/** 原文划线 / 新文对照。段的语义由 core 的 diff 给出，这里只负责画。 */
function DiffView({ segments }: { segments: DiffSegment[] }): React.JSX.Element {
  return (
    <div className="sepia-markup-diff">
      {segments.map((segment, index) => (
        <span
          // diff 段没有稳定 id，位置就是它的身份——这一组每次重算都是整体替换
          key={`${segment.op}-${index}`}
          data-sepia-diff={segment.op}
        >
          {segment.text}
        </span>
      ))}
    </div>
  )
}
