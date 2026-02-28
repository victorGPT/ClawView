import test from "node:test";
import assert from "node:assert/strict";

import { __test } from "./probe.mjs";

test("normalizeApiFactEvent maps legacy other/others to unknown", () => {
  const normalized = __test.normalizeApiFactEvent({
    ts: "2026-02-28T11:00:00.000Z",
    provider: "other",
    endpoint_group: "others",
    method: "post",
    host: "example.com",
    path_template: "/v1/messages/send",
    status_code: 429,
    is_429: true,
    is_failure: true,
    dedupe_key: "abc",
  });

  assert.equal(normalized.reason, "ok");
  assert.equal(normalized.event?.provider, "unknown");
  assert.equal(normalized.event?.endpoint_group, "unknown");
  assert.equal(normalized.event?.method, "POST");
  assert.equal(normalized.event?.is_429, true);
  assert.equal(normalized.event?.is_failure, true);
});

test("computeApiMetricsFromFactEvents returns ratios and unknown_rate from fact stream", () => {
  const nowMs = Date.parse("2026-02-28T12:00:00.000Z");
  const events = [
    {
      ts: "2026-02-28T11:00:00.000Z",
      ts_ms: Date.parse("2026-02-28T11:00:00.000Z"),
      provider: "unknown",
      method: "POST",
      host: "api.unknown.test",
      path_template: "/v1/unknown",
      endpoint_group: "unknown",
      status_code: 429,
      latency_ms: 120,
      is_429: true,
      is_failure: true,
      dedupe_key: "k-1",
    },
    {
      ts: "2026-02-28T10:30:00.000Z",
      ts_ms: Date.parse("2026-02-28T10:30:00.000Z"),
      provider: "lark",
      method: "POST",
      host: "open.feishu.cn",
      path_template: "/open-apis/im/v1/messages/:id/send",
      endpoint_group: "message_send",
      status_code: 200,
      latency_ms: 42,
      is_429: false,
      is_failure: false,
      dedupe_key: "k-2",
    },
    {
      ts: "2026-02-28T10:00:00.000Z",
      ts_ms: Date.parse("2026-02-28T10:00:00.000Z"),
      provider: "lark",
      method: "POST",
      host: "open.feishu.cn",
      path_template: "/open-apis/im/v1/messages/:id/send",
      endpoint_group: "message_send",
      status_code: 500,
      latency_ms: 55,
      is_429: false,
      is_failure: true,
      dedupe_key: "k-3",
    },
  ];

  const metrics = __test.computeApiMetricsFromFactEvents(events, nowMs, true);

  assert.equal(metrics.api_metrics_available, true);
  assert.equal(metrics.api_collection_mode, "fact-event-structured");
  assert.equal(metrics.api_call_total_24h, 3);
  assert.equal(metrics.api_failure_total_24h, 2);
  assert.equal(metrics.api_rate_limit_total_24h, 1);
  assert.equal(metrics.api_error_rate_24h, 2 / 3);
  assert.equal(metrics.api_429_ratio_24h, 1 / 3);
  assert.equal(metrics.api_unknown_rate_24h, 1 / 3);
  assert.equal(metrics.endpoint_group_top5_calls_24h?.[0]?.endpoint_group, "lark/message_send");
  assert.equal(metrics.endpoint_group_top5_calls_24h?.[0]?.calls_24h, 2);
});

test("computeApiMetricsFromFactEvents stays GAP when fact stream is not connected", () => {
  const nowMs = Date.parse("2026-02-28T12:00:00.000Z");
  const metrics = __test.computeApiMetricsFromFactEvents([], nowMs, false);

  assert.equal(metrics.api_metrics_available, false);
  assert.equal(metrics.api_collection_mode, "fact-only-not-connected");
  assert.equal(metrics.api_call_total_24h, null);
  assert.equal(metrics.api_unknown_rate_24h, null);
  assert.equal(metrics.endpoint_group_top5_calls_24h, null);
});
