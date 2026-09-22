import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionLineageStore, resolveParentContext } from "../src/lineage.mjs";

test("resolves exact host parent context without transcript inference", () => {
  assert.deepEqual(resolveParentContext({}, {
    CODEX_THREAD_ID: "codex-parent",
    CODEX_SESSION_ID: "codex-parent",
  }), {
    sessionId: "codex-parent",
    provider: "codex",
    evidence: "host_environment:CODEX_THREAD_ID",
  });
  assert.deepEqual(resolveParentContext({
    parentSessionId: "explicit-parent",
    parentProvider: "opencode",
  }, { CODEX_THREAD_ID: "ignored" }), {
    sessionId: "explicit-parent",
    provider: "opencode",
    evidence: "explicit_tool_input",
  });
});

test("appends permission-restricted explicit lineage records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-launch-lineage-test-"));
  const filePath = join(dir, "session-links.jsonl");
  const store = new SessionLineageStore(filePath);
  const captured = await store.record({
    mcpSessionId: "asm-1",
    provider: "fx",
    providerSessionId: "fx-child",
    cwd: "/tmp/project",
    title: "Child",
    parent: { provider: "codex", sessionId: "codex-parent", evidence: "host_environment:CODEX_THREAD_ID" },
  });
  assert.equal(captured.captured, true);
  const rows = (await readFile(filePath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows[0].child, { provider: "fx", sessionId: "fx-child" });
  assert.deepEqual(rows[0].parent, { provider: "codex", sessionId: "codex-parent" });
  assert.equal(rows[0].mechanism, "agent-launch-mcp");
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});
