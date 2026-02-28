#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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
const apiFactsPath = path.join(outDir, "api-facts.jsonl");
const apiEventsPath = path.join(outDir, "api-events.jsonl");
const apiEventRetentionMs = 48 * 60 * 60 * 1000;
const skillCursorPath = path.join(outDir, "skill-cursor.json");
const skillEventsPath = path.join(outDir, "skill-events.jsonl");
const skillEventRetentionMs = 48 * 60 * 60 * 1000;

const API_EVENT_ALLOWED_FIELDS = [
  "ts",
  "provider",
  "method",
  "host",
  "path_template",
  "endpoint_group",
  "status_code",
  "latency_ms",
  "is_429",
  "is_failure",
  "dedupe_key",
  "request_id",
];

const API_FACT_SENSITIVE_PATTERNS = [
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/i,
  /\b(?:token|access_token|refresh_token|id_token|authorization|cookie|set-cookie)\b\s*[:=]\s*["']?[a-z0-9._~+/=-]{8,}/i,
];

const CRITICAL_SYSTEM_ERROR_PATTERNS = [
  /gateway failed to start/i,
  /\bpanic\b/i,
  /out of memory|\boom\b/i,
  /uncaught/i,
  /\bcrash\b/i,
  /non[- ]?zero exit/i,
  /secrets_reloader_degraded/i,
  /port \d+ is already in use/i,
  /gateway already running/i,
  /shutdown timed out/i,
  /recovery time budget exceeded/i,
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

function isCriticalSystemErrorMessage(message = "") {
  const msg = oneLine(message);
  if (!msg) return false;
  return CRITICAL_SYSTEM_ERROR_PATTERNS.some((p) => p.test(msg));
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
  const byCriticalFp = new Map();
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

    if (isCriticalSystemErrorMessage(msg)) {
      const critical = byCriticalFp.get(fp) ?? { count: 0, first_seen: null, last_seen: null };
      critical.count += 1;
      if (Number.isFinite(tsMs)) {
        if (!critical.first_seen || tsMs < Date.parse(critical.first_seen)) critical.first_seen = new Date(tsMs).toISOString();
        if (!critical.last_seen || tsMs > Date.parse(critical.last_seen)) critical.last_seen = new Date(tsMs).toISOString();
      }
      byCriticalFp.set(fp, critical);
    }
  }

  const top = [...byFp.entries()]
    .map(([fingerprint, v]) => ({ fingerprint, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const criticalTop = [...byCriticalFp.entries()]
    .map(([fingerprint, v]) => ({ fingerprint, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const activeCount = top.filter((item) => {
    if (!item.last_seen) return false;
    const ts = Date.parse(item.last_seen);
    return Number.isFinite(ts) && nowMs - ts <= activeWindowMs;
  }).length;

  const criticalActiveCount = criticalTop.filter((item) => {
    if (!item.last_seen) return false;
    const ts = Date.parse(item.last_seen);
    return Number.isFinite(ts) && nowMs - ts <= activeWindowMs;
  }).length;

  return {
    errors_active_count: activeCount,
    errors_critical_active_count: criticalActiveCount,
    error_top: top,
    error_critical_top: criticalTop,
    error_log_window_lines: lines.length,
  };
}

function containsSensitiveApiFactValue(value = "") {
  const text = String(value || "");
  if (!text.trim()) return false;
  return API_FACT_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function collectLogsContext() {
  const lines = runOpenclawJsonLines(["logs", "--json", "--limit", "5000", "--max-bytes", "1000000"]);
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

function parseLogSubsystem(obj) {
  if (typeof obj?.subsystem === "string" && obj.subsystem.trim()) return obj.subsystem.trim();
  const rawHead = obj?.["0"];
  if (typeof rawHead !== "string" || !rawHead.trim().startsWith("{")) return "";
  try {
    const parsed = JSON.parse(rawHead);
    if (typeof parsed?.subsystem === "string") return parsed.subsystem.trim();
  } catch {
    // ignore
  }
  return "";
}

function readEmbeddedLogEntriesFromRuntime(nowMs, lookbackMs = 48 * 60 * 60 * 1000) {
  const logDir = "/tmp/openclaw";
  const threshold = nowMs - lookbackMs;
  const output = [];

  let files = [];
  try {
    files = fs
      .readdirSync(logDir, { withFileTypes: true })
      .filter((d) => d.isFile() && /^openclaw-\d{4}-\d{2}-\d{2}\.log$/.test(d.name))
      .map((d) => path.join(logDir, d.name));
  } catch {
    return output;
  }

  for (const filePath of files) {
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (!content.trim()) continue;

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim().startsWith("{")) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const subsystem = parseLogSubsystem(obj);
      if (subsystem !== "agent/embedded") continue;

      const tsMs = Date.parse(String(obj?.time || obj?._meta?.date || ""));
      if (!Number.isFinite(tsMs) || tsMs < threshold || tsMs > nowMs + 60_000) continue;

      const message = String(obj?.message || obj?.["1"] || "");
      if (!message) continue;

      output.push({
        time: new Date(tsMs).toISOString(),
        subsystem,
        message,
      });
    }
  }

  return output;
}

function listRecentSessionFiles(nowMs, lookbackMs = 24 * 60 * 60 * 1000) {
  const root = path.join(os.homedir(), ".openclaw", "agents");
  const threshold = nowMs - lookbackMs;
  const files = [];

  let agentDirs = [];
  try {
    agentDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return files;
  }

  for (const dir of agentDirs) {
    const sessionsDir = path.join(root, dir.name, "sessions");
    let entries = [];
    try {
      entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.jsonl')) continue;
      if (entry.name.includes('.deleted.') || entry.name.includes('.reset.')) continue;
      const fullPath = path.join(sessionsDir, entry.name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!Number.isFinite(stat.mtimeMs) || stat.mtimeMs < threshold) continue;
      files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 360);
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function parseSessionScope(sessionKey) {
  const key = String(sessionKey || "");
  const channelMatch = key.match(/:channel:([^:]+)(?::thread:([^:]+))?/);
  if (channelMatch) {
    return {
      channel: channelMatch[1] || undefined,
      thread: channelMatch[2] || undefined,
    };
  }
  const threadMatch = key.match(/:thread:([^:]+)/);
  return {
    channel: undefined,
    thread: threadMatch ? threadMatch[1] : undefined,
  };
}

function extractTextFromToolResultContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const s = String(value ?? "").trim();
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return n > 1e12 ? n : n * 1000;
  }
  return Date.parse(s);
}

function resolveSkillNameFromText(text, knownSkillNameMap) {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const fm = raw.match(/^---\s*\n([\s\S]{0,1200}?)\n---/);
  const block = fm ? fm[1] : raw.slice(0, 1200);
  const nameMatch = block.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/im);
  if (!nameMatch) return null;
  const candidate = String(nameMatch[1] || "").trim();
  if (!candidate) return null;
  const canonical = knownSkillNameMap.get(candidate.toLowerCase());
  return canonical || null;
}

function buildSessionSkillResultIndex(filePath, knownSkillNameMap) {
  const byToolCallId = new Map();
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return byToolCallId;
  }
  if (!content.trim()) return byToolCallId;

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message") continue;
    const message = entry?.message;
    if (!message || message.role !== "toolResult" || message.toolName !== "read") continue;

    const toolCallId = String(message.toolCallId || "").trim();
    if (!toolCallId) continue;

    const skillName = resolveSkillNameFromText(extractTextFromToolResultContent(message.content), knownSkillNameMap);
    if (!skillName) continue;

    const tsMs = toMs(message.timestamp ?? entry.timestamp);
    if (!Number.isFinite(tsMs)) continue;

    const outcome = message.isError ? "fail" : "success";
    const bucket = byToolCallId.get(toolCallId) ?? [];
    bucket.push({ tsMs, skillName, outcome });
    byToolCallId.set(toolCallId, bucket);
  }

  return byToolCallId;
}

function collectSkillUsageMetrics(nowMs, options = {}) {
  const knownSkillNameMap = new Map();
  for (const skillName of Array.isArray(options?.knownSkillNames) ? options.knownSkillNames : []) {
    const normalized = String(skillName || "").trim();
    if (!normalized) continue;
    knownSkillNameMap.set(normalized.toLowerCase(), normalized);
  }

  const baseLogEntries = Array.isArray(options?.logEntries) ? options.logEntries : collectLogsContext().log_entries;
  const runtimeEmbeddedEntries = readEmbeddedLogEntriesFromRuntime(nowMs);
  const logEntries = [...baseLogEntries, ...runtimeEmbeddedEntries];
  const runToSession = new Map();
  const readToolEnds = [];

  for (const entry of logEntries) {
    if (String(entry?.subsystem || "") !== "agent/embedded") continue;
    const message = String(entry?.message || "");
    const tsMs = Date.parse(String(entry?.time || ""));
    if (!Number.isFinite(tsMs)) continue;

    const runSessionMatch = message.match(/runId=([^\s]+).*sessionId=([0-9a-f-]{36})/i);
    if (runSessionMatch) {
      const runId = String(runSessionMatch[1] || "").trim();
      const sessionId = String(runSessionMatch[2] || "").trim().toLowerCase();
      if (isUuidLike(runId) && isUuidLike(sessionId)) {
        runToSession.set(runId, sessionId);
      }
    }

    const toolEndMatch = message.match(/embedded run tool end:\s*runId=([^\s]+)\s+tool=read\s+toolCallId=([^\s]+)/i);
    if (!toolEndMatch) continue;

    const runId = String(toolEndMatch[1] || "").trim();
    const toolCallId = String(toolEndMatch[2] || "").trim();
    if (!isUuidLike(runId) || !toolCallId) continue;
    readToolEnds.push({ runId, toolCallId, tsMs });
  }

  const sessionsById = new Map();
  try {
    const sessionsPayload = runOpenclawJson(["sessions", "--all-agents", "--json"]);
    const sessions = Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [];
    for (const session of sessions) {
      const sessionId = String(session?.sessionId || "").trim().toLowerCase();
      const sessionKey = String(session?.key || "").trim();
      if (!isUuidLike(sessionId) || !sessionKey) continue;
      sessionsById.set(sessionId, {
        session_key: sessionKey,
        ...parseSessionScope(sessionKey),
      });
    }
  } catch {
    // Keep fact-only fallback when session metadata is unavailable.
  }

  const requiredSessionIds = new Set(
    readToolEnds
      .map((e) => String(runToSession.get(e.runId) || "").toLowerCase())
      .filter((v) => isUuidLike(v)),
  );

  const recentFiles = listRecentSessionFiles(nowMs, 48 * 60 * 60 * 1000);
  const sessionFilesById = new Map();
  for (const file of recentFiles) {
    const base = path.basename(file.path);
    const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
    if (!m) continue;
    const sessionId = String(m[1] || "").toLowerCase();
    if (!requiredSessionIds.has(sessionId)) continue;
    const bucket = sessionFilesById.get(sessionId) ?? [];
    if (!bucket.includes(file.path)) {
      bucket.push(file.path);
    }
    sessionFilesById.set(sessionId, bucket.slice(0, 12));
  }

  const sessionResultIndexById = new Map();
  for (const [sessionId, filePaths] of sessionFilesById.entries()) {
    const merged = new Map();
    for (const filePath of filePaths) {
      const partial = buildSessionSkillResultIndex(filePath, knownSkillNameMap);
      for (const [toolCallId, rows] of partial.entries()) {
        const bucket = merged.get(toolCallId) ?? [];
        bucket.push(...rows);
        merged.set(toolCallId, bucket);
      }
    }
    sessionResultIndexById.set(sessionId, merged);
  }

  const factEvents = [];
  for (const readEnd of readToolEnds) {
    const sessionId = runToSession.get(readEnd.runId);
    if (!sessionId) continue;
    const skillIndex = sessionResultIndexById.get(sessionId);
    if (!skillIndex) continue;

    const candidates = Array.isArray(skillIndex.get(readEnd.toolCallId)) ? skillIndex.get(readEnd.toolCallId) : [];
    if (candidates.length === 0) continue;

    const best = candidates
      .slice()
      .sort((a, b) => Math.abs(a.tsMs - readEnd.tsMs) - Math.abs(b.tsMs - readEnd.tsMs))[0];
    if (!best?.skillName) continue;

    const sessionMeta = sessionsById.get(sessionId);
    const outcome = best.outcome === "fail" ? "fail" : "success";
    const dedupe_key = hashText(`${readEnd.runId}|${readEnd.toolCallId}|${best.skillName}|${outcome}`);

    factEvents.push({
      ts_ms: best.tsMs,
      ts: new Date(best.tsMs).toISOString(),
      skill_name: best.skillName,
      outcome,
      dedupe_key,
      ...(sessionMeta?.session_key ? { session_key: sessionMeta.session_key } : {}),
      ...(sessionMeta?.channel ? { channel: sessionMeta.channel } : {}),
      ...(sessionMeta?.thread ? { thread: sessionMeta.thread } : {}),
    });
  }

  const cursor = safeReadJson(skillCursorPath, { last_ts_ms: 0, last_keys: [] });
  const lastTs = Number(cursor?.last_ts_ms || 0);
  const lastKeys = new Set(Array.isArray(cursor?.last_keys) ? cursor.last_keys : []);

  const incremental = [];
  let maxTs = lastTs;
  let maxTsKeys = new Set(lastKeys);

  const sortedFacts = factEvents.sort((a, b) => Number(a.ts_ms || 0) - Number(b.ts_ms || 0));
  for (const ev of sortedFacts) {
    const tsMs = Number(ev.ts_ms || 0);
    if (!Number.isFinite(tsMs)) continue;
    if (tsMs < lastTs) continue;
    if (tsMs === lastTs && lastKeys.has(ev.dedupe_key)) continue;

    incremental.push(ev);
    if (tsMs > maxTs) {
      maxTs = tsMs;
      maxTsKeys = new Set([ev.dedupe_key]);
    } else if (tsMs === maxTs) {
      maxTsKeys.add(ev.dedupe_key);
    }
  }

  if (incremental.length > 0) {
    appendJsonl(skillEventsPath, incremental);
  }

  if (maxTs >= lastTs) {
    writeJsonAtomic(skillCursorPath, {
      last_ts_ms: maxTs,
      last_keys: [...maxTsKeys].slice(-300),
    });
  }

  const retainedFrom = nowMs - skillEventRetentionMs;
  const allEvents = readJsonl(skillEventsPath).filter((e) => Number(e?.ts_ms) >= retainedFrom);

  if (allEvents.length > 0) {
    const tmp = `${skillEventsPath}.tmp`;
    fs.writeFileSync(tmp, allEvents.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    fs.renameSync(tmp, skillEventsPath);
  } else if (fs.existsSync(skillEventsPath)) {
    fs.writeFileSync(skillEventsPath, "", "utf8");
  }

  const last24hStart = nowMs - 24 * 60 * 60 * 1000;
  const counts = new Map();
  let total24h = 0;

  for (const ev of allEvents) {
    const tsMs = Number(ev?.ts_ms || 0);
    if (!Number.isFinite(tsMs) || tsMs < last24hStart || tsMs > nowMs) continue;
    const skillName = String(ev?.skill_name || "").trim();
    if (!skillName) continue;
    total24h += 1;
    counts.set(skillName, (counts.get(skillName) || 0) + 1);
  }

  const skillsTop = [...counts.entries()]
    .map(([name, calls_24h]) => ({ name, calls_24h }))
    .sort((a, b) => b.calls_24h - a.calls_24h)
    .slice(0, 10);

  const sourceConnected = readToolEnds.length > 0 || allEvents.length > 0;
  return {
    skills_top_24h_inferred: skillsTop,
    skill_calls_total_24h: total24h,
    skill_calls_collection_mode: sourceConnected ? "fact-event-structured" : "fact-only-not-connected",
    skill_calls_files_scanned: [...sessionFilesById.values()].reduce((sum, files) => sum + files.length, 0),
    skill_calls_retained_24h: allEvents.length,
  };
}

function sanitizeApiFactFields(raw) {
  const out = {};
  for (const field of API_EVENT_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      out[field] = raw[field];
    }
  }
  return out;
}

function normalizeApiFactEvent(raw) {
  if (!raw || typeof raw !== "object") {
    return { event: null, reason: "invalid" };
  }

  if (containsSensitiveApiFactValue(JSON.stringify(raw))) {
    return { event: null, reason: "sensitive" };
  }
  const rawKeys = Object.keys(raw);
  if (rawKeys.some((key) => !API_EVENT_ALLOWED_FIELDS.includes(key))) {
    return { event: null, reason: "invalid" };
  }

  const sanitized = sanitizeApiFactFields(raw);
  if (containsSensitiveApiFactValue(JSON.stringify(sanitized))) {
    return { event: null, reason: "sensitive" };
  }

  const tsMs = toMs(sanitized.ts);
  if (!Number.isFinite(tsMs)) {
    return { event: null, reason: "invalid" };
  }

  const providerRaw = String(sanitized.provider || "").trim().toLowerCase();
  const method = String(sanitized.method || "").trim().toUpperCase();
  const host = String(sanitized.host || "").trim().toLowerCase();
  const pathTemplate = String(sanitized.path_template || "").trim().toLowerCase();
  const endpointGroupRaw = String(sanitized.endpoint_group || "").trim().toLowerCase();
  const dedupeKey = String(sanitized.dedupe_key || "").trim();
  const provider = providerRaw === "other" || providerRaw === "others" ? "unknown" : providerRaw;
  const endpointGroup =
    endpointGroupRaw === "other" || endpointGroupRaw === "others" ? "unknown" : endpointGroupRaw;

  if (!provider || !method || !host || !pathTemplate || !endpointGroup || !dedupeKey) {
    return { event: null, reason: "invalid" };
  }

  if (
    containsSensitiveApiFactValue(provider) ||
    containsSensitiveApiFactValue(method) ||
    containsSensitiveApiFactValue(host) ||
    containsSensitiveApiFactValue(pathTemplate) ||
    containsSensitiveApiFactValue(endpointGroup)
  ) {
    return { event: null, reason: "sensitive" };
  }

  const statusCode =
    typeof sanitized.status_code === "number" &&
    Number.isFinite(sanitized.status_code) &&
    sanitized.status_code >= 100 &&
    sanitized.status_code <= 599
      ? sanitized.status_code
      : null;

  const latencyMs =
    typeof sanitized.latency_ms === "number" && Number.isFinite(sanitized.latency_ms)
      ? Math.max(0, Math.round(sanitized.latency_ms))
      : 0;

  const is429 = sanitized.is_429 === true;
  const isFailure =
    typeof sanitized.is_failure === "boolean"
      ? sanitized.is_failure
      : statusCode == null
        ? true
        : statusCode >= 400;

  const requestIdRaw = String(sanitized.request_id || "").trim();
  const requestId =
    requestIdRaw && /^[a-z0-9._:-]{6,128}$/i.test(requestIdRaw) && !containsSensitiveApiFactValue(requestIdRaw)
      ? requestIdRaw
      : "";

  return {
    event: {
      ts: new Date(tsMs).toISOString(),
      ts_ms: tsMs,
      provider,
      method,
      host,
      path_template: pathTemplate,
      endpoint_group: endpointGroup,
      status_code: statusCode,
      latency_ms: latencyMs,
      is_429: is429,
      is_failure: isFailure,
      dedupe_key: dedupeKey,
      ...(requestId ? { request_id: requestId } : {}),
    },
    reason: "ok",
  };
}

function loadApiFactEvents(nowMs) {
  const retainedFrom = nowMs - apiEventRetentionMs;
  const upperBound = nowMs + 60_000;

  const rawFacts = readJsonl(apiFactsPath);
  let validFactCount = 0;
  let sensitiveDropped = 0;
  let invalidDropped = 0;
  const dedupedByKey = new Map();

  for (const raw of rawFacts) {
    const normalized = normalizeApiFactEvent(raw);
    if (!normalized.event) {
      if (normalized.reason === "sensitive") sensitiveDropped += 1;
      else invalidDropped += 1;
      continue;
    }
    validFactCount += 1;
    const event = normalized.event;

    if (event.ts_ms < retainedFrom || event.ts_ms > upperBound) continue;

    const previous = dedupedByKey.get(event.dedupe_key);
    if (!previous || event.ts_ms > previous.ts_ms) {
      dedupedByKey.set(event.dedupe_key, event);
    }
  }

  const allEvents = [...dedupedByKey.values()].sort((a, b) => Number(a.ts_ms || 0) - Number(b.ts_ms || 0));
  const retainedFacts = allEvents.map((event) => sanitizeApiFactFields(event));

  if (retainedFacts.length > 0) {
    const tmpFacts = `${apiFactsPath}.tmp`;
    fs.writeFileSync(tmpFacts, retainedFacts.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    fs.renameSync(tmpFacts, apiFactsPath);
  } else if (fs.existsSync(apiFactsPath)) {
    fs.writeFileSync(apiFactsPath, "", "utf8");
  }

  if (allEvents.length > 0) {
    const tmp = `${apiEventsPath}.tmp`;
    fs.writeFileSync(tmp, allEvents.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    fs.renameSync(tmp, apiEventsPath);
  } else if (fs.existsSync(apiEventsPath)) {
    fs.writeFileSync(apiEventsPath, "", "utf8");
  }

  return {
    events: allEvents,
    sourceConnected: rawFacts.length > 0,
    validFactCount,
    sensitiveDropped,
    invalidDropped,
  };
}

function computeApiMetricsFromFactEvents(events, nowMs, sourceConnected, stats = {}) {
  const last24hStart = nowMs - 24 * 60 * 60 * 1000;
  const tokyo = tokyoDayRangeMs(nowMs);

  let total24h = 0;
  let totalToday = 0;
  let success24h = 0;
  let failed24h = 0;
  let rateLimited24h = 0;
  let unknown24h = 0;
  let recentErrorTs = null;
  const byGroup = new Map();

  for (const ev of events) {
    const ts = Number(ev.ts_ms || 0);
    if (!Number.isFinite(ts)) continue;

    const in24h = ts >= last24hStart && ts <= nowMs;
    const inToday = ts >= tokyo.startMs && ts < tokyo.endMs;
    if (!in24h && !inToday) continue;

    const key = `${ev.provider}/${ev.endpoint_group}`;
    const g = byGroup.get(key) ?? {
      provider: ev.provider,
      endpoint_group: key,
      calls_24h: 0,
      calls_today_tokyo: 0,
      failures_24h: 0,
      rate_limits_24h: 0,
    };

    if (in24h) {
      total24h += 1;
      g.calls_24h += 1;

      if (ev.provider === "unknown" || ev.endpoint_group === "unknown") {
        unknown24h += 1;
      }

      if (ev.is_failure) {
        failed24h += 1;
        g.failures_24h += 1;
        if (!recentErrorTs || ts > recentErrorTs) recentErrorTs = ts;
      } else {
        success24h += 1;
      }

      if (ev.is_429) {
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
  const hasEventStore = sourceConnected;
  const latestTs = events.length > 0 ? Number(events[events.length - 1]?.ts_ms || 0) : null;

  return {
    api_metrics_available: hasEventStore,
    api_call_total_24h: hasEventStore ? total24h : null,
    api_call_total_today_tokyo: hasEventStore ? totalToday : null,
    api_success_total_24h: hasEventStore ? success24h : null,
    api_failure_total_24h: hasEventStore ? failed24h : null,
    api_rate_limit_total_24h: hasEventStore ? rateLimited24h : null,
    api_error_rate_24h: hasEventStore && total24h > 0 ? failed24h / total24h : hasEventStore ? 0 : null,
    api_429_ratio_24h: hasEventStore && total24h > 0 ? rateLimited24h / total24h : hasEventStore ? 0 : null,
    api_unknown_rate_24h: hasEventStore && total24h > 0 ? unknown24h / total24h : hasEventStore ? 0 : null,
    endpoint_group_top5_calls_24h: hasEventStore ? groupTop5 : null,
    api_recent_error_time: recentErrorTs ? new Date(recentErrorTs).toISOString() : null,
    api_collection_mode: hasEventStore ? "fact-event-structured" : "fact-only-not-connected",
    api_events_new_since_last: null,
    api_events_retained: events.length,
    api_cursor_ts_ms: Number.isFinite(latestTs) ? latestTs : null,
    api_events_valid_fact_total: Number(stats.validFactCount || 0),
    api_events_sensitive_dropped: Number(stats.sensitiveDropped || 0),
    api_events_invalid_dropped: Number(stats.invalidDropped || 0),
  };
}

function collectApiMetrics(nowMs) {
  const { events, sourceConnected, validFactCount, sensitiveDropped, invalidDropped } = loadApiFactEvents(nowMs);
  return computeApiMetricsFromFactEvents(events, nowMs, sourceConnected, {
    validFactCount,
    sensitiveDropped,
    invalidDropped,
  });
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

function computeServiceStatusNow(params) {
  const gatewayRpcOk = params?.gatewayRpcOk === true;
  const restartUnexpectedCount24h = Number(params?.restartUnexpectedCount24h || 0);
  const criticalSystemErrorActiveCount = Number(params?.criticalSystemErrorActiveCount || 0);

  if (!gatewayRpcOk) return "down";
  if (
    (Number.isFinite(restartUnexpectedCount24h) && restartUnexpectedCount24h > 0) ||
    (Number.isFinite(criticalSystemErrorActiveCount) && criticalSystemErrorActiveCount > 0)
  ) {
    return "degraded";
  }
  return "running";
}

function computeAnomalyFlags(params) {
  const serviceStatusNow = String(params?.serviceStatusNow || "running").trim();
  const restartUnexpectedCount24h = Number(params?.restartUnexpectedCount24h || 0);
  const criticalSystemErrorActiveCount = Number(params?.criticalSystemErrorActiveCount || 0);
  const skillCallsCollectionMode = String(params?.skillCallsCollectionMode || "").trim();

  return {
    openclaw_system_anomaly:
      serviceStatusNow === "down" ||
      (Number.isFinite(restartUnexpectedCount24h) && restartUnexpectedCount24h > 0) ||
      (Number.isFinite(criticalSystemErrorActiveCount) && criticalSystemErrorActiveCount > 0),
    clawview_pipeline_anomaly: skillCallsCollectionMode !== "fact-event-structured",
  };
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
  const api = collectApiMetrics(nowMs);
  const restarts = collectRestartMetrics(logsCtx.log_entries, nowMs);

  const skillItems = Array.isArray(skills?.skills) ? skills.skills : [];
  const skillsComponents = skillItems.map((x) => ({
    name: String(x?.name || "--"),
    source: String(x?.source || "unknown"),
    eligible: Boolean(x?.eligible),
    disabled: Boolean(x?.disabled),
  }));
  const skillsHealthy = skillsComponents.filter((x) => x.eligible && !x.disabled).length;
  const knownSkillNames = new Set(skillsComponents.map((x) => x.name));
  const skillUsage = collectSkillUsageMetrics(nowMs, {
    logEntries: logsCtx.log_entries,
    knownSkillNames: [...knownSkillNames],
  });
  const skillTopReal = (Array.isArray(skillUsage?.skills_top_24h_inferred) ? skillUsage.skills_top_24h_inferred : [])
    .filter((x) => knownSkillNames.has(String(x?.name || '')))
    .slice(0, 10)
    .map((x) => ({ name: String(x.name), calls_24h: Number(x.calls_24h || 0) }));
  const skillsTop24h = skillTopReal;

  const serviceStatusNow = computeServiceStatusNow({
    gatewayRpcOk: gateway.gateway_rpc_ok,
    restartUnexpectedCount24h: restarts.restart_unexpected_count_24h,
    criticalSystemErrorActiveCount: errors.errors_critical_active_count,
  });
  const dataFreshnessDelayMin = logsCtx.latest_log_ts_ms == null ? null : Math.max(0, Math.round((nowMs - logsCtx.latest_log_ts_ms) / 60000));
  const anomalyFlags = computeAnomalyFlags({
    serviceStatusNow,
    restartUnexpectedCount24h: restarts.restart_unexpected_count_24h,
    criticalSystemErrorActiveCount: errors.errors_critical_active_count,
    skillCallsCollectionMode: skillUsage.skill_calls_collection_mode,
  });

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
    skill_calls_total_24h: skillUsage.skill_calls_total_24h,
    skill_calls_collection_mode: skillUsage.skill_calls_collection_mode,
    skill_calls_files_scanned: skillUsage.skill_calls_files_scanned,
    skill_calls_retained_24h: skillUsage.skill_calls_retained_24h,
    channels_total: countConfiguredChannels(cfg),
    threads_active_24h_approx: countConfiguredThreadsApprox(cfg),

    // Service/P0 core
    gateway_status: serviceStatusNow,
    service_status_now: serviceStatusNow,
    openclaw_system_anomaly: anomalyFlags.openclaw_system_anomaly,
    clawview_pipeline_anomaly: anomalyFlags.clawview_pipeline_anomaly,
    service_uptime_sec: gateway.service_uptime_sec,
    service_uptime_ratio_24h: gateway.service_uptime_ratio_24h,

    // Cron
    ...cron,

    // API (fact stream)
    ...api,

    // Errors / restarts
    ...errors,
    ...restarts,

    // Data quality
    data_freshness_delay_min: dataFreshnessDelayMin,
    p0_core_coverage_ratio: p0CoverageRatio,
    p0_core_filled: p0Filled,
    p0_core_total: p0Total,

    probe_version: "v1.3",
    probe_notes: [
      "API metrics consume structured provider API fact events only",
      "Skill Top24h uses fact-only source; no inferred usage when facts are unavailable",
      "service_status_now is based on gateway RPC + unexpected restart + critical system errors (not generic warn/error noise)",
      "When API fact stream is not connected, API metrics explicitly stay Gap",
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

export const __test = {
  toMs,
  resolveSkillNameFromText,
  buildSessionSkillResultIndex,
  containsSensitiveApiFactValue,
  sanitizeApiFactFields,
  normalizeApiFactEvent,
  computeApiMetricsFromFactEvents,
  computeServiceStatusNow,
  computeAnomalyFlags,
  isCriticalSystemErrorMessage,
};

async function main() {
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
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
if (entryPath === selfPath) {
  main();
}
