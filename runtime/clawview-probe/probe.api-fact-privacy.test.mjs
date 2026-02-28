import test from "node:test";
import assert from "node:assert/strict";

import { __test } from "./probe.mjs";

const NOW_MS = Date.parse("2026-02-28T12:00:00.000Z");

function buildFact(overrides = {}) {
  return {
    ts: "2026-02-28T11:58:00.000Z",
    provider: "telegram",
    method: "POST",
    host: "api.telegram.org",
    path_template: "/bot:id/sendmessage",
    endpoint_group: "message_send",
    status_code: 200,
    latency_ms: 42,
    is_429: false,
    is_failure: false,
    dedupe_key: "dedupe-key-1",
    ...overrides,
  };
}

test("normalizeApiFactEvent accepts strict metadata-only payload", () => {
  const normalized = __test.normalizeApiFactEvent(buildFact());
  assert.equal(normalized.reason, "ok");
  assert.equal(normalized.event?.provider, "telegram");
  assert.equal(normalized.event?.method, "POST");
  assert.equal(normalized.event?.path_template, "/bot:id/sendmessage");
  assert.equal(normalized.event?.is_429, false);
});

test("privacy regression: email/token/bearer/cookie patterns are rejected", () => {
  const emailEvent = __test.normalizeApiFactEvent(buildFact({ path_template: "/users/alice@example.com/send" }));
  assert.equal(emailEvent.reason, "sensitive");

  const bearerEvent = __test.normalizeApiFactEvent(
    buildFact({ request_id: "Bearer sk-very-secret-token" }),
  );
  assert.equal(bearerEvent.reason, "sensitive");

  const cookieEvent = __test.normalizeApiFactEvent(
    buildFact({ request_id: "cookie=session=abcDEF123456" }),
  );
  assert.equal(cookieEvent.reason, "sensitive");

  assert.equal(__test.containsSensitiveApiFactValue("hello@example.com"), true);
  assert.equal(__test.containsSensitiveApiFactValue("Authorization: Bearer sk-very-secret-token"), true);
  assert.equal(__test.containsSensitiveApiFactValue("/v1/messages/send"), false);
});

test("normalizeApiFactEvent rejects non-whitelist keys", () => {
  const normalized = __test.normalizeApiFactEvent({
    ...buildFact(),
    headers: {
      authorization: "Bearer should-never-pass",
    },
  });
  assert.equal(normalized.reason, "sensitive");
  assert.equal(normalized.event, null);
});

test("computeApiMetricsFromFactEvents exposes unknown rate", () => {
  const events = [
    {
      ...buildFact({
        ts: "2026-02-28T11:40:00.000Z",
        dedupe_key: "a",
      }),
      ts_ms: Date.parse("2026-02-28T11:40:00.000Z"),
    },
    {
      ...buildFact({
        ts: "2026-02-28T11:50:00.000Z",
        provider: "unknown",
        endpoint_group: "unknown",
        dedupe_key: "b",
      }),
      ts_ms: Date.parse("2026-02-28T11:50:00.000Z"),
    },
  ];

  const metrics = __test.computeApiMetricsFromFactEvents(events, NOW_MS, true, {
    validFactCount: 2,
    sensitiveDropped: 0,
    invalidDropped: 0,
  });

  assert.equal(metrics.api_call_total_24h, 2);
  assert.equal(metrics.api_unknown_rate_24h, 0.5);
  assert.equal(metrics.api_collection_mode, "fact-event-structured");
});
