import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { __test } from "./probe.mjs";

test("toMs parses numeric timestamps in seconds and milliseconds", () => {
  const ms = __test.toMs(1772276268409);
  const sec = __test.toMs(1772276268.409);

  assert.equal(ms, 1772276268409);
  assert.equal(sec, 1772276268409);
});

test("buildSessionSkillResultIndex keeps read skill facts from multiple files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawview-probe-test-"));
  const fileA = path.join(tmpDir, "a.jsonl");
  const fileB = path.join(tmpDir, "b.jsonl");

  const toolCallIdA = "call_A|fc_1";
  const toolCallIdB = "call_B|fc_2";

  const mkLine = (toolCallId, ts) =>
    JSON.stringify({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "read",
        toolCallId,
        timestamp: ts,
        isError: false,
        content: [
          {
            type: "text",
            text: "---\nname: brainstorming\n---\n# Skill",
          },
        ],
      },
    });

  fs.writeFileSync(fileA, `${mkLine(toolCallIdA, 1772276268409)}\n`, "utf8");
  fs.writeFileSync(fileB, `${mkLine(toolCallIdB, 1772276268.409)}\n`, "utf8");

  const known = new Map([["brainstorming", "brainstorming"]]);
  const idxA = __test.buildSessionSkillResultIndex(fileA, known);
  const idxB = __test.buildSessionSkillResultIndex(fileB, known);

  assert.equal(idxA.get(toolCallIdA)?.[0]?.skillName, "brainstorming");
  assert.equal(idxB.get(toolCallIdB)?.[0]?.skillName, "brainstorming");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
