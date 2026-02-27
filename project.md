# ClawView 项目上下文（给 Agent 开发用）

> 说明：本文件是简版入口；详细开发地图见 `docs/clawview/ai-sitemap.md`。

## 1) 这是一个什么项目
- 项目名：**ClawView**
- 定位：**OpenClaw 的 Display-only 运行态观测看板**（只展示，不反向控制）
- 主要链路：
  - Hook 触发采集
  - 本地标准化/脱敏
  - 推送到 Insforge 后端
  - 前端从后端聚合接口读取并展示

## 2) 前端代码在哪里
- 前端根目录：`web/`
- 主要代码目录：`web/src/`
- 关键入口：
  - `web/src/App.tsx`
  - `web/src/services/`
  - `web/src/types/`

## 3) 后端/采集代码在哪里
### 3.1 本地采集与同步（runtime）
- Probe：`runtime/clawview-probe/probe.mjs`
- Outbound Sync：`runtime/clawview-probe/sync-outbound.mjs`
- Hook Handler：`runtime/hooks/clawview-probe/handler.ts`
- Hook Manifest：`runtime/hooks/clawview-probe/HOOK.md`
- P0 状态计算：`runtime/clawview-probe/p0-core-status.mjs`

### 3.2 Insforge Function（仓库内草稿）
- Dashboard function：`runtime/insforge-functions/clawview-dashboard/index.mjs`
- 说明文档：`runtime/insforge-functions/clawview-dashboard/README.md`

### 3.3 已联调 ingest 端点
- `https://e57s6mh4.ap-southeast.insforge.app/functions/clawview-ingest`

## 4) GitHub 地址
- 仓库：`https://github.com/victorGPT/ClawView`

## 5) 后端技术栈
- Node.js (ESM)
- Insforge Functions
- Insforge Postgres
- MCP（insforge2）用于部署/SQL 校验

## 6) 当前开发约束（务必遵守）
1. MVP 聚焦 Display-only，不扩 Scope。
2. 指标口径遵循 docs/clawview 三文档（PRD/fields/plan）。
3. 隐私优先：白名单字段 + 本地脱敏 + TLS。
4. Insforge 配置使用单组 URL+key（不扩散多套 key）。
5. 变更前先确认“改前端/改采集/改函数”属于哪一层，再动手。

## 7) 文档 SoT（单一事实源）
- `docs/clawview/clawview-v1-prd.md`
- `docs/clawview/clawview-v1-fields.md`
- `docs/clawview/plan.md`
- `docs/clawview/hook-runtime-v1.md`
- `docs/clawview/runtime-signal-baseline.md`
