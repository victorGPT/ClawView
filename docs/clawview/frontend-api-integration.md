# ClawView 前端接口文档（InsForge 联调）

- 版本：v1
- 目标：给前端/后端联调时统一接口口径（单 URL + 单 Key）
- 前端代码入口：`/Users/farmer/.openclaw/workspace/repos-main/ClawView/web/src/services/dashboard-from-insforge.ts`

## 1. 接入方式（固定）

前端走 **函数聚合接口**，不再直接读 `database/records/*`。

环境变量（仅 2 个）：

```bash
VITE_INSFORGE_BASE_URL=https://<backend-id>.<region>.insforge.app
VITE_INSFORGE_ANON_KEY=<single-key>
```

## 2. 前端请求路径（当前实现）

按顺序尝试：

1. `GET /api/v1/clawview/dashboard`
2. `GET /functions/clawview-dashboard`

请求参数：
- `profile=desktop|mobile`
- `tz=Asia/Tokyo`
- `locale=zh-CN`

请求头：
- `Authorization: Bearer <VITE_INSFORGE_ANON_KEY>`
- `apikey: <VITE_INSFORGE_ANON_KEY>`

> 说明：前端只认一组 baseUrl + key，不要求额外 key。

## 3. 返回契约映射

以 `docs/clawview/clawview-v1-api-contract.md` 为主：
- `meta`
- `health_overview`
- `trends`
- `skill_summary`
- `cron_summary`
- `api_summary`

前端已兼容 snake_case/camelCase 字段名，优先读取契约字段。

## 4. Gap 与兜底规则

当函数接口不可用（404/5xx）时：
1. 前端自动 fallback 到 `web/src/mock/dashboard.ts`
2. Gap 字段统一：
   - `value = null`
   - `display = "--"`
   - `note = "数据未接入"`

## 5. 当前联调结论（2026-02-27）

在当前后端（`e57s6mh4.ap-southeast.insforge.app`）上实测：
- `/functions/clawview-ingest` 已存在（仅支持 `POST` ingest）
- `/api/v1/clawview/dashboard` 当前未就绪
- `/functions/clawview-dashboard` 当前未就绪

因此下一步最小改动：
1. 后端新增并部署 `clawview-dashboard`（或实现 `/api/v1/clawview/dashboard`）
2. 返回结构按 `clawview-v1-api-contract.md`
3. 前端无需新增任何 key，即可切真数据


## 6. 后端函数实现位置（已补）

已在仓库补充函数实现稿：
- `/Users/farmer/.openclaw/workspace/repos-main/ClawView/runtime/insforge-functions/clawview-dashboard/index.mjs`
- `/Users/farmer/.openclaw/workspace/repos-main/ClawView/runtime/insforge-functions/clawview-dashboard/README.md`

该函数返回 `clawview-v1-api-contract` 所需结构，并在缺失数据时输出 Gap 指标，保证前端可继续渲染。
