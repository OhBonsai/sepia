import { useMemo } from 'react'

import { collectLinks, t } from '@sepia/core'

// 🔗 连接面板（190 P5 / F17）：**本篇引了谁，在哪儿引的**。
//
// 每条带位置标注（首段 / 第 N 段 / 末段）与原文摘录——只给一列路径的话，
// 用户还得回正文里翻一遍才知道那是哪句话。
//
// **不做反向链接**（"谁引了我"）：要全 book 索引，与全文搜索同一个技术前提，
// 而那是 non-goals 的红线。半个反向链接比没有更糟——它会让人以为没人引用这篇。

export interface LinksPanelProps {
  text: string
  onOpenPage: (relative: string) => void
  onOpenExternal: (url: string) => void
}

export function LinksPanel(props: LinksPanelProps): React.JSX.Element {
  const { text, onOpenPage, onOpenExternal } = props
  const links = useMemo(() => collectLinks(text), [text])

  if (links.length === 0) {
    return (
      <div className="sepia-links-empty" data-sepia-links-empty="">
        {t('links.none')}
      </div>
    )
  }

  return (
    <div className="sepia-linkspanel" data-sepia-linkspanel={String(links.length)}>
      {links.map((link, index) => (
        <div
          key={`${link.target}-${String(index)}`}
          className="sepia-link-row"
          data-sepia-link-row={link.target}
          data-sepia-link-external={link.external ? 'true' : 'false'}
          onClick={() => (link.external ? onOpenExternal(link.target) : onOpenPage(link.target))}
        >
          <div className="sepia-link-head">
            <span className="sepia-link-label">{link.label === '' ? link.target : link.label}</span>
            <span className="sepia-link-where">{link.external ? t('links.external') : link.where}</span>
          </div>
          <div className="sepia-link-excerpt">{link.excerpt}</div>
        </div>
      ))}
    </div>
  )
}
