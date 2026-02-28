#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const argv = process.argv.slice(2);

function hasFlag(flag) {
  return argv.includes(flag);
}

function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}

const outDir = argValue("--out-dir", path.join(os.homedir(), ".openclaw", "clawview-probe"));
const dayTag = new Date().toISOString().slice(0, 10);
const apiEventsPath = path.join(outDir, "api-events.jsonl");
const snapshotsPath = path.join(outDir, `snapshots-${dayTag}.jsonl`);
const syncCursorPath = path.join(outDir, "sync-cursor.json");

const syncUrl = process.env.CLAWVIEW_SYNC_URL || "";
const syncApiKey = process.env.CLAWVIEW_SYNC_API_KEY || "";
const syncHmacSecret = process.env.CLAWVIEW_SYNC_HMAC_SECRET || "";
const tenantId = process.env.CLAWVIEW_TENANT_ID || "default";
const projectId = process.env.CLAWVIEW_PROJECT_ID || "openclaw";
const batchSize = Math.max(1, Number(process.env.CLAWVIEW_SYNC_BATCH_SIZE || "200"));

const ALLOWED_API_EVENT_FIELDS = [
  "ts",
  "provider",
  "endpoint_group",
  "status_code",
  "is_failure",
  "is_rate_limited",
  "dedupe_key",
];

const ALLOWED_SNAPSHOT_FIELDS = [
  "ts",
  "timezone",
  "gateway_status",
  "service_status_now",
  "service_uptime_ratio_24h",
  "cron_runs_24h_total",
  "cron_runs_today_tokyo_total",
  "cron_storm_top5_5m",
  "api_call_total_24h",
  "api_call_total_today_tokyo",
  "api_error_rate_24h",
  "api_429_ratio_24h",
  "endpoint_group_top5_calls_24h",
  "errors_active_count",
  "restart_unexpected_count_24h",
  "data_freshness_delay_min",
  "p0_core_coverage_ratio",
  "probe_version",
  "api_collection_mode",
  "api_events_new_since_last",
  "api_events_retained",
  "skills_total",
  "healthy_skills",
  "skills_components",
  "skills_top_24h",
  "skill_calls_total_24h",
  "skill_calls_collection_mode",
  "skill_calls_files_scanned",
  "skill_calls_retained_24h",
  "cron_jobs_total",
  "cron_jobs_enabled",
];

function ensureDir() {
  fs.mkdirSync(outDir, { recursive: true });
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function signBody(bodyText) {
  if (!syncHmacSecret) return "";
  return crypto.createHmac("sha256", syncHmacSecret).update(bodyText).digest("hex");
}

function pickAllowedFields(input, allowedKeys) {
  const out = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      out[key] = input[key];
    }
  }
  return out;
}

function sanitizeApiEvent(ev) {
  return pickAllowedFields(ev, ALLOWED_API_EVENT_FIELDS);
}

function sanitizeSnapshot(snap) {
  return pickAllowedFields(snap, ALLOWED_SNAPSHOT_FIELDS);
}

function selectUnsentApiEvents(allEvents, cursor) {
  const lastTs = Number(cursor?.api_last_ts_ms || 0);
  const lastKeys = new Set(Array.isArray(cursor?.api_last_keys) ? cursor.api_last_keys : []);

  const sorted = [...allEvents].sort((a, b) => Number(a?.ts_ms || 0) - Number(b?.ts_ms || 0));
  const unsent = [];

  let maxTs = lastTs;
  let maxTsKeys = new Set(lastKeys);

  for (const ev of sorted) {
    const ts = Number(ev?.ts_ms || 0);
    const key = String(ev?.dedupe_key || "");
    if (!Number.isFinite(ts) || !key) continue;

    if (ts < lastTs) continue;
    if (ts === lastTs && lastKeys.has(key)) continue;

    unsent.push(ev);

    if (ts > maxTs) {
      maxTs = ts;
      maxTsKeys = new Set([key]);
    } else if (ts === maxTs) {
      maxTsKeys.add(key);
    }

    if (unsent.length >= batchSize) break;
  }

  return {
    unsent,
    nextCursor: {
      api_last_ts_ms: maxTs,
      api_last_keys: [...maxTsKeys].slice(-300),
    },
  };
}

async function postPayload(kind, payload) {
  if (!syncUrl) {
    return { ok: false, skipped: true, reason: "CLAWVIEW_SYNC_URL not set" };
  }

  const bodyObj = {
    kind,
    tenant_id: tenantId,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    payload,
  };

  const bodyText = JSON.stringify(bodyObj);
  const headers = {
    "content-type": "application/json",
  };

  if (syncApiKey) {
    headers["authorization"] = `Bearer ${syncApiKey}`;
  }

  const sig = signBody(bodyText);
  if (sig) {
    headers["x-clawview-signature"] = sig;
  }

  const res = await fetch(syncUrl, {
    method: "POST",
    headers,
    body: bodyText,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sync failed: HTTP ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }

  return { ok: true };
}

async function runOnce() {
  ensureDir();

  const cursor = readJson(syncCursorPath, {
    api_last_ts_ms: 0,
    api_last_keys: [],
    snapshot_last_ts: "",
  });

  const allApiEvents = readJsonl(apiEventsPath);
  const { unsent, nextCursor } = selectUnsentApiEvents(allApiEvents, cursor);
  const sanitizedApiEvents = unsent.map(sanitizeApiEvent);

  let sentApi = 0;
  let apiDelivered = false;
  if (sanitizedApiEvents.length > 0) {
    const apiRes = await postPayload("api_events", {
      items: sanitizedApiEvents,
      count: sanitizedApiEvents.length,
    });
    if (apiRes.ok) {
      sentApi = sanitizedApiEvents.length;
      apiDelivered = true;
    }
  }

  const snapshotRows = readJsonl(snapshotsPath);
  let sentSnapshot = false;
  if (snapshotRows.length > 0) {
    const latest = snapshotRows[snapshotRows.length - 1];
    const latestTs = String(latest?.ts || "");
    if (latestTs && latestTs !== String(cursor.snapshot_last_ts || "")) {
      const sanitizedSnapshot = sanitizeSnapshot(latest);
      const snapRes = await postPayload("snapshot", sanitizedSnapshot);
      if (snapRes.ok) {
        cursor.snapshot_last_ts = latestTs;
        sentSnapshot = true;
      }
    }
  }

  const mergedCursor = {
    ...cursor,
    ...(apiDelivered ? nextCursor : {}),
  };
  writeJsonAtomic(syncCursorPath, mergedCursor);

  const result = {
    sync_url_set: Boolean(syncUrl),
    api_events_total: allApiEvents.length,
    api_events_sent: sentApi,
    snapshot_sent: sentSnapshot,
    cursor: mergedCursor,
    mode: "whitelist+redaction",
  };

  console.log(JSON.stringify(result, null, 2));
}

(async () => {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(`ClawView outbound sync\n\nUsage:\n  node sync-outbound.mjs --once [--out-dir <dir>]\n\nEnv:\n  CLAWVIEW_SYNC_URL (required to actually send)\n  CLAWVIEW_SYNC_API_KEY (optional bearer)\n  CLAWVIEW_SYNC_HMAC_SECRET (optional HMAC-SHA256)\n  CLAWVIEW_TENANT_ID / CLAWVIEW_PROJECT_ID (optional labels)\n  CLAWVIEW_SYNC_BATCH_SIZE (default 200)\n`);
    process.exit(0);
  }

  if (hasFlag("--once")) {
    await runOnce();
    process.exit(0);
  }

  await runOnce();
})();
