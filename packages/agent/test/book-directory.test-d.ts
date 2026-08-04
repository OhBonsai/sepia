import { asBookDirectory, type BookDirectory } from '@sepia/core'

import type { AgentBridge } from '../src/index.ts'

// 纪律 10 的**类型层断言**（140 §1.4 #1）。这个文件不跑，只被 tsc 检查。
//
// 为什么必须有它：反向验证实测发现，只靠生产代码是守不住品牌类型的——
// 把 `BookDirectory` 放宽成 `string` 之后 typecheck 照样全绿，因为生产路径上
// 每一处都经 `asBookDirectory` 构造，没有任何一处拿裸 string 去撞它。
// 「检查存在」不等于「检查有效」（002 §3.2 的口径），所以这里用 @ts-expect-error
// 把「裸 string 必须编译不过」本身变成断言：一旦类型被放宽，这些 @ts-expect-error
// 变成「无用的忽略」，tsc 立刻报错——检查从空转变回有效。

declare const bridge: AgentBridge

// @ts-expect-error 裸 string 不是 BookDirectory——类型上没有不带 directory 的调用方式
const widened: BookDirectory = '/tmp/book'
void widened

export async function directoryIsMandatory(): Promise<void> {
  const book = asBookDirectory('/tmp/book')

  // 正例：构造过的 BookDirectory 收得下
  await bridge.send('thread', [{ type: 'text', text: 'x' }], { directory: book })

  // @ts-expect-error 反例一：directory 传裸 string
  await bridge.send('thread', [{ type: 'text', text: 'x' }], { directory: '/tmp/book' })

  // @ts-expect-error 反例二：整个 options 缺席——纪律 10 的「每请求显式带 directory」
  await bridge.send('thread', [{ type: 'text', text: 'x' }])

  // @ts-expect-error 反例三：openThread 同样不收裸 string
  await bridge.openThread({ directory: '/tmp/book' })

  // @ts-expect-error 反例四：interrupt 同样不收裸 string
  await bridge.interrupt('thread', { directory: '/tmp/book' })
}
