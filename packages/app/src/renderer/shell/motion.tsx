import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

// 动效底座（190 附录 B-1 人裁 2026-08-11）。
//
// **来源**：Motion Primitives（shadcn registry，copy-in 而非依赖）——
// `transition-panel` 的形状正合右侧区三占用者互换；上游 MIT。
// https://motion-primitives.com/docs/transition-panel
// 运行时依赖 `motion`（framer-motion 后继）已在 B-1 §4 申报。
//
// **白名单四点，一个不多**（B-1 §1）：
//   ① 主页 → 纸的进入   ② tab 切换   ③ 右侧区占用者互换   ④ 设置浮层起落
// 要加第五个，先回 190 附录 B-1 报到。
//
// **打字与 IME 路径零动画**（B-1 §2）：这个文件里的东西一概不许出现在
// 编辑器内部、落笔、diff、徽章那几条链上——那里的"不打扰"比动感值钱。
//
// **时长与缓动不在这儿写死**，读的是 theme.css 里的 token；
// `prefers-reduced-motion` 由 CSS 那边把时长归零 + 这里的 `useReducedMotion`
// 双保险（B-1 §3 要求全部退化为瞬时）。

/** 从 CSS token 读时长（毫秒）。**不在 JS 里再定义一份**——那就成了第二处真相。 */
function duration(name: '--sepia-motion' | '--sepia-motion-fast'): number {
  if (typeof document === 'undefined') return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return Number.parseFloat(raw) / 1000 || 0
}

/** 缓动同理：token 里是 `cubic-bezier(a,b,c,d)`，取出四个数交给 motion。 */
function ease(): [number, number, number, number] | undefined {
  if (typeof document === 'undefined') return undefined
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sepia-ease').trim()
  const nums = raw.match(/-?[\d.]+/g)?.map(Number)
  return nums?.length === 4 ? [nums[0]!, nums[1]!, nums[2]!, nums[3]!] : undefined
}

function transition(fast = false): { duration: number; ease?: [number, number, number, number] } {
  const value = duration(fast ? '--sepia-motion-fast' : '--sepia-motion')
  const curve = ease()
  return curve === undefined ? { duration: value } : { duration: value, ease: curve }
}

/**
 * ① 主页 → 纸的进入（B-1 §1）。
 *
 * **轻微 rotateY 透视**——纸翻过来的那一下，幅度小到只在余光里成立。
 * B-1 §5 明写"真·翻书（3D 卷页）不进写作主路径"，所以这里是一点透视，
 * 不是一次翻页。
 */
export function PaperEnter(props: { keyed: string; children: React.ReactNode }): React.JSX.Element {
  const reduced = useReducedMotion()
  if (reduced === true) return <>{props.children}</>
  return (
    <motion.div
      key={props.keyed}
      className="sepia-motion-paper"
      initial={{ opacity: 0, rotateY: -1.5, transformPerspective: 1200 }}
      animate={{ opacity: 1, rotateY: 0 }}
      transition={transition()}
    >
      {props.children}
    </motion.div>
  )
}

/**
 * ②③ 交叉淡入：tab 切换与右侧区占用者互换共用一个形状。
 *
 * 这正是 Motion Primitives `transition-panel` 那条原语的用途——
 * 一个位置、多个占用者、切换时旧的退出新的进入。**两处共用同一个组件**，
 * 于是"切换是什么手感"只有一个答案。
 */
export function PanelSwap(props: { keyed: string; children: React.ReactNode }): React.JSX.Element {
  const reduced = useReducedMotion()
  if (reduced === true) return <>{props.children}</>
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={props.keyed}
        className="sepia-motion-panel"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={transition(true)}
      >
        {props.children}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * ④ 设置浮层起落。遮罩淡入 + 面板轻微上浮——**幅度只有 4px**：
 * 它要让人看见"这是盖上来的一层"，而不是表演一次弹出。
 */
export function OverlayRise(props: { children: React.ReactNode }): React.JSX.Element {
  const reduced = useReducedMotion()
  if (reduced === true) return <>{props.children}</>
  return (
    <motion.div
      className="sepia-motion-overlay"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition()}
    >
      {props.children}
    </motion.div>
  )
}
