# Runtime Signal Baseline (Doc+CLI aligned)

This file records a **runtime-observed** baseline using the local ClawView probe output,
aligned to the three canonical docs:

- `docs/clawview/clawview-v1-prd.md`
- `docs/clawview/clawview-v1-fields.md`
- `docs/clawview/plan.md`

## Latest observed run
- Generated at (UTC): `2026-02-27T08:19:47.717Z`
- Snapshot source: `snapshots-2026-02-27.jsonl`
- Snapshot ts (UTC): `2026-02-27T06:39:23.348Z`
- P0-Core coverage (runtime observed): `0.2727` (`3/11`)

## Meaning
- This is not a design target; it is current runtime reality from CLI data.
- Use this baseline to prioritize implementation in `runtime/clawview-probe/` and hook pipeline.
- P0 field status now uses a 24h lookback backfill: for each key, pick the most recent non-null value across snapshot files within the window.

## Recompute command
```bash
node runtime/clawview-probe/p0-core-status.mjs \
  --probe-dir ~/.openclaw/clawview-probe \
  --out runtime/clawview-probe/p0-core-live-status.json
```
