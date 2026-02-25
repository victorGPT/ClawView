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

## Trigger events
- `gateway:startup`
- `message:sent`

## Behavior
1. On trigger, handler checks debounce window (default 45s via `CLAWVIEW_PROBE_DEBOUNCE_MS`).
2. If accepted, handler runs:
   - `node ~/.openclaw/clawview-probe/probe.mjs --once --out-dir ~/.openclaw/clawview-probe`
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

## Current caveat
API metrics are currently best-effort and may be unstable depending on available log signals; keep marked as Gap where needed.
