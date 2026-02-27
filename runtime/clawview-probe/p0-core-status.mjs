#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}

const probeDir = argValue('--probe-dir', path.join(os.homedir(), '.openclaw', 'clawview-probe'));
const outPath = argValue('--out', path.join(probeDir, 'p0-core-live-status.json'));
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

// Derived from docs/clawview/{clawview-v1-prd.md,clawview-v1-fields.md,plan.md}
const P0_CORE_KEYS = [
  'service_uptime_ratio_24h',
  'service_status_now',
  'trigger_total_24h',
  'trigger_storm_task_top5_5m',
  'api_call_total_24h',
  'api_error_rate_24h',
  'api_429_ratio_24h',
  'endpoint_group_top5_calls_24h',
  'error_fingerprint_top10_24h',
  'restart_unexpected_count_24h',
  'data_freshness_delay_min',
];

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
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

function snapshotFiles(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^snapshots-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .map((f) => path.join(dir, f))
    .sort();
  return files.length > 0 ? files : null;
}

function isFilled(v) {
  return !(v === null || v === undefined);
}

function tsMs(value) {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
}

const files = snapshotFiles(probeDir);
if (!files) {
  console.log(JSON.stringify({ ok: false, reason: 'no snapshots found', probeDir }, null, 2));
  process.exit(0);
}

let seq = 0;
const rows = [];
for (const file of files) {
  for (const row of readJsonl(file)) {
    rows.push({
      file,
      row,
      seq: seq++,
      tsMs: tsMs(row.ts),
    });
  }
}

if (rows.length === 0) {
  console.log(JSON.stringify({ ok: false, reason: 'no snapshot rows found', probeDir }, null, 2));
  process.exit(0);
}

const rowsWithTs = rows.filter((entry) => entry.tsMs !== null);
const latestEntry = rowsWithTs.length > 0
  ? rowsWithTs.reduce((a, b) => ((a.tsMs > b.tsMs || (a.tsMs === b.tsMs && a.seq > b.seq)) ? a : b))
  : rows[rows.length - 1];
const latest = latestEntry.row ?? {};
const latestTsMs = latestEntry.tsMs ?? Date.now();
const lookbackStartMs = latestTsMs - LOOKBACK_MS;
const lookbackRows = rowsWithTs
  .filter((entry) => entry.tsMs >= lookbackStartMs && entry.tsMs <= latestTsMs)
  .sort((a, b) => b.tsMs - a.tsMs || b.seq - a.seq);
const sourceRows = lookbackRows.length > 0 ? lookbackRows : [latestEntry];

const fields = P0_CORE_KEYS.map((key) => {
  const source = sourceRows.find((entry) => isFilled(entry.row?.[key]));
  const value = source ? source.row[key] : null;
  const filled = isFilled(value);
  return {
    key,
    status: filled ? 'ready' : 'gap',
    sample: filled ? value : null,
  };
});

const readyCount = fields.filter((f) => f.status === 'ready').length;
const coverageRatio = P0_CORE_KEYS.length > 0 ? readyCount / P0_CORE_KEYS.length : 0;

const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  probe_dir: probeDir,
  source_snapshot_file: path.basename(latestEntry.file),
  source_snapshot_ts: latest.ts ?? null,
  p0_core_total: P0_CORE_KEYS.length,
  p0_core_ready: readyCount,
  p0_core_coverage_ratio: Number(coverageRatio.toFixed(4)),
  fields,
  notes: [
    'P0 keys are aligned to ClawView PRD/fields/plan docs.',
    'This report is runtime-observed with 24h lookback backfill, not a static design declaration.',
  ],
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
