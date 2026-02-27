# ClawView AI Sitemap（给 Agent 的项目地图）

> 目标：让任何 AI Agent 进入仓库后，快速知道“改哪里、用什么语言、按什么格式改”。

## A. 项目类型与边界
- 项目：**ClawView**
- 类型：OpenClaw 运行态观测看板（**Display-only**）
- 边界：不做反向控制，不做运维执行入口
- 当前阶段：MVP（优先可用，不追求一次 100% 完美）

## B. 技术栈（按层）
- 前端：TypeScript + React + Vite（目录：`web/`）
- 采集/同步：Node.js ESM（目录：`runtime/clawview-probe/`）
- Hook 触发：TypeScript（目录：`runtime/hooks/clawview-probe/`）
- 后端函数：Insforge Functions（目录：`runtime/insforge-functions/`）
- 数据库：Insforge Postgres
- 运维/部署查询：**insforge2 MCP**（SQL、函数部署、联调校验）

## C. 仓库 Sitemap（按职责）

### C1. 文档 SoT（先读）
1. `docs/clawview/clawview-v1-prd.md`（产品定义）
2. `docs/clawview/clawview-v1-fields.md`（字段口径）
3. `docs/clawview/plan.md`（执行计划）
4. `docs/clawview/hook-runtime-v1.md`（Hook 运行机制）
5. `docs/clawview/runtime-signal-baseline.md`（运行态基线）
6. `docs/clawview/ai-sitemap.md`（本文件，开发导航）

### C2. 前端目录（UI 相关只改这里）
- `web/src/App.tsx`：页面入口与布局
- `web/src/services/`：前端数据访问层（聚合接口调用）
- `web/src/types/`：类型定义
- `web/src/mock/`：本地 mock 数据

### C3. 采集与同步（数据上行）
- `runtime/clawview-probe/probe.mjs`：采样与指标聚合
- `runtime/clawview-probe/sync-outbound.mjs`：白名单+脱敏外发
- `runtime/clawview-probe/p0-core-status.mjs`：P0 覆盖检查
- `runtime/clawview-probe/sync-config.example.json`：外发配置模板

### C4. Hook 触发层
- `runtime/hooks/clawview-probe/HOOK.md`：Hook 声明（事件、能力）
- `runtime/hooks/clawview-probe/handler.ts`：触发与防抖逻辑

### C5. Insforge 后端函数草稿
- `runtime/insforge-functions/clawview-dashboard/index.mjs`
- `runtime/insforge-functions/clawview-dashboard/README.md`

## D. 外部地址
- GitHub：`https://github.com/victorGPT/ClawView`
- 已联调 ingest：`https://e57s6mh4.ap-southeast.insforge.app/functions/clawview-ingest`

## E. Agent 进入项目后的“文件队列”（推荐读取顺序）
1. `AGENTS.md`
2. `project.md`
3. `docs/clawview/clawview-v1-prd.md`
4. `docs/clawview/clawview-v1-fields.md`
5. `docs/clawview/plan.md`
6. 再按任务进入具体代码目录（web/ 或 runtime/）

## F. 文件格式约定（必须遵守）
- `.md`：中文优先、结构化标题、避免把临时聊天内容写入 SoT
- `.ts/.tsx`：类型优先，函数职责单一
- `.mjs`：Node ESM（不要混入 CJS `require`）
- `.json`：仅配置/状态，不放敏感明文到仓库

## G. 修改规范（Agent 执行模板）

### G1. 先判定改动类型
- 前端展示：改 `web/src/**`
- 采集逻辑：改 `runtime/clawview-probe/**`
- Hook 触发：改 `runtime/hooks/clawview-probe/**`
- 后端函数：改 `runtime/insforge-functions/**` + MCP 校验

### G2. 最小改动原则
- 一次只改一个层面（避免“前后端+文档”大杂烩）
- 变更必须可验证（给出命令和结果）

### G3. 文档同步原则
改动任何口径/字段/流程时，至少同步：
- `docs/clawview/clawview-v1-fields.md`（字段口径）
- `docs/clawview/plan.md`（执行状态）
- 必要时更新 `project.md` / `ai-sitemap.md`

### G4. 输出格式（给评审看的）
每次改动后，Agent 输出应包含：
1. 修改文件列表（完整路径）
2. 关键变更点（3~6 条）
3. 验证命令与结果
4. 风险与回滚点
5. 提交链接（若已 push）

## H. 当前硬约束
1. MVP 只做 Display-only。
2. Insforge 使用单组 URL + key。
3. 外发必须白名单字段 + 本地脱敏 + TLS。
4. 不把频道级临时指令写进全局 SoT。

