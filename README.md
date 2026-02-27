# ClawView
Display-only runtime observability board for OpenClaw.

## Docs
- PRD: `docs/clawview/clawview-v1-prd.md`
- Fields: `docs/clawview/clawview-v1-fields.md`
- Execution Plan: `docs/clawview/plan.md`
- Hook Runtime Spec: `docs/clawview/hook-runtime-v1.md`
- Runtime baseline note: `docs/clawview/runtime-signal-baseline.md`

## Runtime Artifacts (local-first reference)
- Probe: `runtime/clawview-probe/probe.mjs`
- Outbound Sync (whitelist+redaction): `runtime/clawview-probe/sync-outbound.mjs`
- Outbound sync config example: `runtime/clawview-probe/sync-config.example.json`
- P0 runtime status checker: `runtime/clawview-probe/p0-core-status.mjs`
- Live status output (generated): `runtime/clawview-probe/p0-core-live-status.json`
- Hook manifest: `runtime/hooks/clawview-probe/HOOK.md`
- Hook handler: `runtime/hooks/clawview-probe/handler.ts`
- Dashboard function draft: `runtime/insforge-functions/clawview-dashboard/index.mjs`
- Dashboard function notes: `runtime/insforge-functions/clawview-dashboard/README.md`

## Principles
- Display-only (no reverse control)
- Homepage = summary signals only
- Detail pages/modules = full drill-down data
