#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const argv = process.argv.slice(2);

function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}

function hasFlag(flag) {
  return argv.includes(flag);
}

const outDir = argValue("--out-dir", path.join(os.homedir(), ".openclaw", "clawview-probe"));
const intervalMin = Number(argValue("--interval-min", "5"));
const durationMin = Number(argValue("--duration-min", "15"));
const now = new Date();
const dayTag = now.toISOString().slice(0, 10);
const snapshotPath = path.join(outDir, `snapshots-${dayTag}.jsonl`);
const runReportPath = path.join(outDir, `report-${dayTag}.json`);
const lockPath = path.join(outDir, "probe.lock");
const apiCursorPath = path.join(outDir, "api-cursor.json");
const apiEventsPath = path.join(outDir, "api-events.jsonl");
const apiEventRetentionMs = 48 * 60 * 60 * 1000;

const PROVIDER_RULES = [
  { provider: "lark", hosts: ["open.larksuite.com", "open.feishu.cn", "open.feishu-boe.cn"] },
  { provider: "discord", hosts: ["discord.com", "discordapp.com", "cdn.discordapp.com"] },
  { provider: "github", hosts: ["api.github.com", "github.com"] },
  { provider: "slack", hosts: ["slack.com", "slack-edge.com"] },
  { provider: "telegram", hosts: ["api.telegram.org"] },
  { provider: "whatsapp", hosts: ["graph.facebook.com", "api.whatsapp.com"] },
  { provider: "openai", hosts: ["api.openai.com"] },
  { provider: "anthropic", hosts: ["api.anthropic.com"] },
  { provider: "google", hosts: ["generativelanguage.googleapis.com", "api.google.com"] },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir() {
  fs.mkdirSync(outDir, { recursive: true });
}

function extractJsonPayload(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const t = line.trim();
    if (t.startsWith("{")) return true;
    if (t.startsWith("[")) {
      // Avoid log prefixes like: [plugins] ...
      if (/^\[[A-Za-z]/.test(t)) return false;
      return true;
    }
    return false;
  });
  if (start < 0) throw new Error(`No JSON payload found in output: ${text.slice(0, 200)}`);
  return JSON.parse(lines.slice(start).join("\n"));
}

function runOpenclawJson(args) {
  const stdout = execFileSync("openclaw", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 12 * 1024 * 1024,
  });
  return extractJsonPayload(stdout);
}

function runOpenclawJsonLines(args) {
  const stdout = execFileSync("openclaw", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 24 * 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function safeReadJson(filePath, fallback = {}) {
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

function appendJsonl(filePath, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const payload = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(filePath, payload, "utf8");
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  return text
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

function hashText(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex");
}

function tokyoDayRangeMs(reference = Date.now()) {
  const tokyo = new Date(new Date(reference).toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const startTokyo = new Date(tokyo);
  startTokyo.setHours(0, 0, 0, 0);
  const endTokyo = new Date(startTokyo);
  endTokyo.setDate(endTokyo.getDate() + 1);
  const offsetMs = tokyo.getTime() - reference;
  return {
    startMs: startTokyo.getTime() - offsetMs,
    endMs: endTokyo.getTime() - offsetMs,
  };
}

function normalizeErrorFingerprint(message) {
  return String(message || "unknown")
    .replace(/\b\d{6,}\b/g, "<num>")
    .replace(/[0-9a-f]{8,}/gi, "<hex>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function oneLine(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function countConfiguredChannels(configObj) {
  const guilds = configObj?.channels?.discord?.guilds;
  if (!guilds || typeof guilds !== "object") return 0;
  let total = 0;
  for (const guild of Object.values(guilds)) {
    if (!guild || typeof guild !== "object") continue;
    const channels = guild.channels;
    if (!channels || typeof channels !== "object") continue;
    total += Object.keys(channels).length;
  }
  return total;
}

function countConfiguredThreadsApprox(configObj) {
  const guilds = configObj?.channels?.discord?.guilds;
  if (!guilds || typeof guilds !== "object") return 0;
  let total = 0;
  for (const guild of Object.values(guilds)) {
    if (!guild || typeof guild !== "object") continue;
    const channels = guild.channels;
    if (!channels || typeof channels !== "object") continue;
    for (const channel of Object.values(channels)) {
      if (!channel || typeof channel !== "object") continue;
      if (channel.threadBindings && typeof channel.threadBindings === "object") {
        total += 1;
      }
    }
  }
  return total;
}

function parseElapsedToSec(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  // Linux style: seconds as integer
  if (/^\d+$/.test(t)) {
    const sec = Number(t);
    return Number.isFinite(sec) ? sec : null;
  }

  // macOS style etime: [[dd-]hh:]mm:ss
  const daySplit = t.split("-");
  let day = 0;
  let rest = t;
  if (daySplit.length === 2) {
    day = Number(daySplit[0]) || 0;
    rest = daySplit[1];
  }

  const parts = rest.split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n))) return null;

  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (parts.length === 3) {
    [hh, mm, ss] = parts;
  } else if (parts.length === 2) {
    [mm, ss] = parts;
  } else {
    return null;
  }

  return day * 86400 + hh * 3600 + mm * 60 + ss;
}

function getPidElapsedSeconds(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;

  // Try Linux keyword first
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "etimes="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sec = parseElapsedToSec(out);
    if (sec != null) return sec;
  } catch {
    // ignore
  }

  // macOS fallback
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "etime="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sec = parseElapsedToSec(out);
    return sec;
  } catch {
    return null;
  }
}

function collectGatewayRuntime(nowMs) {
  try {
    const status = runOpenclawJson(["gateway", "status", "--json"]);
    const listener = Array.isArray(status?.port?.listeners) ? status.port.listeners[0] : null;
    const listenerPid = Number(listener?.pid || 0);
    const uptimeSec = getPidElapsedSeconds(listenerPid);
    const ratio24h = uptimeSec == null ? null : Math.min(1, uptimeSec / (24 * 60 * 60));

    return {
      gateway_rpc_ok: Boolean(status?.rpc?.ok),
      gateway_listener_pid: Number.isFinite(listenerPid) && listenerPid > 0 ? listenerPid : null,
      service_uptime_sec: uptimeSec,
      service_uptime_ratio_24h: ratio24h,
      gateway_runtime_status: status?.service?.runtime?.status ?? null,
      gateway_runtime_state: status?.service?.runtime?.state ?? null,
      gateway_port_status: status?.port?.status ?? null,
      gateway_port_busy: status?.port?.status === "busy",
      collected_at_ms: nowMs,
    };
  } catch {
    return {
      gateway_rpc_ok: false,
      gateway_listener_pid: null,
      service_uptime_sec: null,
      service_uptime_ratio_24h: null,
      gateway_runtime_status: null,
      gateway_runtime_state: null,
      gateway_port_status: null,
      gateway_port_busy: false,
      collected_at_ms: nowMs,
    };
  }
}

function collectCronMetrics(nowMs) {
  const list = runOpenclawJson(["cron", "list", "--all", "--json"]);
  const jobs = Array.isArray(list?.jobs) ? list.jobs : [];
  const enabledJobs = jobs.filter((job) => job?.enabled !== false);

  const last24hStart = nowMs - 24 * 60 * 60 * 1000;
  const last5mStart = nowMs - 5 * 60 * 1000;
  const tokyoRange = tokyoDayRangeMs(nowMs);

  let runs24h = 0;
  let runsTokyoToday = 0;
  let maxSingleJob24h = 0;

  const perJob24h = [];
  const perJob5m = [];

  for (const job of enabledJobs) {
    const id = job?.id;
    if (!id) continue;

    let runs;
    try {
      runs = runOpenclawJson(["cron", "runs", "--id", String(id), "--limit", "200"]);
    } catch {
      continue;
    }

    const entries = Array.isArray(runs?.entries) ? runs.entries : [];
    let job24h = 0;
    let job5m = 0;

    for (const entry of entries) {
      const ts = Number(entry?.runAtMs ?? entry?.ts ?? 0);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      if (ts >= last24hStart && ts <= nowMs) {
        runs24h += 1;
        job24h += 1;
      }
      if (ts >= last5mStart && ts <= nowMs) {
        job5m += 1;
      }
      if (ts >= tokyoRange.startMs && ts < tokyoRange.endMs) {
        runsTokyoToday += 1;
      }
    }

    if (job24h > maxSingleJob24h) {
      maxSingleJob24h = job24h;
    }

    const name = String(job?.name || job?.id || "unknown");
    perJob24h.push({ job_id: String(id), job_name: name, runs_24h: job24h });
    perJob5m.push({ job_id: String(id), job_name: name, runs_5m: job5m });
  }

  const cronTop5_24h = perJob24h
    .filter((x) => x.runs_24h > 0)
    .sort((a, b) => b.runs_24h - a.runs_24h)
    .slice(0, 5);

  const cronStormTop5_5m = perJob5m
    .filter((x) => x.runs_5m > 0)
    .sort((a, b) => b.runs_5m - a.runs_5m)
    .slice(0, 5);

  return {
    cron_jobs_total: jobs.length,
    cron_jobs_enabled: enabledJobs.length,
    cron_runs_24h_total: runs24h,
    cron_runs_today_tokyo_total: runsTokyoToday,
    cron_max_single_job_24h: maxSingleJob24h,
    cron_top_jobs_24h: cronTop5_24h,
    cron_storm_top5_5m: cronStormTop5_5m,
  };
}

function collectErrorMetrics() {
  const logs = runOpenclawJson(["channels", "logs", "--channel", "all", "--json", "--lines", "800"]);
  const lines = Array.isArray(logs?.lines) ? logs.lines : [];

  const byFp = new Map();
  const nowMs = Date.now();
  const activeWindowMs = 60 * 60 * 1000;

  for (const line of lines) {
    const level = String(line?.level || "").toLowerCase();
    if (level !== "error" && level !== "warn") continue;

    const msg = String(line?.message || line?.raw || "");
    const fp = normalizeErrorFingerprint(msg);
    const tsMs = Date.parse(String(line?.time || ""));
    const record = byFp.get(fp) ?? { count: 0, first_seen: null, last_seen: null };
    record.count += 1;
    if (Number.isFinite(tsMs)) {
      if (!record.first_seen || tsMs < Date.parse(record.first_seen)) record.first_seen = new Date(tsMs).toISOString();
      if (!record.last_seen || tsMs > Date.parse(record.last_seen)) record.last_seen = new Date(tsMs).toISOString();
    }
    byFp.set(fp, record);
  }

  const top = [...byFp.entries()]
    .map(([fingerprint, v]) => ({ fingerprint, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const activeCount = top.filter((item) => {
    if (!item.last_seen) return false;
    const ts = Date.parse(item.last_seen);
    return Number.isFinite(ts) && nowMs - ts <= activeWindowMs;
  }).length;

  return {
    errors_active_count: activeCount,
    error_top: top,
    error_log_window_lines: lines.length,
  };
}

function extractFirstUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s"')]+/i);
  return m ? m[0] : null;
}

function detectProvider(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  for (const rule of PROVIDER_RULES) {
    if (rule.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return rule.provider;
    }
  }
  return "other";
}

function classifyEndpointGroup(pathname = "") {
  const p = String(pathname || "").toLowerCase();
  if (p.startsWith("/auth") || p.includes("/login") || p.includes("/token")) return "auth";
  if (p.startsWith("/users") || p.includes("/profile")) return "account";
  if (p.includes("/contacts")) return "contacts";
  if (p.includes("/conversations") || p.includes("/threads")) return "conversations";
  if (p.includes("/messages/send") || p.includes("/messages.create") || p.includes("/chat.postmessage")) return "message_send";
  if (p.includes("/messages") || p.includes("/im/v1/messages")) return "message_receive";
  if (p.includes("/media") || p.includes("/files")) return "media";
  if (p.includes("/webhook")) return "webhooks";
  if (p.includes("/jobs") || p.includes("/scheduler") || p.includes("/cron")) return "scheduler";
  if (p.includes("/integrations") || p.includes("/provider")) return "integrations";
  if (p.includes("/admin") || p.includes("/config")) return "admin_config";
  if (p.includes("/health") || p.includes("/ready") || p.includes("/metrics")) return "health_metrics";
  return "others";
}

function parseStatusCode(text) {
  const s = String(text || "");
  const m1 = s.match(/status\s*code\s*(\d{3})/i);
  if (m1) return Number(m1[1]);
  const m2 = s.match(/\b(\d{3})\b/);
  if (m2) {
    const code = Number(m2[1]);
    if (code >= 100 && code <= 599) return code;
  }
  return null;
}

function collectLogsContext() {
  const lines = runOpenclawJsonLines(["logs", "--json", "--limit", "2500", "--max-bytes", "600000"]);
  const entries = lines.filter((x) => x?.type === "log");
  const latestTs = entries
    .map((x) => Date.parse(String(x?.time || "")))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a)[0] ?? null;

  return {
    log_entries: entries,
    latest_log_ts_ms: latestTs,
    total_entries: entries.length,
  };
}

function toApiEvent(entry) {
  const ts = Date.parse(String(entry?.time || ""));
  if (!Number.isFinite(ts)) return null;

  const text = oneLine(`${entry?.message || ""} ${entry?.raw || ""}`);
  const urlText = extractFirstUrl(text);
  if (!urlText) return null;

  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    return null;
  }

  const provider = detectProvider(parsed.hostname);
  const endpointGroup = classifyEndpointGroup(parsed.pathname);
  const statusCode = parseStatusCode(text);
  const level = String(entry?.level || "").toLowerCase();
  const isRateLimited = statusCode === 429 || /\b429\b|rate\s*limit|throttl|too\s*many\s*requests/i.test(text);
  const isFailure = (statusCode != null && statusCode >= 400) || level === "error" || (level === "warn" && (statusCode != null || /error|fail|exception/i.test(text)));

  const dedupeBase = `${entry?.time || ""}|${entry?.level || ""}|${provider}|${endpointGroup}|${statusCode ?? ""}|${isRateLimited ? 1 : 0}|${normalizeErrorFingerprint(text).slice(0, 96)}`;
  const dedupeKey = hashText(dedupeBase);

  return {
    ts_ms: ts,
    ts: new Date(ts).toISOString(),
    provider,
    endpoint_group: endpointGroup,
    status_code: statusCode,
    is_failure: isFailure,
    is_rate_limited: isRateLimited,
    dedupe_key: dedupeKey,
  };
}

function collectApiMetrics(logEntries, nowMs) {
  const cursor = safeReadJson(apiCursorPath, { last_ts_ms: 0, last_keys: [] });
  const lastTs = Number(cursor?.last_ts_ms || 0);
  const lastKeys = new Set(Array.isArray(cursor?.last_keys) ? cursor.last_keys : []);

  const sorted = [...logEntries].sort((a, b) => Date.parse(String(a?.time || "")) - Date.parse(String(b?.time || "")));
  const incremental = [];

  let maxTs = lastTs;
  let maxTsKeys = new Set(lastKeys);

  for (const entry of sorted) {
    const ev = toApiEvent(entry);
    if (!ev) continue;

    if (ev.ts_ms < lastTs) continue;
    if (ev.ts_ms === lastTs && lastKeys.has(ev.dedupe_key)) continue;

    incremental.push(ev);

    if (ev.ts_ms > maxTs) {
      maxTs = ev.ts_ms;
      maxTsKeys = new Set([ev.dedupe_key]);
    } else if (ev.ts_ms === maxTs) {
      maxTsKeys.add(ev.dedupe_key);
    }
  }

  if (incremental.length > 0) {
    appendJsonl(apiEventsPath, incremental);
  }

  if (maxTs >= lastTs) {
    writeJsonAtomic(apiCursorPath, {
      last_ts_ms: maxTs,
      last_keys: [...maxTsKeys].slice(-300),
    });
  }

  const retainedFrom = nowMs - apiEventRetentionMs;
  const allEvents = readJsonl(apiEventsPath).filter((e) => Number(e?.ts_ms) >= retainedFrom);

  // Compact on each run to keep file bounded.
  if (allEvents.length > 0) {
    const tmp = `${apiEventsPath}.tmp`;
    fs.writeFileSync(tmp, allEvents.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    fs.renameSync(tmp, apiEventsPath);
  } else if (fs.existsSync(apiEventsPath)) {
    fs.writeFileSync(apiEventsPath, "", "utf8");
  }

  const last24hStart = nowMs - 24 * 60 * 60 * 1000;
  const tokyo = tokyoDayRangeMs(nowMs);

  let total24h = 0;
  let totalToday = 0;
  let success24h = 0;
  let failed24h = 0;
  let rateLimited24h = 0;
  let recentErrorTs = null;
  const byGroup = new Map();

  for (const ev of allEvents) {
    const ts = Number(ev.ts_ms || 0);
    if (!Number.isFinite(ts)) continue;

    const in24h = ts >= last24hStart && ts <= nowMs;
    const inToday = ts >= tokyo.startMs && ts < tokyo.endMs;
    if (!in24h && !inToday) continue;

    const key = `${ev.provider}::${ev.endpoint_group}`;
    const g = byGroup.get(key) ?? {
      provider: ev.provider,
      endpoint_group: ev.endpoint_group,
      calls_24h: 0,
      calls_today_tokyo: 0,
      failures_24h: 0,
      rate_limits_24h: 0,
    };

    if (in24h) {
      total24h += 1;
      g.calls_24h += 1;
      if (ev.is_failure) {
        failed24h += 1;
        g.failures_24h += 1;
        if (!recentErrorTs || ts > recentErrorTs) recentErrorTs = ts;
      } else {
        success24h += 1;
      }
      if (ev.is_rate_limited) {
        rateLimited24h += 1;
        g.rate_limits_24h += 1;
      }
    }

    if (inToday) {
      totalToday += 1;
      g.calls_today_tokyo += 1;
    }

    byGroup.set(key, g);
  }

  const groupTop5 = [...byGroup.values()].sort((a, b) => b.calls_24h - a.calls_24h).slice(0, 5);

  const hasEventStore = allEvents.length > 0;
  return {
    api_metrics_available: hasEventStore,
    api_call_total_24h: hasEventStore ? total24h : null,
    api_call_total_today_tokyo: hasEventStore ? totalToday : null,
    api_success_total_24h: hasEventStore ? success24h : null,
    api_failure_total_24h: hasEventStore ? failed24h : null,
    api_rate_limit_total_24h: hasEventStore ? rateLimited24h : null,
    api_error_rate_24h: hasEventStore && total24h > 0 ? failed24h / total24h : hasEventStore ? 0 : null,
    api_429_ratio_24h: hasEventStore && total24h > 0 ? rateLimited24h / total24h : hasEventStore ? 0 : null,
    endpoint_group_top5_calls_24h: hasEventStore ? groupTop5 : null,
    api_recent_error_time: recentErrorTs ? new Date(recentErrorTs).toISOString() : null,
    api_collection_mode: "hook-cursor-log-inferred",
    api_events_new_since_last: incremental.length,
    api_events_retained: allEvents.length,
    api_cursor_ts_ms: maxTs,
  };
}

function collectRestartMetrics(logEntries, nowMs) {
  const last24hStart = nowMs - 24 * 60 * 60 * 1000;
  const patterns = [
    /gateway failed to start/i,
    /\boom\b/i,
    /out of memory/i,
    /\bpanic\b/i,
    /uncaught/i,
    /crash/i,
    /unexpected restart/i,
  ];

  const seen = new Set();
  let count = 0;
  let recentTs = null;

  for (const entry of logEntries) {
    const ts = Date.parse(String(entry?.time || ""));
    if (!Number.isFinite(ts) || ts < last24hStart || ts > nowMs) continue;

    const msg = oneLine(`${entry?.message || ""} ${entry?.raw || ""}`);
    if (!patterns.some((p) => p.test(msg))) continue;

    const minuteBucket = Math.floor(ts / 60000);
    const fp = normalizeErrorFingerprint(msg).slice(0, 80);
    const key = `${minuteBucket}:${fp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    count += 1;
    if (!recentTs || ts > recentTs) recentTs = ts;
  }

  return {
    restart_unexpected_count_24h: count,
    restart_unexpected_recent_time: recentTs ? new Date(recentTs).toISOString() : null,
  };
}

function toCoverageValue(v) {
  if (v === null || v === undefined) return false;
  return true;
}

function collectSnapshot() {
  const nowMs = Date.now();
  const skills = runOpenclawJson(["skills", "list", "--json"]);

  let cfg = {};
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    cfg = {};
  }

  const gateway = collectGatewayRuntime(nowMs);
  const cron = collectCronMetrics(nowMs);
  const errors = collectErrorMetrics();
  const logsCtx = collectLogsContext();
  const api = collectApiMetrics(logsCtx.log_entries, nowMs);
  const restarts = collectRestartMetrics(logsCtx.log_entries, nowMs);

  const skillItems = Array.isArray(skills?.skills) ? skills.skills : [];
  const skillsComponents = skillItems.map((x) => ({
    name: String(x?.name || "--"),
    source: String(x?.source || "unknown"),
    eligible: Boolean(x?.eligible),
    disabled: Boolean(x?.disabled),
  }));
  const skillsHealthy = skillsComponents.filter((x) => x.eligible && !x.disabled).length;
  const skillsTop24h = skillsComponents.slice(0, 10).map((x) => ({
    name: `${x.name}（接入中）`,
    calls_24h: 0,
  }));

  const serviceStatusNow = gateway.gateway_rpc_ok ? (errors.errors_active_count > 0 ? "degraded" : "running") : "down";
  const dataFreshnessDelayMin = logsCtx.latest_log_ts_ms == null ? null : Math.max(0, Math.round((nowMs - logsCtx.latest_log_ts_ms) / 60000));

  const p0core = {
    service_uptime_ratio_24h: gateway.service_uptime_ratio_24h,
    service_status_now: serviceStatusNow,
    trigger_total_24h: cron.cron_runs_24h_total,
    trigger_storm_task_top5_5m: cron.cron_storm_top5_5m,
    api_call_total_24h: api.api_call_total_24h,
    api_error_rate_24h: api.api_error_rate_24h,
    api_429_ratio_24h: api.api_429_ratio_24h,
    endpoint_group_top5_calls_24h: api.endpoint_group_top5_calls_24h,
    error_fingerprint_top10_24h: errors.error_top,
    restart_unexpected_count_24h: restarts.restart_unexpected_count_24h,
    data_freshness_delay_min: dataFreshnessDelayMin,
  };

  const p0Filled = Object.values(p0core).filter(toCoverageValue).length;
  const p0Total = Object.keys(p0core).length;
  const p0CoverageRatio = p0Total > 0 ? p0Filled / p0Total : 0;

  const snapshot = {
    ts: new Date(nowMs).toISOString(),
    timezone: "Asia/Tokyo",

    // Base inventory
    skills_total: skillsComponents.length,
    healthy_skills: skillsHealthy,
    skills_components: skillsComponents,
    skills_top_24h: skillsTop24h,
    channels_total: countConfiguredChannels(cfg),
    threads_active_24h_approx: countConfiguredThreadsApprox(cfg),

    // Service/P0 core
    gateway_status: serviceStatusNow,
    service_status_now: serviceStatusNow,
    service_uptime_sec: gateway.service_uptime_sec,
    service_uptime_ratio_24h: gateway.service_uptime_ratio_24h,

    // Cron
    ...cron,

    // API (log inferred)
    ...api,

    // Errors / restarts
    ...errors,
    ...restarts,

    // Data quality
    data_freshness_delay_min: dataFreshnessDelayMin,
    p0_core_coverage_ratio: p0CoverageRatio,
    p0_core_filled: p0Filled,
    p0_core_total: p0Total,

    probe_version: "v1.1",
    probe_notes: [
      "API metrics use hook-triggered cursor incremental extraction from gateway logs",
      "API metrics remain best-effort until provider-level structured API events are available",
      "p0_core_coverage_ratio is computed from probe-populated core fields",
    ],
  };

  const raw = JSON.stringify(snapshot);
  return {
    ...snapshot,
    snapshot_bytes: Buffer.byteLength(raw, "utf8"),
  };
}

function appendSnapshot(snapshot) {
  fs.appendFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");
}

function readSnapshots(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  return text
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

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(filePath = snapshotPath) {
  const rows = readSnapshots(filePath);
  const sizes = rows.map((r) => Number(r.snapshot_bytes || 0)).filter((n) => Number.isFinite(n) && n > 0);
  const avg = sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0;
  const p95 = Math.round(percentile(sizes, 95));

  const samplesPerDay = Math.round((24 * 60) / Math.max(1, intervalMin));
  const dailyEstimateBytes = avg * samplesPerDay;

  const retention = {
    A: Math.round((dailyEstimateBytes * 7) / 1024),
    B: Math.round((dailyEstimateBytes * 3) / 1024),
    C: Math.round((dailyEstimateBytes * 14) / 1024),
    unit: "KB (raw snapshots only)",
  };

  const p0Coverage = rows
    .map((r) => Number(r.p0_core_coverage_ratio))
    .filter((n) => Number.isFinite(n));

  const report = {
    generated_at: new Date().toISOString(),
    file: filePath,
    samples: rows.length,
    snapshot_bytes_avg: avg,
    snapshot_bytes_p95: p95,
    estimated_daily_bytes: dailyEstimateBytes,
    retention_estimate: retention,
    p0_coverage_avg: p0Coverage.length ? Number((p0Coverage.reduce((a, b) => a + b, 0) / p0Coverage.length).toFixed(4)) : null,
    note: "A/B/C are quick raw-estimate placeholders; final policy can map to chosen retention tiers.",
  };

  fs.writeFileSync(runReportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}

function lockAlive() {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLock() {
  fs.writeFileSync(lockPath, String(process.pid), "utf8");
}

function clearLock() {
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

async function runLoop() {
  ensureDir();
  if (lockAlive()) {
    console.log(`[clawview-probe] already running; lock=${lockPath}`);
    return;
  }
  writeLock();

  const started = Date.now();
  const durationMs = Math.max(1, durationMin) * 60 * 1000;
  const intervalMs = Math.max(1, intervalMin) * 60 * 1000;

  console.log(`[clawview-probe] started: outDir=${outDir}, interval=${intervalMin}m, duration=${durationMin}m`);

  try {
    while (Date.now() - started <= durationMs) {
      const snapshot = collectSnapshot();
      appendSnapshot(snapshot);
      console.log(
        `[clawview-probe] snapshot: ts=${snapshot.ts}, bytes=${snapshot.snapshot_bytes}, p0=${snapshot.p0_core_coverage_ratio?.toFixed?.(2) ?? "n/a"}, cron24h=${snapshot.cron_runs_24h_total}, api24h=${snapshot.api_call_total_24h ?? "na"}, errors=${snapshot.errors_active_count}`,
      );
      await sleep(intervalMs);
    }

    const report = summarize(snapshotPath);
    console.log(`[clawview-probe] done: samples=${report.samples}, avg=${report.snapshot_bytes_avg}B, p95=${report.snapshot_bytes_p95}B, daily≈${report.estimated_daily_bytes}B`);
  } finally {
    clearLock();
  }
}

function printUsage() {
  console.log(`ClawView local probe\n\nUsage:\n  node probe.mjs --once\n  node probe.mjs --summarize\n  node probe.mjs [--interval-min 5] [--duration-min 15] [--out-dir <dir>]\n`);
}

(async () => {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    process.exit(0);
  }

  ensureDir();

  if (hasFlag("--once")) {
    const snapshot = collectSnapshot();
    appendSnapshot(snapshot);
    console.log(JSON.stringify(snapshot, null, 2));
    process.exit(0);
  }

  if (hasFlag("--summarize")) {
    const report = summarize(snapshotPath);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  await runLoop();
})();
