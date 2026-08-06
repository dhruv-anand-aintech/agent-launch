import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRegistry } from "../src/registry.mjs";
import { SessionService } from "../src/core.mjs";
import { UnsupportedCapabilityError } from "../src/errors.mjs";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "agent-launch-mcp-test-"));
  const registry = new SessionRegistry(join(dir, "sessions.json"), "test-owner");
  const calls = [];
  const adapter = {
    async create(input) { calls.push(["create", input]); return { providerSessionId: "provider-1", status: "idle", result: null }; },
    async send(input) { calls.push(["send", input]); return { status: "finished", result: "ok" }; },
    async status() { return { status: "idle", provider: { state: "idle" } }; },
    async history() { return { messages: [{ role: "assistant", text: "history" }] }; },
    async resume(input) { calls.push(["resume", input]); return { status: "idle" }; },
    async cancel() { return { cancelled: true }; },
    async cleanup() { calls.push(["cleanup"]); return { deleted: true }; },
  };
  const service = new SessionService({ registry, adapters: { cursor: adapter, opencode: adapter, codex: adapter, claude: adapter } });
  return { dir, registry, service, calls };
}

test("creates, sends, inspects, resumes, and cleans an owner-scoped session", async () => {
  const { service, registry, calls, dir } = await fixture();
  const created = await service.create({ provider: "cursor", cwd: "/tmp/project", prompt: "hello" });
  assert.match(created.session.id, /^asm_/);
  const sent = await service.send({ sessionId: created.session.id, message: "next" });
  assert.equal(sent.result, "ok");
  const inspected = await service.get({ sessionId: created.session.id, includeHistory: true });
  assert.equal(inspected.history.messages[0].text, "history");
  await service.resume({ sessionId: created.session.id });
  const cleaned = await service.cleanup({ sessionId: created.session.id });
  assert.equal(cleaned.removedFromRegistry, true);
  await assert.rejects(() => registry.get(created.session.id), /Unknown session/);
  assert.deepEqual(calls.map(([name]) => name), ["create", "send", "resume", "cleanup"]);
  const persisted = JSON.parse(await readFile(join(dir, "sessions.json"), "utf8"));
  assert.deepEqual(persisted.sessions, []);
});

test("serializes concurrent sends for one session", async () => {
  const { service } = await fixture();
  const created = await service.create({ provider: "cursor", cwd: "/tmp/project" });
  let active = 0;
  let maximum = 0;
  service.adapters.cursor.send = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return { status: "finished", result: "ok" };
  };
  await Promise.all([
    service.send({ sessionId: created.session.id, message: "one" }),
    service.send({ sessionId: created.session.id, message: "two" }),
  ]);
  assert.equal(maximum, 1);
});

test("reports unsupported capabilities as structured errors", async () => {
  const { service } = await fixture();
  service.adapters.claude.create = async () => { throw new UnsupportedCapabilityError("claude", "createWithoutPrompt", "initial prompt required"); };
  await assert.rejects(() => service.create({ provider: "claude", cwd: "/tmp/project" }), (error) => {
    assert.equal(error.code, "unsupported_capability");
    assert.equal(error.details.provider, "claude");
    return true;
  });
});

test("does not permit a different registry owner to inspect a session", async () => {
  const { registry } = await fixture();
  const record = await registry.create({ provider: "cursor", providerSessionId: "provider-1", cwd: "/tmp/project" });
  const other = new SessionRegistry(registry.filePath, "other-owner");
  await assert.rejects(() => other.get(record.id), /Unknown session/);
});
