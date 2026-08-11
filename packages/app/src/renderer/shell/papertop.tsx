import { t } from '@sepia/core'
import { Icon, type IconName } from '@sepia/ui'

// 纸顶三图标（190 P0，原型 Page 页 Layout）。
//
//   文件名                    ▤  🔗  💬
//
// **三个图标去处不同，这是有意的**（features 二节要点）：
//   ▤ 属性 → **在纸里行内展开**（它是这张纸的一部分，不是关于这张纸的信息）
//   🔗 连接 / 💬 对话 → **开右侧面板**（它们是这张纸与别处的关系）
// 把三个都做成右侧面板会更"整齐"，但属性表一进右栏，编辑 frontmatter 就变成了
// 在另一个地方改这张纸的字节——那与"文件即真相"是拧着的。

export interface PaperTopProps {
  name: string
  metaOpen: boolean
  linksOpen: boolean
  threadsOpen: boolean
  onMeta: () => void
  onLinks: () => void
  onThreads: () => void
}

function icon(
  key: 'meta' | 'links' | 'threads',
  glyph: IconName,
  on: boolean,
  onClick: () => void,
  title: string,
): React.JSX.Element {
  return (
    <button
      type="button"
      className="sepia-paper-icon"
      data-sepia-paper-icon={key}
      data-sepia-paper-icon-on={on ? 'true' : 'false'}
      title={title}
      onClick={onClick}
    >
      <Icon name={glyph} />
    </button>
  )
}

export function PaperTop(props: PaperTopProps): React.JSX.Element {
  return (
    <div className="sepia-paper-top" data-sepia-paper-top="">
      <span className="sepia-paper-name">{props.name}</span>
      <span className="sepia-paper-icons">
        {icon('meta', 'table-properties', props.metaOpen, props.onMeta, t('paper.meta'))}
        {icon('links', 'link', props.linksOpen, props.onLinks, t('paper.links'))}
        {icon('threads', 'message-square', props.threadsOpen, props.onThreads, t('paper.threads'))}
      </span>
    </div>
  )
}
