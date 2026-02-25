import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

type HookEvent = {
  type?: string;
  action?: string;
  context?: {
    runtime?: {
      log?: (msg: string) => void;
      error?: (msg: string) => void;
    };
  };
};

type HookState = {
  lastTriggeredMs?: number;
  lastEvent?: string;
};

const ENABLED = (process.env.CLAWVIEW_PROBE_ENABLED ?? "1") !== "0";
const SYNC_ENABLED = (process.env.CLAWVIEW_SYNC_ENABLED ?? "1") !== "0";
const DEBOUNCE_MS = Math.max(0, Number(process.env.CLAWVIEW_PROBE_DEBOUNCE_MS ?? "45000"));

const OUT_DIR = path.join(os.homedir(), ".openclaw", "clawview-probe");
const PROBE_SCRIPT = path.join(OUT_DIR, "probe.mjs");
const SYNC_SCRIPT = path.join(OUT_DIR, "sync-outbound.mjs");
const STATE_PATH = path.join(OUT_DIR, "hook-trigger-state.json");

const SUPPORTED_EVENTS = new Set(["gateway:startup", "message:sent"]);

function eventKey(event: HookEvent): string {
  const t = String(event?.type ?? "").trim();
  const a = String(event?.action ?? "").trim();
  return t && a ? `${t}:${a}` : "";
}

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function readState(): HookState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as HookState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(next: HookState) {
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, STATE_PATH);
}

function shouldSkipByDebounce(nowMs: number, state: HookState): boolean {
  const last = Number(state.lastTriggeredMs ?? 0);
  if (!Number.isFinite(last) || last <= 0) return false;
  return nowMs - last < DEBOUNCE_MS;
}

const handler = async (event: HookEvent) => {
  const key = eventKey(event);
  if (!SUPPORTED_EVENTS.has(key)) {
    return;
  }

  if (!ENABLED) {
    return;
  }

  try {
    ensureDir();

    const nowMs = Date.now();
    const prev = readState();

    if (shouldSkipByDebounce(nowMs, prev)) {
      const remain = Math.max(0, DEBOUNCE_MS - (nowMs - Number(prev.lastTriggeredMs ?? 0)));
      event.context?.runtime?.log?.(`[clawview-probe] skipped (debounce ${remain}ms left) event=${key}`);
      return;
    }

    // Write state first to reduce double-spawn races when many hooks fire in a burst.
    writeState({
      lastTriggeredMs: nowMs,
      lastEvent: key,
    });

    const pipelineCmd = SYNC_ENABLED
      ? `node ${JSON.stringify(PROBE_SCRIPT)} --once --out-dir ${JSON.stringify(OUT_DIR)} && node ${JSON.stringify(SYNC_SCRIPT)} --once --out-dir ${JSON.stringify(OUT_DIR)}`
      : `node ${JSON.stringify(PROBE_SCRIPT)} --once --out-dir ${JSON.stringify(OUT_DIR)}`;

    const child = spawn("sh", ["-lc", pipelineCmd], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    event.context?.runtime?.log?.(
      `[clawview-probe] trigger accepted: event=${key}, pid=${child.pid ?? "?"}, debounceMs=${DEBOUNCE_MS}, sync=${SYNC_ENABLED ? "on" : "off"}`,
    );
  } catch (err) {
    event.context?.runtime?.error?.(`[clawview-probe] failed to trigger probe: ${String(err)}`);
  }
};

export default handler;
