import { useEffect, useState } from 'react'

import { type CopyKey, type EngineStatus, t } from '@sepia/core'

import { type AgentModel, agent } from '../services/agent-bridge.ts'

// ▤ 状态浮层（190 P6 / F20）：Tab 栏最右那个图标的去处。
//
// 原型里它是「MCP / SKILL」两个 tab，列着 filesystem 已连接、sqlite 已连接之类。
// **我们这儿它们是空的，而且必须如实说空**——Sepia 的引擎跑在隔离环境里
//（架构 §4.1：不读用户的 `~/.config/opencode`，也不读 `~/.claude`），
// 所以用户在别处装的 MCP 与技能，这里一个都不该出现。
//
// 造几条假数据填满这一屏是很容易的，而且看起来"更像原型"。但那会让人以为
// 自己的 MCP 已经接上了——**一块状态面板说谎，比没有这块面板糟得多**。

/** 引擎状态的文案键。显式表，不拼串（纪律 5）。 */
const ENGINE_TEXT: Record<EngineStatus, CopyKey> = {
  starting: 'status.engine.starting',
  ready: 'status.engine.ready',
  absent: 'status.engine.absent',
}

export interface StatusOverlayProps {
  engine: EngineStatus
  onClose: () => void
}

export function StatusOverlay(props: StatusOverlayProps): React.JSX.Element {
  const { engine, onClose } = props
  const [tab, setTab] = useState<'agent' | 'mcp'>('agent')
  const [models, setModels] = useState<AgentModel[] | null>(null)

  useEffect(() => {
    // 模型列表**只在浮层打开时取一次**：它是"看一眼"的信息，
    // 没必要为它在启动路径上加一次请求（纪律 12 的精神）。
    void agent.listModels().then((result) => {
      if (result.ok) setModels(result.value)
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="sepia-status" data-sepia-status={tab}>
      <div className="sepia-status-tabs">
        <button
          type="button"
          data-sepia-status-tab="agent"
          data-sepia-status-tab-active={tab === 'agent' ? 'true' : 'false'}
          onClick={() => setTab('agent')}
        >
          {t('status.tab.agent')}
        </button>
        <button
          type="button"
          data-sepia-status-tab="mcp"
          data-sepia-status-tab-active={tab === 'mcp' ? 'true' : 'false'}
          onClick={() => setTab('mcp')}
        >
          {t('status.tab.mcp')}
        </button>
      </div>

      {tab === 'agent' && (
        <div className="sepia-status-body" data-sepia-status-body="agent">
          <div className="sepia-status-row">
            <span className="sepia-status-dot" data-sepia-status-engine={engine} />
            <span>{t(ENGINE_TEXT[engine])}</span>
          </div>
          {models === null ? (
            <div className="sepia-status-empty">{t('status.models.loading')}</div>
          ) : models.length === 0 ? (
            <div className="sepia-status-empty">{t('status.models.none')}</div>
          ) : (
            models.map((model) => (
              <div
                key={`${model.providerID}/${model.modelID}`}
                className="sepia-status-row"
                data-sepia-status-model={`${model.providerID}/${model.modelID}`}
              >
                <span>{model.modelName}</span>
                {/* **出处只作灰色小字**（D-36：只透出「模型」一个概念，不透出 provider） */}
                <span className="sepia-status-hint">{model.providerName}</span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'mcp' && (
        <div className="sepia-status-body" data-sepia-status-body="mcp">
          {/* **如实说空**，不造假数据——见文件头 */}
          <div className="sepia-status-empty" data-sepia-status-empty="isolated">
            {t('status.mcp.isolated')}
          </div>
        </div>
      )}
    </div>
  )
}
