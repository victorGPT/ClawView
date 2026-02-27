---
name: clawview-probe
description: "Trigger ClawView probe once on hook events (decoupled, no heartbeat binding)"
metadata:
  {
    "openclaw":
      {
        "emoji": "📈",
        "events": ["gateway:startup", "message:sent"],
        "requires": { "bins": ["openclaw", "node"] },
      },
  }
---

# ClawView Probe Hook

Runs a **single** ClawView probe collection on selected hook events and appends compact JSON snapshots
under `~/.openclaw/clawview-probe/`.

After each probe run, it optionally invokes outbound sync (`sync-outbound.mjs`) when sync is enabled
and a sync URL is available.

Sync config sources (priority):
1. Process env (`CLAWVIEW_SYNC_*`)
2. `~/.openclaw/clawview-probe/sync-config.json`

Design goals:
- Hook-triggered (event-driven)
- Decoupled from heartbeat and other scheduler modules
- Debounced to avoid excessive sampling during burst traffic
- Whitelist + redaction before outbound sync

Note on heartbeat:
- There is currently no dedicated `heartbeat:*` hook event in OpenClaw hooks.
- Keep this hook event-driven via `gateway:startup` and `message:sent`.
