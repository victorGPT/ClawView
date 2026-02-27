# ClawView 前端接口文档（InsForge 联调）

- 版本：v1
- 目标：给本地数据 AI/后端同学对接前端展示口径
- 前端代码入口：`web/src/services/dashboard-from-insforge.ts`

## 1. 接入方式

前端不走自建 BFF，直接通过 `@insforge/sdk` 读取数据库表。

环境变量：

```bash
VITE_INSFORGE_BASE_URL=https://<backend-id>.<region>.insforge.app
VITE_INSFORGE_ANON_KEY=<anon-jwt>
```

SDK 初始化：

```ts
import { createClient } from '@insforge/sdk';

export const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_BASE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
});
```

## 2. 前端实际查询（当前实现）

并发 4 个查询：

1. `crawl_runs`（Rolling 24h）
- select: `site_id,status,started_at,finished_at,error,items_found,items_inserted`
- filter: `started_at >= now-24h`
- order: `started_at asc`
- limit: `2000`

2. `crawl_runs`（Tokyo 当日）
- select: `site_id,status,started_at`
- filter: `started_at >= tokyo_day_start`
- order: `started_at asc`
- limit: `2000`

3. `site_state`
- select: `site_id,next_run_at,last_run_at,last_success_at,last_error,consecutive_failures`
- order: `site_id asc`
- limit: `1000`

4. `crawl_items`
- select: `source,status,updated_at`
- order: `updated_at desc`
- limit: `5000`

## 3. 字段映射（UI <- DB）

### 3.1 Health Overview

- `restartUnexpected24h` = `crawl_runs` 中 `status != 'success'` 的条数
- `activeErrorCount` = `site_state` 中 `consecutive_failures > 0 OR last_error is not null` 的条数
- `lastRestartAt` = 最近一条失败 run 的 `started_at`（Tokyo 时区格式化）
- `lastRestartReason` = 最近一条失败 run 的 `error`
- `api429Ratio24h` = 目前无稳定源，展示 `Gap(--, 数据未接入)`

### 3.2 Trend

- `Cron 触发（24h）` = `crawl_runs.started_at` 在滚动 24h 内按 10 桶聚合
- `API 调用 / 限速趋势` = 占位趋势（用于布局联调），真实口径待 API 聚合链路补齐

### 3.3 Skill Summary

- `totalSkills` = `crawl_items.source` 去重计数
- `healthySkills` = `totalSkills - activeErrorCount`（下限 0）
- `calls24h` = Rolling 24h 内 `crawl_runs` 行数
- `callsTokyoToday` = Tokyo 当日 `crawl_runs` 行数
- `top` = `crawl_items` 按 `source` 计数降序 TopN

### 3.4 Cron Summary

- `totalTasks` = `site_state` 行数
- `enabledTasks` = `site_state.next_run_at != null` 行数
- `triggerTotal24h` = Rolling 24h 内 `crawl_runs` 行数
- `triggerTokyoToday` = Tokyo 当日 `crawl_runs` 行数
- `riskTop` = `site_state` 按 `consecutive_failures` 降序 TopN
- `riskLevel` 规则：
  - `red`: `consecutive_failures >= 3`
  - `yellow`: `consecutive_failures >= 1` 或 `last_error` 非空
  - `green`: 其他

### 3.5 API Summary

- `callTotal24h` = Rolling 24h `sum(crawl_runs.items_found)`
- `callTokyoToday` = Tokyo 当日 `crawl_runs` 行数（当前实现）
- `errorRate24h` / `throttleRate24h` / `endpointTop` = `Gap(--, 数据未接入)`

## 4. Gap 与兜底规则

当后端不可用或鉴权失败时：

1. 前端自动 fallback 到 `web/src/mock/dashboard.ts`
2. 所有 Gap 字段按统一格式展示：
- `value = null`
- `display = "--"`
- `note = "数据未接入"`

## 5. 对接方待补齐项（本地数据 AI）

为达成完整口径，建议补充以下可查询数据：

1. API 调用明细（含 endpoint_group、status_code、调用时间）
2. 429 与等价限流错误归一化字段
3. API 错误率可直接计算口径
4. endpoint_group TopN 的稳定聚合视图

补齐后可把 `API Trend` 与 `API Summary` 从占位改为真实值。
