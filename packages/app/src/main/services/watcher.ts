import { realpath, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import { type FSWatcher, watch } from 'chokidar'

import {
  type ExternalChangeKind,
  type FileNotice,
  type FileStamp,
  type SelfWriteLog,
  reconcileKind,
} from '@sepia/core'

// 文件监听（架构 §4.9 / T-26）。三件事，缺一件就有一类字节风险：
//
//   ① 外面改了文件，纸要知道           —— chokidar 事件
//   ② 事件不来时纸也要知道             —— 窗口 focus 时按 mtime/size 对账（**兜底不是可选项**）
//   ③ 我们自己写的盘不许惊动自己       —— 路径 + 刚写入 mtime 过滤（纪律 17）
//
// 这个模块**不 import electron**：它只认路径与事件，于是能在 vitest 里拿真文件系统跑，
// 不必起应用。窗口 focus 的接线在 windows/create.ts（那边才是 Electron 的地盘）。
//
// ── 实测（170 §1.8 风险 1/2，chokidar 4.0.3 / macOS 14 / APFS）────────────────
// `atomic: true` 的归并**真的管用，而且不是可选项**：
//   tmp+rename（我们与 vim / VS Code 的写法）→ 一次 change；
//   `atomic: false` 时同一个动作 → **零事件**（rename 覆盖已监听文件在 mac 上不报），
//   也就是说关掉它不是"多几个事件"，是外部编辑器的保存**完全看不见**。
// 两条它管不到的，由本文件自己的归并窗口兜：
//   unlink→重建 超过 100ms → 仍是 unlink + add（必须自己合，否则删除误报）；
//   就地覆盖写 → 有时**两次** change（必须自己防抖，否则重载两遍）。
// 还有一条硬边界：**监听单个文件路径在 mac 上完全收不到事件**（六种写法全部零事件），
// 所以监听对象只能是**目录**。范围裁决见 SCOPE_NOTE。

/**
 * **监听范围 = 当前 page 所在目录，非递归**（`depth: 0`）。
 *
 * 170 §1.2 原文写的是「监听当前 book」。实测把它否了（风险 2 的数字）：
 * 拿真实的 `~/w/art`（8.3G、4455 个目录）当 book 递归监听——
 * **ready 87.6s、rss 1.3GB、4138 次 EMFILE**；chokidar v4 已无 fsevents，
 * 每个目录一个 `fs.watch`，大 book 就是这个结局。同一棵树 `depth: 2` 则是
 * 564ms / 1479 项 / 58MB / 零错误，说明代价全在无界递归上。
 *
 * a 期没有任何 book 全树事件的消费者（文件树、最近列表都归 b 期），
 * 而 DoD 要的是「当前 page 的外部变更看得见」——所以范围收到 page 所在目录。
 * **b 期做文件树时必须带 entry 上限与降级**，不能直接把 depth 放开。已记 §1.9 回流。
 */
const SCOPE_NOTE = 'page 所在目录，非递归'

/**
 * 事件归并窗口。**必须严格宽于 chokidar 自己的 atomic 窗口（默认 100ms），否则它是装饰**。
 *
 * 首轮 RV 抓到的：窗口设 120ms 时，把这一整层归并拿掉、单测照样全绿——因为 100ms 内的
 * `unlink + add` 本来就由 chokidar 折成 `change`，多出的那 20ms 什么也没接住
 * （170 §1.5 首轮 dead check 之二）。
 * 300ms 接住的是真实场景：**外部编辑器保存时删了再建、间隔落在 100–300ms**——
 * 归并不到就会误报「文件被删除了」，那是横条上最响的一句假话。
 * 代价是删除通知晚 ~300ms（实测 240ms → ~400ms）：换掉一类误报，划算。
 */
const MERGE_WINDOW_MS = 300

/** 初次扫描的等待上限。实测本仓库 64ms、`art/` 的一层 564ms；网络盘可能永远不回来。 */
const READY_TIMEOUT_MS = 3_000

/** 我们只关心 markdown。图片等资源的变更没有重载语义（Stage 2 的 widget 自己刷新）。 */
const MARKDOWN = /\.mdx?$/i

export interface WatcherStatus {
  /** `watching` 靠事件 + 对账；`reconcile-only` 是 watcher 失效后的降级态（架构 §4.9）。 */
  mode: 'watching' | 'reconcile-only'
  /** 正在盯着的 page 绝对路径。null = 还没有 page（空状态）。 */
  page: string | null
  scope: string
}

export interface WatcherOptions {
  /** 网络盘的逃生舱（架构 §4.9）。chokidar v4 仍支持，走 `fs.watchFile` 轮询。 */
  usePolling?: boolean
  /**
   * 「最近自写记录」的取法——**L2 的共享接缝**（`savePipeline()?.selfWrites`，160 §1.1〇-3）。
   *
   * 为什么是注入而不是在这里 `import { savePipeline } from '../ipc/index.ts'`：
   * ipc 已经 import 本模块（`file/read` 挂 watcher、`file/write` 刷印记），
   * 反向 import 就成环，`check:deps` 的 `no-circular` 当场红。装配点在 `main/index.ts`——
   * 那本来就是"把各服务接起来"的地方。
   *
   * 取法是**函数**而不是值：管线在 `registerIpc` 时才建，而 watcher 的配置发生在
   * 同一拍里，拿值会拿到建之前的 undefined。
   */
  selfWrites?: () => SelfWriteLog | null
}

type Listener = (notice: FileNotice) => void

const listeners = new Set<Listener>()
let watcher: FSWatcher | null = null
let watchedDir: string | null = null
let currentPage: string | null = null
/**
 * `currentPage` 的 realpath。**claim 必须拿这一个去比**——L2 登记时用的是 realpath，
 * 而 renderer 给的路径是 session 里那一串（macOS 上常常是 `/var/...` 而不是
 * `/private/var/...`）。不归一化，两侧永远比不上，回声就一次也挡不住（a4 栽过的坑）。
 * 事件与通知仍然用 `currentPage` 原样的形态——renderer 是按它认自己那一页的。
 */
let realPage: string | null = null
let stamp: FileStamp | null = null
let mode: WatcherStatus['mode'] = 'watching'
let degradedTold = false
let options: WatcherOptions = {}
const merging = new Map<string, { kinds: Set<ExternalChangeKind>; timer: ReturnType<typeof setTimeout> }>()

/**
 * 让 watcher 一上来就进降级态。给 smoke 检查 9 用——「watcher 整体失效时 focus 对账
 * 仍抓到外部变更」这条只能从外部关掉 watcher 来验，而 smoke 隔着一个真进程，
 * 够不到模块内部。它模拟的是网络盘/限额撞满这类**真实存在的状态**，不是测试后门。
 */
const FORCE_DEGRADE = process.env['SEPIA_WATCHER_FORCE_DEGRADE'] === '1'

export function configureWatcher(next: WatcherOptions): void {
  options = next
}

export function onFileNotice(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(notice: FileNotice): void {
  for (const listener of listeners) listener(notice)
}

export function watcherStatus(): WatcherStatus {
  return { mode, page: currentPage, scope: SCOPE_NOTE }
}

async function stampOf(path: string): Promise<FileStamp | null> {
  try {
    const info = await stat(path)
    return { mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return null
  }
}

/**
 * renderer 打开了一个 page（信号取自 `file/read`——那是 renderer 唯一的打开通道）。
 *
 * 同目录内换页不重挂 watcher：重挂要重走一次 readdir + 逐项 fs.watch，
 * 而在同一个 book 里换 page 是最频繁的动作。
 */
export async function watchPage(path: string): Promise<void> {
  currentPage = path
  realPage = await realpath(path).catch(() => path)
  stamp = await stampOf(path)
  if (FORCE_DEGRADE) {
    degrade('SEPIA_WATCHER_FORCE_DEGRADE')
    return
  }
  const dir = dirname(path)
  if (watchedDir === dir && watcher !== null) return
  await stopWatcher()
  watchedDir = dir
  mode = 'watching'

  try {
    const instance = watch(dir, {
      // 三个选项各自对着一条实测，别按"看起来是默认值"删掉（见文件头注）
      atomic: true,
      depth: 0,
      ignoreInitial: true,
      ...(options.usePolling === true ? { usePolling: true } : {}),
      // 点开头的一律不看：`.git` / `.sepia` / 我们自己的 `.xxxx.tmp` 都在里面。
      // 监听根自己不许被 ignore（根是目录，basename 可能以点开头，如 `~/.sepia/x`）。
      ignored: (candidate: string) => candidate !== dir && basename(candidate).startsWith('.'),
    })
    instance.on('all', (event, changed) => {
      if (typeof changed !== 'string') return
      if (!MARKDOWN.test(changed)) return
      if (event === 'add' || event === 'change') queue(changed, 'changed')
      else if (event === 'unlink') queue(changed, 'removed')
    })
    // watcher 失效不是错误态，是**降级**：写作照常，只是从此靠 focus 对账（架构 §4.9）。
    instance.on('error', (error: unknown) => degrade(error instanceof Error ? error.message : String(error)))
    watcher = instance
    // **必须等 ready**：在初次扫描完成之前 chokidar 还不知道这个目录里有哪些文件，
    // 此刻发生的删除它压根不会报（实测：单测里 watchPage 后立刻 unlink → 零事件）。
    // 挂载本来就在异步路径上（`file/read` 用 void 调它），等这一下不挡任何光标；
    // 而不等的代价是「刚打开 page 的那一瞬间外部动作是瞎的」。
    await ready(instance)
  } catch (error) {
    degrade(error instanceof Error ? error.message : String(error))
  }
}

/**
 * 等初次扫描完成。**带超时**：网络盘上 readdirp 可能长时间不回来，
 * 而「挂载卡住」不该让后续的对账也跟着卡——超时就当它没挂上，走降级那条路。
 */
function ready(instance: FSWatcher): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      degrade('watcher ready timeout')
      resolve()
    }, READY_TIMEOUT_MS)
    instance.once('ready', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function degrade(reason: string): void {
  if (mode === 'reconcile-only') return
  mode = 'reconcile-only'
  void watcher?.close().catch(() => undefined)
  watcher = null
  watchedDir = null
  // 一次性告知：降级本身不是每次都要提醒的事，提醒多了就成了噪音。
  if (!degradedTold) {
    degradedTold = true
    emit({ type: 'watcher-degraded', reason })
  }
}

/**
 * 归并窗口：把 `MERGE_WINDOW_MS` 内落在同一路径上的原始事件合成一条事实。
 * 两种歧义都在这里被消掉——`unlink + add`（外部编辑器的保存、或删了又建）折成
 * `changed`；重复的 `change` 折成一条。
 */
function queue(path: string, kind: ExternalChangeKind): void {
  const entry = merging.get(path)
  if (entry) {
    entry.kinds.add(kind)
    return
  }
  const kinds = new Set<ExternalChangeKind>([kind])
  const timer = setTimeout(() => {
    merging.delete(path)
    // 窗口里同时出现过删除与出现 → 那是一次替换，不是删除。
    void settle(path, kinds.has('changed') ? 'changed' : 'removed')
  }, MERGE_WINDOW_MS)
  merging.set(path, { kinds, timer })
}

async function settle(path: string, kind: ExternalChangeKind): Promise<void> {
  // a 期只有一个消费者：当前 page。别的 .md 变了没人要（文件树归 b 期）。
  if (currentPage === null || path !== currentPage) return
  const next = await stampOf(path)
  // 纪律 17：自写回声。判据与表都在 L2 的接缝里（`createSelfWriteLog`）——
  // **claim 是消费型**：一条自写只挡一次回声，所以挡住之后顺手把印记推平，
  // 免得同一次写的第二个事件还要靠下面的印记守卫再赌一次。
  // 「一次写 = 恰好一个事件」这条前提已在真管线上实证（20/20，170 §1.5 集成一节）。
  if (claimSelfWrite(next)) {
    stamp = next
    return
  }
  // 事件到了但印记没变（chokidar 有时会为一次写抛两条 change）——不惊动纸。
  if (kind === 'changed' && next !== null && stamp !== null && reconcileKind(stamp, next) === null) return
  stamp = next
  emit({ type: 'external-change', path, kind, source: 'watcher' })
}

/**
 * 这次变更是不是我们自己写的？
 *
 * 指纹三件套一件都不能少（L2 接缝语义）：**realpath + mtime + size**。
 * 文件已经不在了（拿不到印记）就没法比指纹——自己删的那条由「谁在动手」那侧收尾
 * （见 `services/files.ts` 的长注释），这里放行。
 */
function claimSelfWrite(fingerprint: FileStamp | null): boolean {
  if (fingerprint === null || realPage === null) return false
  const log = options.selfWrites?.() ?? null
  if (log === null) return false
  return log.claim({ path: realPage, mtimeMs: fingerprint.mtimeMs, size: fingerprint.size })
}

/**
 * focus 对账（架构 §4.9 的兜底半边）。**降级态下这是唯一的眼睛**，
 * 所以它不依赖 watcher 的任何状态，自己 stat 自己比。
 */
export async function reconcile(): Promise<void> {
  if (currentPage === null) return
  const path = currentPage
  const current = await stampOf(path)
  const kind = reconcileKind(stamp, current)
  if (kind === null) return
  if (claimSelfWrite(current)) {
    stamp = current
    return
  }
  stamp = current
  emit({ type: 'external-change', path, kind, source: 'reconcile' })
}

/** 自写落盘后刷新印记：不刷的话下一次 focus 对账会把自己的保存当成外部变更。 */
export async function refreshStamp(path: string): Promise<void> {
  if (currentPage !== path) return
  stamp = await stampOf(path)
}

export async function stopWatcher(): Promise<void> {
  for (const entry of merging.values()) clearTimeout(entry.timer)
  merging.clear()
  const instance = watcher
  watcher = null
  watchedDir = null
  await instance?.close().catch(() => undefined)
}

/** 只给测试用：把模块态清回初始，免得用例之间互相污染。 */
export async function resetWatcher(): Promise<void> {
  await stopWatcher()
  listeners.clear()
  currentPage = null
  realPage = null
  stamp = null
  mode = 'watching'
  degradedTold = false
  options = {}
}

/** 只给测试与 smoke 用：模拟 watcher 整体失效，验证降级后 focus 对账仍工作（检查 9）。 */
export function forceDegrade(reason = 'forced'): void {
  degrade(reason)
}
