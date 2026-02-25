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

After each probe run, it can optionally invoke outbound sync (`sync-outbound.mjs`) when
`CLAWVIEW_SYNC_ENABLED` is not `0`.

Design goals:
- Hook-triggered (event-driven)
- Decoupled from heartbeat and other scheduler modules
- Debounced to avoid excessive sampling during burst traffic
- Whitelist + redaction before outbound sync
