// ui 是叶子：**不知道领域，也不认识 CopyKey**（`ui ↮ core` 刻意不连线）。
// 所以文案由 app 侧解好了当 props 传进来，这里只收字符串。

export interface LoadingProps {
  /** 已经解析成人话的文案。ui 不做 key → 文案的翻译，那是 core/copy 的活。 */
  label: string
}

export function Loading({ label }: LoadingProps): React.JSX.Element {
  return (
    <div className="sepia-loading" role="status" aria-live="polite">
      {label}
    </div>
  )
}
