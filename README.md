# ClawView
Display-only runtime observability board for OpenClaw.

## Docs
- PRD: `docs/clawview/clawview-v1-prd.md`
- Fields: `docs/clawview/clawview-v1-fields.md`
- Execution Plan: `docs/clawview/plan.md`
- Hook Runtime Spec: `docs/clawview/hook-runtime-v1.md`

## Runtime Artifacts (local-first reference)
- Probe: `runtime/clawview-probe/probe.mjs`
- Outbound Sync (whitelist+redaction): `runtime/clawview-probe/sync-outbound.mjs`
- Hook manifest: `runtime/hooks/clawview-probe/HOOK.md`
- Hook handler: `runtime/hooks/clawview-probe/handler.ts`

## Principles
- Display-only (no reverse control)
- Homepage = summary signals only
- Detail pages/modules = full drill-down data
