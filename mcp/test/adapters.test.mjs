import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeAdapter, CodexAdapter, CursorAdapter, OpenCodeAdapter } from "../src/adapters.mjs";

test("Cursor adapter uses the official SDK lifecycle and local workspace", async () => {
  const calls = [];
  const fakeAgent = {
    agentId: "cursor-agent-1",
    async send(message) {
      calls.push(["send", message]);
      return { id: "run-1", async wait() { return { status: "finished", result: "cursor result" }; } };
    },
    close() { calls.push(["close"]); },
  };
  const sdk = {
    Agent: {
      async create(options) { calls.push(["create", options]); return fakeAgent; },
      async resume(id, options) { calls.push(["resume", id, options]); return fakeAgent; },
      async list(options) { calls.push(["list", options]); return { items: [{ agentId: "cursor-agent-1", status: "finished" }] }; },
      async cancelRun(id, options) { calls.push(["cancelRun", id, options]); },
      messages: { async list(id, options) { calls.push(["messages", id, options]); return [{ uuid: "m1" }]; } },
    },
  };
  const adapter = new CursorAdapter({ sdk });
  const created = await adapter.create({ cwd: "/tmp/project", prompt: "hello", model: "composer-2.5", mode: "plan", title: "test" });
  assert.equal(created.providerSessionId, "cursor-agent-1");
  assert.equal((await adapter.status({ providerSessionId: "cursor-agent-1", cwd: "/tmp/project" })).status, "finished");
  assert.deepEqual((await adapter.history({ providerSessionId: "cursor-agent-1", cwd: "/tmp/project" })).messages, [{ uuid: "m1" }]);
  await adapter.resume({ providerSessionId: "cursor-agent-1", cwd: "/tmp/project" });
  await adapter.cleanup({ providerSessionId: "cursor-agent-1" });
  assert.equal(calls[0][0], "create");
  assert.deepEqual(calls[0][1].local, { cwd: "/tmp/project", settingSources: ["project"] });
  assert.equal(calls.at(-1)[0], "close");
});

test("OpenCode adapter uses the generated official client data response mode", async () => {
  const calls = [];
  const client = { session: {
    async create(options) { calls.push(["create", options]); return { id: "oc-1" }; },
    async get(options) { calls.push(["get", options]); return { id: "oc-1" }; },
    async prompt(options) { calls.push(["prompt", options]); return { parts: [{ type: "text", text: "done" }] }; },
    async status(options) { calls.push(["status", options]); return { "oc-1": { type: "idle" } }; },
    async messages(options) { calls.push(["messages", options]); return [{ info: { id: "m1" }, parts: [] }]; },
    async abort(options) { calls.push(["abort", options]); return true; },
    async delete(options) { calls.push(["delete", options]); return true; },
  } };
  const adapter = new OpenCodeAdapter({ client });
  await adapter.create({ cwd: "/tmp/project", prompt: "hello", model: "opencode-go/model" });
  await adapter.resume({ providerSessionId: "oc-1", cwd: "/tmp/project" });
  assert.equal((await adapter.send({ providerSessionId: "oc-1", cwd: "/tmp/project", message: "next" })).result, "done");
  assert.equal((await adapter.status({ providerSessionId: "oc-1", cwd: "/tmp/project" })).status, "idle");
  await adapter.history({ providerSessionId: "oc-1", cwd: "/tmp/project" });
  await adapter.cancel({ providerSessionId: "oc-1", cwd: "/tmp/project" });
  await adapter.cleanup({ providerSessionId: "oc-1", cwd: "/tmp/project" });
  assert.ok(calls.every(([, options]) => options.responseStyle === "data" && options.throwOnError === true));
  const prompt = calls.find(([name]) => name === "prompt")[1];
  assert.deepEqual(prompt.body.model, { providerID: "opencode-go", modelID: "model" });
});

test("Claude adapter uses SDK query resume/history/delete and closes queries", async () => {
  const calls = [];
  const sdk = {
    query(options) {
      calls.push(["query", options]);
      let closed = false;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "system", subtype: "init", session_id: "claude-1" };
          yield { type: "assistant", session_id: "claude-1", message: { content: [{ type: "text", text: "answer" }] } };
          yield { type: "result", subtype: "success", session_id: "claude-1", result: "answer" };
        },
        async interrupt() { calls.push(["interrupt"]); },
        close() { closed = true; calls.push(["close", closed]); },
      };
    },
    async getSessionInfo(id, options) { calls.push(["info", id, options]); return { sessionId: id }; },
    async getSessionMessages(id, options) { calls.push(["history", id, options]); return [{ session_id: id }]; },
    async deleteSession(id, options) { calls.push(["delete", id, options]); },
  };
  const adapter = new ClaudeAdapter({ sdk });
  const created = await adapter.create({ cwd: "/tmp/project", prompt: "hello", mode: "danger" });
  assert.equal(created.providerSessionId, "claude-1");
  await adapter.resume({ providerSessionId: "claude-1", cwd: "/tmp/project" });
  await adapter.send({ providerSessionId: "claude-1", cwd: "/tmp/project", message: "next" });
  await adapter.history({ providerSessionId: "claude-1", cwd: "/tmp/project" });
  await adapter.cleanup({ providerSessionId: "claude-1", cwd: "/tmp/project" });
  const query = calls.find(([name]) => name === "query")[1];
  assert.equal(query.options.permissionMode, "bypassPermissions");
  assert.equal(query.options.allowDangerouslySkipPermissions, true);
  assert.equal(calls.filter(([name]) => name === "close").length, 2);
});

test("Codex adapter maps unified lifecycle to app-server thread/turn methods", async () => {
  const calls = [];
  const client = {
    async request(method, params) {
      calls.push([method, params]);
      if (method === "thread/start") return { thread: { id: "codex-1" } };
      if (method === "thread/read") return { thread: { id: "codex-1", status: "idle", turns: [{ id: "t1" }] } };
      return {};
    },
    async turn(threadId, text) { calls.push(["turn", { threadId, text }]); return { id: "t1", status: "completed", items: [{ type: "agentMessage", text: "done" }] }; },
  };
  const adapter = new CodexAdapter({ client });
  assert.equal((await adapter.create({ cwd: "/tmp/project", prompt: "hello", mode: "plan" })).providerSessionId, "codex-1");
  await adapter.resume({ providerSessionId: "codex-1", cwd: "/tmp/project" });
  assert.equal((await adapter.send({ providerSessionId: "codex-1", message: "next" })).result, "done");
  assert.equal((await adapter.status({ providerSessionId: "codex-1" })).status, "idle");
  assert.equal((await adapter.history({ providerSessionId: "codex-1" })).turns.length, 1);
  await adapter.cleanup({ providerSessionId: "codex-1" });
  assert.equal(calls[0][0], "thread/start");
  assert.equal(calls[0][1].sandbox, "readOnly");
  assert.equal(calls.at(-1)[0], "thread/delete");
});
