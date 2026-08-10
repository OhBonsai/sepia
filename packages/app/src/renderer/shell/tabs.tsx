import { t } from '@sepia/core'

// Tab 栏终态（190 P0，原型 Page 页 Layout）。
//
//   ⌂ │ 文件 tab（■脏标 ×关闭）… │ ＋ │ ▤
//   └回主页                        新建  状态浮层
//
// **⌂ 是一个特殊 tab 而不是按钮**：主页在这个产品里是一个可以停留的地方
//（无 tab 时它自动占据纸面），所以它和文件 tab 排在同一条线上、同一套高亮。
// 做成按钮的话，"我现在在哪儿"就得看两处。

export interface TabsProps {
  tabs: { page: string; dirty?: boolean }[]
  active: number
  /** 主页是否是当前界面（没有任何 tab，或用户点了 ⌂） */
  atHome: boolean
  onHome: () => void
  onSelect: (index: number) => void
  onClose: (index: number) => void
  onCreate: () => void
  onStatus: () => void
  statusBadge?: boolean
}

export function Tabs(props: TabsProps): React.JSX.Element {
  const { tabs, active, atHome, onHome, onSelect, onClose, onCreate, onStatus } = props
  return (
    <div className="sepia-tabs" data-sepia-tabs={String(tabs.length)}>
      <button
        type="button"
        // **不挂 `sepia-tab` 类**：它在视觉上与文件 tab 同族，但"有几个 tab"
        // 是个会被到处引用的判据（回归网里三条检查都在数它）。让 ⌂ 混进这个计数，
        // 每一处"tab 数"都会莫名其妙多一。视觉同族由下面的样式规则单独给。
        className="sepia-tab-home"
        data-sepia-tab-home=""
        data-sepia-tab-active={atHome ? 'true' : 'false'}
        title={t('tabs.home')}
        onClick={onHome}
      >
        ⌂
      </button>

      {tabs.map((tab, index) => (
        <div
          key={tab.page}
          className="sepia-tab"
          data-sepia-tab={tab.page}
          data-sepia-tab-active={!atHome && index === active ? 'true' : 'false'}
          data-sepia-tab-dirty={tab.dirty === true ? 'true' : 'false'}
          onClick={() => onSelect(index)}
        >
          {/* 只有文件名，没有图标——tab 条是一行细字，不是工具栏 */}
          <span className="sepia-tab-name">{tab.page.split('/').pop()}</span>
          {/* **脏标与关闭同一个位置**：平时是 ■，悬停变 ×。
              两个都常驻会让每个 tab 右边挂两个小东西，一排下来全是噪点。 */}
          <span
            className="sepia-tab-close"
            data-sepia-tab-close={tab.page}
            onClick={(event) => {
              event.stopPropagation()
              onClose(index)
            }}
          >
            <span className="sepia-tab-dirty-mark">■</span>
            <span className="sepia-tab-close-mark">×</span>
          </span>
        </div>
      ))}

      <button type="button" className="sepia-tab-add" data-sepia-tab-add="" title={t('tabs.new')} onClick={onCreate}>
        ＋
      </button>

      <span className="sepia-tabs-spacer" />

      <button
        type="button"
        className="sepia-tab-status"
        data-sepia-tab-status=""
        data-sepia-tab-status-badge={props.statusBadge === true ? 'true' : 'false'}
        title={t('tabs.status')}
        onClick={onStatus}
      >
        ▤
      </button>
    </div>
  )
}
