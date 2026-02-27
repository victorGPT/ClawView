# ClawView Hook Runtime v1 (Decoupled)

## Goal
Use Hook-triggered sampling only (no heartbeat dependency), with minimal coupling and low complexity.

## Runtime location
- Hook manifest: `~/.openclaw/hooks/clawview-probe/HOOK.md`
- Hook handler: `~/.openclaw/hooks/clawview-probe/handler.ts`
- Probe script: `~/.openclaw/clawview-probe/probe.mjs`
- Hook state: `~/.openclaw/clawview-probe/hook-trigger-state.json`
- API cursor state: `~/.openclaw/clawview-probe/api-cursor.json`
- API incremental store: `~/.openclaw/clawview-probe/api-events.jsonl`
- Outbound sync script: `~/.openclaw/clawview-probe/sync-outbound.mjs`
- Outbound sync cursor: `~/.openclaw/clawview-probe/sync-cursor.json`
- Outbound sync config fallback: `~/.openclaw/clawview-probe/sync-config.json`

## Trigger events
- `gateway:startup`
- `message:sent`

## Behavior
1. On trigger, handler checks debounce window (default 45s via `CLAWVIEW_PROBE_DEBOUNCE_MS`).
2. If accepted, handler builds child env from process env + optional `sync-config.json`, then runs probe once and (optional) outbound sync once:
   - `node ~/.openclaw/clawview-probe/probe.mjs --once --out-dir ~/.openclaw/clawview-probe`
   - `node ~/.openclaw/clawview-probe/sync-outbound.mjs --once --out-dir ~/.openclaw/clawview-probe`
3. Probe performs cursor-based API log extraction:
   - reads gateway logs
   - extracts API-like lines
   - dedupes by stable key (`time+provider+group+status+fingerprint`)
   - appends incremental events to `api-events.jsonl`
4. Probe appends a JSON snapshot to:
   - `~/.openclaw/clawview-probe/snapshots-YYYY-MM-DD.jsonl`

## Decoupling rules
- No heartbeat binding.
- No cron dependency in v1.
- Hook logic should remain self-contained (event filter + debounce + one-shot spawn).

## Privacy baseline (outbound prep)
- Whitelist-only fields for outbound sync.
- Local redaction before any network send.
- TLS required for transport.
- Optional HMAC signature for payload integrity (`CLAWVIEW_SYNC_HMAC_SECRET`).

## Outbound config sources
- Primary: process env (`CLAWVIEW_SYNC_*`)
- Fallback: `~/.openclaw/clawview-probe/sync-config.json`

## Outbound env switches
- `CLAWVIEW_SYNC_ENABLED` (default `1`): set `0` to disable outbound sync call.
- `CLAWVIEW_SYNC_URL`: backend ingest URL (when unset, sync runs no-op).
- `CLAWVIEW_SYNC_API_KEY`: optional bearer token.
- `CLAWVIEW_SYNC_HMAC_SECRET`: optional HMAC-SHA256 signing secret.
- `CLAWVIEW_TENANT_ID` / `CLAWVIEW_PROJECT_ID`: routing labels.
- `CLAWVIEW_SYNC_BATCH_SIZE` (default `200`): max API events per flush.

## Heartbeat compatibility
- OpenClaw hook events currently do not expose a dedicated `heartbeat:*` trigger.
- If heartbeat-triggered ingestion is needed in the future, it should be added as an explicit hook event in platform support first.

## Current caveat
API metrics are currently best-effort and may be unstable depending on available log signals; keep marked as Gap where needed.
