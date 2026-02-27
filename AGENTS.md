# AGENTS.md (ClawView repo)

在本仓库开发前，先阅读 `project.md`。

## Required startup context
1. 先读：`project.md`
2. 再读：`docs/clawview/clawview-v1-prd.md`、`docs/clawview/clawview-v1-fields.md`、`docs/clawview/plan.md`
3. 保持 MVP 边界：Display-only，不做反控能力。

## Repo routing
- 前端改动：`web/src/**`
- 采集/同步改动：`runtime/clawview-probe/**`
- Hook 改动：`runtime/hooks/clawview-probe/**`
- Insforge function 草稿：`runtime/insforge-functions/**`
