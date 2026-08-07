import { useEffect, useMemo, useState } from 'react'

import { type CopyKey, type KeyEntry, type KeyGroup, groupKeys, keyCaps, matchKeys, t } from '@sepia/core'

// ⌘/ 快捷键看板（180 §1.2，D-32 / F23）。
//
// **只读。** 它不执行任何命令、不吃回车——non-goals 表 2 明确拒绝命令面板，
// T-03 也写死「不做命令面板 UI（Sepia 无此产品面）」。这里唯一的交互是搜索与关闭。
//
// 三条约束落在这个文件里，每条都有对应的检查：
//   ① **一屏放下、不出滚动条**（D-32 ①）——滚动条出现即信号：快捷键太多该砍功能。
//      所以它是 `overflow: hidden` 而不是 auto：溢出了要看得见地坏掉，不许悄悄能滚。
//   ② **只隐藏不重排**（D-32 ④）——搜索时给没命中的行加 `hidden` 属性，
//      **绝不 filter 后重新渲染**。位置一动，肌肉记忆就废了。
//   ③ **按上下文高亮/置灰**（D-32 ⑤）——一眼回答"我现在能按什么"。

/**
 * 组标题的文案键。**写成显式的表而不是 `t(\`keys.group.${g}\`)` 拼串**——
 * 拼出来的键绕过了 `CopyKey` 的类型检查，纪律 5 当场失效（少一条文案要到运行时
 * 才发现）。多打五行，换回编译期报错。
 */
const GROUP_TITLE: Record<KeyGroup, CopyKey> = {
  inline: 'keys.group.inline',
  block: 'keys.group.block',
  agent: 'keys.group.agent',
  file: 'keys.group.file',
  trigger: 'keys.group.trigger',
}

export interface CheatsheetProps {
  entries: KeyEntry[]
  onClose: () => void
}

export function Cheatsheet(props: CheatsheetProps): React.JSX.Element {
  const { entries, onClose } = props
  const [query, setQuery] = useState('')
  const hit = useMemo(() => matchKeys(entries, query), [entries, query])
  const groups = useMemo(() => groupKeys(entries), [entries])

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
    <div className="sepia-keys-backdrop" data-sepia-keys="open" onMouseDown={onClose}>
      <div
        className="sepia-keys"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="sepia-keys-head">
          <span className="sepia-keys-title">{t('keys.title')}</span>
          <input
            className="sepia-keys-search"
            data-sepia-keys-search=""
            placeholder={t('keys.search')}
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            // **回车什么也不做**：看板是只读的。留空处理器不是遗漏，是明写这件事。
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
          />
        </div>

        <div className="sepia-keys-columns">
          {groups.map((bucket) => (
            <section key={bucket.group} className="sepia-keys-group" data-sepia-keys-group={bucket.group}>
              <h3 className="sepia-keys-group-title">{t(GROUP_TITLE[bucket.group])}</h3>
              {bucket.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="sepia-keys-row"
                  data-sepia-keys-row={entry.id}
                  data-sepia-keys-available={entry.available ? 'true' : 'false'}
                  // `hidden` 而不是不渲染：**位置一个都不动**（D-32 ④）
                  hidden={!hit.has(entry.id)}
                >
                  <span className="sepia-keys-label">{entry.label}</span>
                  <span className="sepia-keys-caps">
                    {entry.spec === undefined ? (
                      <em className="sepia-keys-unbound">{t('keys.unbound')}</em>
                    ) : (
                      keyCaps(entry.spec).map((cap, at) => (
                        <kbd key={`${entry.id}-${String(at)}`} className="sepia-keycap">
                          {cap}
                        </kbd>
                      ))
                    )}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="sepia-keys-foot" data-sepia-keys-foot="">
          {t('keys.settings.hint')}
        </div>
      </div>
    </div>
  )
}
