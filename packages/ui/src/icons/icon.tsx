import { ICON_PATHS, type IconName } from './paths.ts'

// 全应用唯一的图标出口。
//
// **inline SVG + `stroke="currentColor"`**：图标因此直接吃调用处的 `color`，
// 而 `color` 一路上来自 `--sepia-*`——**亮暗两套是白捡的**，不必为图标再建一套色板，
// 也就不会出现"主题切了图标没跟着切"那类只在一种模式下发现的问题（选区那条刚栽过）。
//
// **根标签上的属性只在这一处给**：size、stroke-width、linecap 全部统一。
// 26 份 SVG 各带各的属性的话，"图标风格统一"就只是一句话，而不是一件被保证的事。

/** 描边粗细。**统一 1.75**：lucide 默认 2 在 16px 下偏重，配我们这套字显脏。 */
const STROKE_WIDTH = 1.75

export interface IconProps {
  name: IconName
  /** 边长（px）。默认 16——与正文小字同量级。 */
  size?: number
  className?: string
}

export function Icon(props: IconProps): React.JSX.Element {
  const { name, size = 16, className } = props
  return (
    <svg
      // **自带 `sepia-icon` 类**：对齐（不许被压扁、与文字居中对齐）在这一处解决，
      // 不靠调用处各自记得加。上一版把对齐写成"给这些选择器加 gap"的清单，
      // 而清单天然会漏——设置页导航就漏了，图标直接贴在字上。
      className={className === undefined ? 'sepia-icon' : `sepia-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      // **图标是装饰，不是内容**：意思由旁边的文字或 title 承担。
      // 不加 aria-hidden 的话，读屏会把一堆没有名字的图形念出来。
      aria-hidden="true"
      focusable="false"
      // 内容是我们自己仓库里的常量（vendored 资产，见 paths.ts），
      // 不是任何用户输入或网络内容——这一处 innerHTML 是安全的
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  )
}

export { type IconName } from './paths.ts'
