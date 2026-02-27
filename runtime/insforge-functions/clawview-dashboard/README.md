# clawview-dashboard (Insforge Function)

Path: `/Users/farmer/.openclaw/workspace/repos-main/ClawView/runtime/insforge-functions/clawview-dashboard/index.mjs`

## Purpose
Provide `GET` dashboard read model for ClawView frontend with **single URL + single key** integration.

Frontend tries:
1. `/api/v1/clawview/dashboard`
2. `/functions/clawview-dashboard` (fallback)

## Runtime env
Required:
- `INSFORGE_BASE_URL`
- `INSFORGE_SERVICE_ROLE_KEY`

Optional:
- `CLAWVIEW_TENANT_ID` (default `default`)
- `CLAWVIEW_PROJECT_ID` (default `openclaw`)

## Data sources (table candidates)
- snapshots: `clawview_snapshots` -> fallback `snapshots`
- api events: `clawview_api_events` -> fallback `api_events`

If tables/fields are missing, function still returns contract with `Gap` metrics (`--`, `数据未接入`).

## Local sanity
```bash
node --check runtime/insforge-functions/clawview-dashboard/index.mjs
```

## Expected endpoint
`GET /functions/clawview-dashboard?profile=desktop&tz=Asia/Tokyo&locale=zh-CN`

