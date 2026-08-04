# patches/ —— 对 vendor/opencode 的可审计偏离

**当前：零 patch。** 目录先建，是因为它守的路必须先修好（140 §1.1 问题三）：
偏离上游按成本递增的阶梯选手段——配置层（vite `resolveId`、env）→ 构建脚本层 →
**patch 文件（这里）** → fork 分支 + rebase（架构 §4.1）。

规则（`check:patches` 强制）：

1. patch 一律放本目录，命名 `NNN-<slug>.patch`，按字典序应用
2. `build-engine.ts` 先 `git apply --check`，**硬失败、不静默跳过**
3. 绝不在 submodule 里直接改并提交（会丢或变成游离提交）
4. 每次升 tag，全部 patch 必重验
5. 非平凡 patch 累积到一定规模改用 fork 分支——git 三方合并比 patch 文件健壮
