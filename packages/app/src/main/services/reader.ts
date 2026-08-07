import { net } from 'electron'

import type { IoResult } from '@sepia/core'

// 外链阅读模式（190 P5 / **D-39**）。
//
// **不是内嵌浏览器。** 190 P5 的任务描述写的是「右侧区 WebContentsView」，
// 那是 features F18 的旧描述；D-39（2026-08-03）已经把它否了，理由有三条，
// 每条都还成立：
//   ① iframe 会被 X-Frame-Options / CSP 拦掉相当一部分站点，且失败无法优雅检测；
//      原生视图则要处理浮层让位——两个问题阅读模式都不存在（main 抓取，无同源限制）
//   ② 气质：作者点开外链是要看**这篇文章说了什么**，不是要一个带广告和 cookie
//      横幅的浏览器挤进纸里
//   ③ 抽出的正文是 Sepia 可读的文本，**可以直接 `@` 进 markup 上下文**——
//      浏览器里的内容对 Sepia 永远是黑盒
//
// 抽取失败（SPA / 付费墙）时退回系统浏览器打开，这也是 D-39 写死的。

/** 去标签、收白，取一段可读正文。**不引 readability 库**：一个正则够用，而依赖是永久的。 */
function extract(html: string): { title: string; body: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
  const stripped = html
    // script/style/nav/footer 整块丢掉——它们是"页面"，不是"文章"
    .replaceAll(/<(script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<\/(p|div|section|article|li|h[1-6])>/gi, '\n\n')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/&nbsp;/g, ' ')
    .replaceAll(/&amp;/g, '&')
    .replaceAll(/&lt;/g, '<')
    .replaceAll(/&gt;/g, '>')
    .replaceAll(/&quot;/g, '"')
  const body = stripped
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n\n')
  return { title, body }
}

export interface ReaderResult {
  title: string
  body: string
  url: string
}

export async function readExternal(url: string): Promise<IoResult<ReaderResult>> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'only http(s)' }
  try {
    const response = await net.fetch(url, { redirect: 'follow' })
    if (!response.ok) return { ok: false, reason: `HTTP ${String(response.status)}` }
    const html = await response.text()
    const { title, body } = extract(html)
    // 抽不出东西 = 这页是个 SPA 或付费墙。**如实说抽不出**，让上层退回系统浏览器
    if (body.length < 200) return { ok: false, reason: 'unreadable' }
    return { ok: true, value: { title: title === '' ? url : title, body, url } }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
