import { useEffect, useState } from 'react'

import { type AppConfig, SETTINGS, type SettingItem, t } from '@sepia/core'
import { Icon, type IconName } from '@sepia/ui'

// 设置页（190 P3，S1–S5）。**浮层模态**，⌘, 唤起，盖在当前界面上——
// 不是独立路由页，关掉就回到关闭前那张纸，上下文一点不丢（S1）。
//
// 内容**由 `core/config/schema.ts` 那张表驱动**（见那边的长注释）：
// 手写上百个组件等于把 `sepia-settings.md` 抄一遍，而抄本必然漂移。

export interface SettingsProps {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
  onClose: () => void
  /** 快捷键页要用的：功能名 + 键位（与 ⌘/ 看板同一数据源，T-03）。 */
  keys: { id: string; label: string; spec?: string }[]
}

function value(config: AppConfig, key: string): unknown {
  return (config as unknown as Record<string, unknown>)[key]
}

export function Settings(props: SettingsProps): React.JSX.Element {
  const { config, onChange, onClose, keys } = props
  const [pageId, setPageId] = useState('pen')

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

  const page = SETTINGS.flatMap((group) => group.pages).find((it) => it.id === pageId)

  const control = (item: SettingItem): React.JSX.Element => {
    // **没接上子系统的项照样显示，只是置灰**（190 P3：不藏不删）。
    // 藏起来会给人"这个产品就这些功能"的错觉，而真相是"这些还没做"。
    if (item.pending === true || item.key === undefined) {
      return (
        <span className="sepia-set-pending" data-sepia-set-pending="">
          {t('settings.pending')}
        </span>
      )
    }
    const current = value(config, item.key)
    switch (item.control) {
      case 'switch': {
        return (
          <input
            type="checkbox"
            data-sepia-set-control={item.id}
            checked={current === true}
            onChange={(event) => onChange({ [item.key!]: event.target.checked } as Partial<AppConfig>)}
          />
        )
      }
      case 'number': {
        return (
          <input
            type="number"
            data-sepia-set-control={item.id}
            value={typeof current === 'number' ? current : 0}
            min={item.min}
            max={item.max}
            step={item.max !== undefined && item.max <= 1 ? 0.05 : 1}
            onChange={(event) => onChange({ [item.key!]: Number(event.target.value) } as Partial<AppConfig>)}
          />
        )
      }
      case 'input': {
        return (
          <input
            type="text"
            data-sepia-set-control={item.id}
            value={typeof current === 'string' ? current : ''}
            onChange={(event) => onChange({ [item.key!]: event.target.value } as Partial<AppConfig>)}
          />
        )
      }
      case 'select':
      case 'segmented': {
        return (
          <select
            data-sepia-set-control={item.id}
            value={typeof current === 'string' ? current : ''}
            onChange={(event) => onChange({ [item.key!]: event.target.value } as Partial<AppConfig>)}
          >
            {(item.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )
      }
      default: {
        return <span className="sepia-set-pending">{t('settings.pending')}</span>
      }
    }
  }

  return (
    <div className="sepia-set-backdrop" data-sepia-settings="open" onMouseDown={onClose}>
      <div className="sepia-set" onMouseDown={(event) => event.stopPropagation()}>
        <nav className="sepia-set-nav">
          {SETTINGS.map((group) => (
            <div key={group.title} className="sepia-set-group">
              {/* 一级**不可点**（S2）：它是分组标题，不是路由 */}
              <div className="sepia-set-group-title">{group.title}</div>
              {group.pages.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="sepia-set-nav-item"
                  data-sepia-set-page={it.id}
                  data-sepia-set-page-active={it.id === pageId ? 'true' : 'false'}
                  onClick={() => setPageId(it.id)}
                >
                  {/* schema 存的是图标**名字**（core 不碰 React），在这儿才变成 SVG。
                      `as IconName` 是这条边上唯一的断言——名字写错时它会在
                      `ICON_PATHS[name]` 那里取到 undefined，所以下面的检查里
                      有一条专门扫 schema 的图标名。 */}
                  <Icon name={it.icon as IconName} />
                  {it.title}
                </button>
              ))}
            </div>
          ))}
          <div className="sepia-set-foot" data-sepia-set-foot="">
            Sepia · MVP
          </div>
        </nav>

        <div className="sepia-set-body">
          {page?.id === 'keys' ? (
            // 快捷键页与 ⌘/ 看板**同一数据源**（T-03）：手写第二份必然漂移
            <div className="sepia-set-section">
              <h3 className="sepia-set-section-title">{t('keys.title')}</h3>
              {keys.map((entry) => (
                <div key={entry.id} className="sepia-set-row" data-sepia-set-key={entry.id}>
                  <span className="sepia-set-row-title">{entry.label}</span>
                  <span className="sepia-set-row-control">
                    {entry.spec === undefined ? t('keys.unbound') : entry.spec}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            page?.sections.map((section) => (
              <div key={section.title} className="sepia-set-section">
                <h3 className="sepia-set-section-title">{section.title}</h3>
                {section.items.map((item) => (
                  <div
                    key={item.id}
                    className="sepia-set-row"
                    data-sepia-set-item={item.id}
                    data-sepia-set-item-pending={item.pending === true ? 'true' : 'false'}
                  >
                    <span className="sepia-set-row-title">
                      {item.title}
                      {/* S4「新」角标：本期新增的项挂它 */}
                      {item.fresh === true && <em className="sepia-set-new">{t('settings.new')}</em>}
                      {item.description !== undefined && (
                        <span className="sepia-set-row-desc">{item.description}</span>
                      )}
                    </span>
                    <span className="sepia-set-row-control">{control(item)}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
