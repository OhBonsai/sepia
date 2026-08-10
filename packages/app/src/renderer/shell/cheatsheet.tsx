import { useEffect, useMemo } from 'react'

import { type CopyKey, type KeyEntry, type KeyGroup, groupKeys, keyCaps, t } from '@sepia/core'

// ⌘/ 快捷键看板（180 §1.2，D-32 / F23）。
//
// **只读。** 它不执行任何命令、不吃回车——non-goals 表 2 明确拒绝命令面板，
// T-03 也写死「不做命令面板 UI（Sepia 无此产品面）」。这里唯一的交互是搜索与关闭。
//
// 两条约束落在这个文件里，每条都有对应的检查：
//   ① **一屏放下、不出滚动条**（D-32 ①）——滚动条出现即信号：快捷键太多该砍功能。
//      所以它是 `overflow: hidden` 而不是 auto：溢出了要看得见地坏掉，不许悄悄能滚。
//   ② **按上下文高亮/置灰**（D-32 ⑤）——一眼回答"我现在能按什么"。
//
// **搜索功能已按人裁移除**（2026-08-07，覆盖 D-32 ④）：「快捷键不需要搜索功能」。
// 一屏就放得下的东西不需要过滤器——要过滤才找得到，说明它本来就太多了，
// 那时该砍的是快捷键不是加个搜索框。连同 `matchKeys` 通路一并拆干净：
// 留一个没人调用的导出，就是下一个「listModels 亮了四个 stage 没人接」。

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
  const groups = useMemo(() => groupKeys(entries), [entries])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      // **看板开着时按键不许漏到正文里。**
      //
      // 搜索框还在的时候，焦点在那个 input 上，这件事是白捡的；拆掉搜索之后
      // 焦点回到编辑器，回车当场在纸上敲出一个空行——一个**只读**看板改了用户的字。
      // 与 ⌘/ 被 CM6 绑成 toggleComment 是同一类事故，也是同一条教训：
      // **浮层是模态就得真的是模态**，不能靠"恰好有个输入框接着"。
      //
      // 放行两类：修饰键组合（⌘/ 关自己、⌘Q 退出这些照常）与纯修饰键本身。
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
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
