import { useEffect, useState } from 'react'

import { t } from '@sepia/core'

import { api } from '../services/api.ts'

// 外链阅读模式（190 P5 / D-39）：右栏抽出正文，**按 Sepia 自己的排版呈现**。
//
// 不是内嵌浏览器（理由在 main 的 services/reader.ts 头上）。抽不出来就如实说，
// 并给一条「在系统浏览器打开」——D-39 写死的退路。

export interface ReaderProps {
  url: string
  onOpenSystem: (url: string) => void
}

export function Reader(props: ReaderProps): React.JSX.Element {
  const { url, onOpenSystem } = props
  const [state, setState] = useState<{ title: string; body: string } | 'loading' | 'failed'>('loading')

  useEffect(() => {
    setState('loading')
    void api.readExternal(url).then((result) => {
      setState(result.ok ? { title: result.value.title, body: result.value.body } : 'failed')
    })
  }, [url])

  if (state === 'loading') return <div className="sepia-reader-note">{t('reader.loading')}</div>
  if (state === 'failed') {
    return (
      <div className="sepia-reader-note" data-sepia-reader="failed">
        {t('reader.failed')}
        <button type="button" data-sepia-reader-system="" onClick={() => onOpenSystem(url)}>
          {t('reader.open.system')}
        </button>
      </div>
    )
  }

  return (
    <article className="sepia-reader" data-sepia-reader="ok">
      <h2 className="sepia-reader-title">{state.title}</h2>
      <div className="sepia-reader-url">{url}</div>
      {state.body.split('\n\n').map((paragraph, index) => (
        <p key={`${String(index)}-${paragraph.slice(0, 8)}`}>{paragraph}</p>
      ))}
      <button type="button" data-sepia-reader-system="" onClick={() => onOpenSystem(url)}>
        {t('reader.open.system')}
      </button>
    </article>
  )
}
