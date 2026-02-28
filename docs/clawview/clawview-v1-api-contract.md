# ClawView v1 API Contract (Display-Only)

- Version: `v1`
- Status: `Draft for implementation`
- Date: `2026-02-27`
- Source of truth: `docs/clawview/clawview-v1-fields.md`, `docs/clawview/clawview-v1-prd.md`, `docs/clawview/plan.md`

## 1. Scope
This contract serves the v1 dashboard read model only (desktop + mobile), no write/control actions.

In scope:
- Health overview
- Trigger/API trends
- Skill/Cron/API summaries
- Error visibility
- Data quality strip (including recent restart fields)

Out of scope:
- Pause task / restart service / config mutation
- Full detail pages data model (can be separate contracts)

## 2. Global Rules

1. Time windows:
- Primary: `rolling_24h`
- Secondary: `tokyo_today` (`Asia/Tokyo` 00:00-23:59)

2. Freshness target:
- Dashboard delay should be `<= 15 min` in normal condition.

3. Data readiness gate:
- `Ready`: stable source
- `Derived`: aggregated from stable events
- `Gap`: unstable or missing source

4. Gap rendering rule:
- Any `Gap` metric must return:
  - `value = null`
  - `display = "--"`
  - `note = "数据未接入"`
- Homepage must not fake numeric values for `Gap`.

5. Privacy/export baseline:
- Allowed outbound (metadata-only):
  - `ts`
  - `provider`
  - `method`
  - `host`
  - `path_template`
  - `endpoint_group`
  - `status_code`
  - `latency_ms`
  - `is_429`
  - `is_failure`
  - `dedupe_key`
  - `request_id` (optional)
- Forbidden outbound: message body/request body/response body/token/cookie/auth header/raw URL query

## 3. Endpoint

## 3.1 GET `/api/v1/clawview/dashboard`
Returns dashboard view-model for desktop/mobile.

Query params:
- `profile`: `desktop | mobile` (default `desktop`)
- `tz`: default `Asia/Tokyo` (v1 only supports this timezone)
- `locale`: default `zh-CN`

TopN behavior by `profile`:
- `desktop`: `skill=6`, `cron=5`, `api=5`
- `mobile`: `skill=5`, `cron=3`, `api=3`

### 3.1.1 Success response (`200`)

```json
{
  "meta": {
    "contract_version": "v1",
    "generated_at": "2026-02-27T09:30:00+09:00",
    "data_updated_at": "2026-02-27T09:28:00+09:00",
    "freshness_delay_min": {
      "readiness": "Derived",
      "value": 2,
      "display": "2 分钟"
    },
    "integrity_status": {
      "readiness": "Derived",
      "value": "partial",
      "display": "部分缺失"
    },
    "window": {
      "primary": "rolling_24h",
      "secondary": "tokyo_today",
      "timezone": "Asia/Tokyo",
      "display": "Rolling 24h / Tokyo 当日"
    },
    "p0_core_coverage_ratio": {
      "readiness": "Derived",
      "value": 0.636,
      "display": "63.6%"
    },
    "topn": {
      "skill": 6,
      "cron": 5,
      "api": 5
    }
  },
  "health_overview": {
    "service_status_now": {
      "readiness": "Ready",
      "value": "running",
      "display": "运行中"
    },
    "service_uptime_ratio_24h": {
      "readiness": "Derived",
      "value": 0.998,
      "display": "99.8%"
    },
    "restart_total_24h": {
      "readiness": "Derived",
      "value": 2,
      "display": "2"
    },
    "restart_planned_24h": {
      "readiness": "Derived",
      "value": 1,
      "display": "1"
    },
    "restart_unexpected_count_24h": {
      "readiness": "Derived",
      "value": 1,
      "display": "1"
    },
    "restart_unknown_24h": {
      "readiness": "Derived",
      "value": 0,
      "display": "0"
    },
    "last_restart_at": {
      "readiness": "Derived",
      "value": null,
      "display": "--"
    },
    "last_restart_reason": {
      "readiness": "Derived",
      "value": null,
      "display": "--"
    },
    "active_error_count": {
      "readiness": "Derived",
      "value": 7,
      "display": "7"
    },
    "api_429_ratio_24h": {
      "readiness": "Gap",
      "value": null,
      "display": "--",
      "note": "数据未接入"
    }
  },
  "trends": {
    "trigger_total_24h": {
      "readiness": "Ready",
      "value": 2104,
      "display": "2,104"
    },
    "trigger_series_24h": [
      { "ts": "2026-02-26T10:00:00+09:00", "value": 12 },
      { "ts": "2026-02-26T11:00:00+09:00", "value": 15 }
    ],
    "api_calls_series_24h": {
      "readiness": "Gap",
      "series": [],
      "display": "--",
      "note": "数据未接入"
    },
    "api_429_series_24h": {
      "readiness": "Gap",
      "series": [],
      "display": "--",
      "note": "数据未接入"
    }
  },
  "skill_summary": {
    "total_skills": {
      "readiness": "Ready",
      "value": 23,
      "display": "23"
    },
    "healthy_skills": {
      "readiness": "Derived",
      "value": 21,
      "display": "21"
    },
    "calls_24h": {
      "readiness": "Derived",
      "value": 4218,
      "display": "4,218"
    },
    "calls_tokyo_today": {
      "readiness": "Derived",
      "value": 3102,
      "display": "3,102"
    },
    "top": [
      {
        "skill_name": "lark_channel_sync",
        "calls_24h": 1247,
        "readiness": "Derived"
      }
    ]
  },
  "cron_summary": {
    "total_tasks": {
      "readiness": "Ready",
      "value": 47,
      "display": "47"
    },
    "enabled_tasks": {
      "readiness": "Ready",
      "value": 38,
      "display": "38"
    },
    "trigger_total_24h": {
      "readiness": "Ready",
      "value": 2104,
      "display": "2,104"
    },
    "trigger_total_tokyo_today": {
      "readiness": "Ready",
      "value": 1847,
      "display": "1,847"
    },
    "trigger_storm_task_top5_5m": {
      "readiness": "Derived",
      "top": [
        {
          "task_name": "lark_sync_channel",
          "count": 342,
          "risk_level": "red"
        }
      ]
    }
  },
  "api_summary": {
    "api_call_total_24h": {
      "readiness": "Gap",
      "value": null,
      "display": "--",
      "note": "数据未接入"
    },
    "api_call_total_tokyo_today": {
      "readiness": "Gap",
      "value": null,
      "display": "--",
      "note": "数据未接入"
    },
    "api_error_rate_24h": {
      "readiness": "Gap",
      "value": null,
      "display": "--",
      "note": "数据未接入"
    },
    "api_429_ratio_24h": {
      "readiness": "Gap",
      "value": null,
      "display": "--",
      "note": "数据未接入"
    },
    "api_unknown_rate_24h": {
      "readiness": "Gap",
      "value": null,
      "display": "--",
      "note": "数据未接入"
    },
    "endpoint_group_top": {
      "readiness": "Gap",
      "top": [],
      "display": "--",
      "note": "数据未接入"
    }
  },
  "error_summary": {
    "active_error_count": {
      "readiness": "Derived",
      "value": 7,
      "display": "7"
    },
    "error_fingerprint_top10_24h": {
      "readiness": "Derived",
      "top": [
        {
          "fingerprint": "E_CONN_RESET",
          "count": 15,
          "first_seen_at": "2026-02-26T15:30:00+09:00",
          "last_seen_at": "2026-02-27T09:20:00+09:00"
        }
      ]
    },
    "error_growth_1h": {
      "readiness": "Derived",
      "value": 3,
      "display": "+3"
    }
  },
  "gaps": [
    {
      "field": "api_call_total_24h",
      "path": "api_summary.api_call_total_24h",
      "reason": "provider logs unstable"
    },
    {
      "field": "endpoint_group_top5_calls_24h",
      "path": "api_summary.endpoint_group_top",
      "reason": "endpoint_group aggregation unstable"
    }
  ]
}
```

### 3.1.2 Error response (`4xx/5xx`)

```json
{
  "error": {
    "code": "CLAWVIEW_DATA_SOURCE_UNAVAILABLE",
    "message": "failed to load snapshot",
    "trace_id": "3d8c16f7cc3e4f27",
    "retryable": true,
    "details": []
  }
}
```

## 4. Data Types

`MetricValue` object:
- `readiness`: `Ready | Derived | Gap`
- `value`: `number | string | null`
- `display`: `string`
- `note?`: `string` (required for `Gap`)

`risk_level`:
- `green | yellow | red`

`integrity_status.value`:
- `full | partial | delayed`

`service_status_now.value`:
- `running | degraded | down`
- 判定口径（Probe v1.3）：
  - `down`: Gateway RPC 不可用
  - `degraded`: `restart_unexpected_count_24h > 0` 或 `errors_critical_active_count > 0`
  - `running`: 其余情况（通用 warn/error 不直接触发降级）

## 5. P0-Core Mapping (12)

| P0-Core metric | Response path |
|---|---|
| service_uptime_ratio_24h | `health_overview.service_uptime_ratio_24h` |
| service_status_now | `health_overview.service_status_now` |
| trigger_total_24h | `trends.trigger_total_24h` |
| trigger_storm_task_top5_5m | `cron_summary.trigger_storm_task_top5_5m` |
| api_call_total_24h | `api_summary.api_call_total_24h` |
| api_error_rate_24h | `api_summary.api_error_rate_24h` |
| api_429_ratio_24h | `api_summary.api_429_ratio_24h` |
| endpoint_group_top5_calls_24h | `api_summary.endpoint_group_top` |
| error_fingerprint_top10_24h | `error_summary.error_fingerprint_top10_24h` |
| restart_unexpected_count_24h | `health_overview.restart_unexpected_count_24h` |
| data_freshness_delay_min | `meta.freshness_delay_min` |
| p0_core_coverage_ratio | `meta.p0_core_coverage_ratio` |

## 6. Mobile Card Mapping (newly added card)

| Mobile label | Response path |
|---|---|
| 数据更新时间 | `meta.data_updated_at` |
| 数据完整性 | `meta.integrity_status` |
| 统计口径 | `meta.window.display` |
| 最近重启时间 | `health_overview.last_restart_at` |
| 最近重启原因 | `health_overview.last_restart_reason` |

## 7. HTTP and Cache

- Method: `GET`
- Auth: `Bearer token` (if enabled by deployment)
- Recommended cache: `Cache-Control: max-age=60, stale-while-revalidate=120`

Status codes:
- `200` success
- `400` invalid query
- `401` unauthorized
- `429` rate limited
- `500` internal error
- `503` upstream data source unavailable

## 8. Validation Checklist

Backend must satisfy before FE switch to real API:
1. All `Gap` fields follow `value=null/display="--"/note="数据未接入"`.
2. `profile=desktop/mobile` returns correct TopN limits.
3. `meta.window.display` is always `Rolling 24h / Tokyo 当日`.
4. `endpoint_group_top` never returns raw URL paths.
5. `trace_id` exists in every non-200 error.
