import { useEffect, useState } from 'react'

import { highlight } from './highlighter.ts'

// 流式预览：把**还没写完**的 markdown 渲染得像写完了一样。
//
// 四条稳定性不变量里的「结构块绝不闪 raw」由这里负责（另外三条在 core 的 reveal）：
// 流到一半的 ` ```ts ` 若原样上屏，用户会看见三个反引号先出现、再突然变成代码块——
// 那一下闪烁比慢半拍难受得多。`remend` 做的就是补全未闭合语法。
//
// **为什么是 remend 而不是 streamdown**（§1.8 风险 1）：streamdown 的视觉层全是
// Tailwind 工具类，而本项目没有 Tailwind、也已裁定用 `var(--sepia-*)`。
// 而 T-14 真正难的那半——补全未闭合语法——恰恰是独立零依赖包 `remend` 干的，
// streamdown 只是它的消费者。于是取解析、揭示自画。

interface Block {
  kind: 'text' | 'code'
  text: string
  lang?: string
}

/** remend 补全后按围栏切块。只认围栏代码块——其余按文本走（D 类不渲染）。 */
function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const pattern = /```(\w*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    if (match.index > last) blocks.push({ kind: 'text', text: markdown.slice(last, match.index) })
    blocks.push({ kind: 'code', text: match[2] ?? '', lang: match[1] || 'text' })
    last = pattern.lastIndex
  }
  if (last < markdown.length) blocks.push({ kind: 'text', text: markdown.slice(last) })
  return blocks
}

export function StreamPreview({ text }: { text: string }): React.JSX.Element {
  const [completed, setCompleted] = useState(text)

  // remend 惰性加载：它零依赖、很小，但没必要进启动路径。
  useEffect(() => {
    let alive = true
    void import('remend').then(({ default: remend }) => {
      if (alive) setCompleted(remend(text))
    })
    return () => {
      alive = false
    }
  }, [text])

  return (
    <div className="sepia-markup-preview">
      {splitBlocks(completed).map((block, index) =>
        block.kind === 'code' ? (
          <CodeBlock key={`code-${index}`} code={block.text} lang={block.lang ?? 'text'} />
        ) : (
          // remend 给未闭合链接补的是哨兵 URL，别让它出现在人眼前
          <span key={`text-${index}`}>{block.text.replace(/\(streamdown:incomplete-link\)/g, '')}</span>
        ),
      )}
    </div>
  )
}

/**
 * 代码块。**自己渲染 `<pre>`**——Shiki 的 `codeToHtml` 会把 `theme.fg/bg` 以字面 hex
 * 写进根节点（实测，§1.8 风险 2），而那正好是纪律 3 不许出现的东西。
 * 取 token 自己画，外壳的颜色就还是 `var(--sepia-*)`。
 */
function CodeBlock({ code, lang }: { code: string; lang: string }): React.JSX.Element {
  const [tokens, setTokens] = useState<Array<Array<{ content: string; color?: string }>> | null>(null)

  useEffect(() => {
    let alive = true
    void highlight(code, lang).then((result) => {
      if (alive) setTokens(result)
    })
    return () => {
      alive = false
    }
  }, [code, lang])

  // 高亮没就绪（或语言不支持）就先按纯文本显示——**绝不等**。
  // 等高亮才上屏，等于把「首 token 即上屏」让给了一个装饰性的东西。
  if (tokens === null) return <pre className="sepia-markup-code">{code}</pre>

  return (
    <pre className="sepia-markup-code">
      {tokens.map((line, lineIndex) => (
        <span key={`line-${lineIndex}`}>
          {line.map((token, tokenIndex) => (
            <span key={`token-${tokenIndex}`} style={{ color: token.color }}>
              {token.content}
            </span>
          ))}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}
