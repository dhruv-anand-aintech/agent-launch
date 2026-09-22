import test from "node:test";
import assert from "node:assert/strict";
import {
  ACP_PROVIDER_SPECS,
  AcpAdapter,
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  OpenCodeAdapter,
  PiAdapter,
  PierAdapter,
} from "../src/adapters.mjs";

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

test("Cursor adapter closes an agent when its initialization turn fails", async () => {
  let closed = false;
  const agent = {
    agentId: "cursor-failed",
    async send() { return { id: "run-failed", async wait() { return { status: "error", error: { message: "bad key" } }; } }; },
    close() { closed = true; },
  };
  const adapter = new CursorAdapter({ sdk: { Agent: { async create() { return agent; } } } });
  await assert.rejects(() => adapter.create({ cwd: "/tmp/project", prompt: "hello" }), /bad key/);
  assert.equal(closed, true);
  assert.equal(adapter.agents.has("cursor-failed"), false);
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

test("OpenCode adapter deletes a session when its initialization prompt fails", async () => {
  let deleted = false;
  const client = { session: {
    async create() { return { id: "oc-failed" }; },
    async prompt() { throw new Error("prompt failed"); },
    async delete() { deleted = true; return true; },
  } };
  const adapter = new OpenCodeAdapter({ client });
  await assert.rejects(() => adapter.create({ cwd: "/tmp/project", prompt: "hello" }), /prompt failed/);
  assert.equal(deleted, true);
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

test("Claude adapter forwards an explicit CLI executable path", async () => {
  const previous = process.env.AGENT_MCP_CLAUDE_BIN;
  process.env.AGENT_MCP_CLAUDE_BIN = "/tmp/claude";
  let received;
  try {
    const adapter = new ClaudeAdapter({ sdk: {
      query(input) {
        received = input;
        return {
          async *[Symbol.asyncIterator]() { yield { type: "system", session_id: "claude-path" }; },
          close() {},
        };
      },
    } });
    await adapter.create({ cwd: "/tmp/project", prompt: "hello" });
    assert.equal(received.options.pathToClaudeCodeExecutable, "/tmp/claude");
  } finally {
    if (previous === undefined) delete process.env.AGENT_MCP_CLAUDE_BIN;
    else process.env.AGENT_MCP_CLAUDE_BIN = previous;
  }
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
  await adapter.create({ cwd: "/tmp/project" });
  await adapter.create({ cwd: "/tmp/project", mode: "danger" });
  await adapter.resume({ providerSessionId: "codex-1", cwd: "/tmp/project" });
  assert.equal((await adapter.send({ providerSessionId: "codex-1", message: "next" })).result, "done");
  assert.equal((await adapter.status({ providerSessionId: "codex-1" })).status, "idle");
  assert.equal((await adapter.history({ providerSessionId: "codex-1" })).turns.length, 1);
  await adapter.cleanup({ providerSessionId: "codex-1" });
  assert.equal(calls[0][0], "thread/start");
  assert.deepEqual(calls.filter(([method]) => method === "thread/start").map(([, params]) => params.sandbox), [
    "read-only",
    "workspace-write",
    "danger-full-access",
  ]);
  assert.equal(calls.at(-1)[0], "thread/delete");
});

test("Codex adapter deletes a thread when its initialization turn fails", async () => {
  const calls = [];
  const adapter = new CodexAdapter({ client: {
    async request(method, params) {
      calls.push([method, params]);
      if (method === "thread/start") return { thread: { id: "codex-failed" } };
      return {};
    },
    async turn() { throw new Error("turn failed"); },
  } });
  await assert.rejects(() => adapter.create({ cwd: "/tmp/project", prompt: "hello" }), /turn failed/);
  assert.ok(calls.some(([method, params]) => method === "thread/delete" && params.threadId === "codex-failed"));
});

test("ACP adapter controls native sessions and maps advertised mode/model selectors", async () => {
  const calls = [];
  const clients = [];
  class FakeAcpClient {
    constructor() {
      this.alive = true;
      this.activePrompts = new Set();
      this.initialization = {
        agentInfo: { name: "fake-acp", version: "1.0.0" },
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {} } },
      };
      clients.push(this);
    }
    async start(cwd) { calls.push(["start", cwd]); }
    async newSession(cwd) {
      calls.push(["new", cwd]);
      return {
        sessionId: "acp-1",
        modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code" }] },
        configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "small", options: [{ value: "large", name: "Large" }] }],
      };
    }
    async setMode(id, mode) { calls.push(["mode", id, mode]); }
    async setConfigOption(id, config, value) { calls.push(["config", id, config, value]); }
    async prompt(id, message) { calls.push(["prompt", id, message]); return { text: "acp result", response: { stopReason: "end_turn" } }; }
    sessionUpdates(id) { calls.push(["sessionUpdates", id]); return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "history" } }]; }
    async resumeSession(id, cwd) { calls.push(["resume", id, cwd]); }
    async loadSession(id, cwd) { calls.push(["load", id, cwd]); return { updates: [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "history" } }] }; }
    async cancel(id) { calls.push(["cancel", id]); }
    async closeSession(id) { calls.push(["closeSession", id]); }
    async close() { this.alive = false; calls.push(["close"]); }
  }
  const adapter = new AcpAdapter({ provider: "fx", clientFactory: () => new FakeAcpClient() });
  const created = await adapter.create({ cwd: "/tmp/project", prompt: "hello", mode: "auto", model: "large" });
  assert.equal(created.providerSessionId, "acp-1");
  assert.equal(created.result, "acp result");
  assert.deepEqual(calls.find(([name]) => name === "mode"), ["mode", "acp-1", "code"]);
  assert.deepEqual(calls.find(([name]) => name === "config"), ["config", "acp-1", "model", "large"]);
  assert.equal((await adapter.status({ providerSessionId: "acp-1", cwd: "/tmp/project" })).status, "idle");
  assert.equal((await adapter.history({ providerSessionId: "acp-1", cwd: "/tmp/project" })).updates.length, 1);
  clients[0].activePrompts.add("acp-1");
  assert.equal((await adapter.cancel({ providerSessionId: "acp-1" })).cancelled, true);
  await adapter.cleanup({ providerSessionId: "acp-1" });
  assert.ok(calls.some(([name]) => name === "closeSession"));
  assert.deepEqual(Object.keys(ACP_PROVIDER_SPECS).sort(), [
    "cline", "copilot", "fx", "gemini", "goose", "grok", "junie", "kilo", "kimi", "kiro", "mimo", "openhands", "qwen",
  ]);
});

test("Pi adapter uses the documented RPC lifecycle without deleting persisted history", async () => {
  const calls = [];
  const fake = {
    alive: true,
    async start(options) { calls.push(["start", options]); return { sessionId: "pi-1", isStreaming: false }; },
    async prompt(message) { calls.push(["prompt", message]); return { text: "pi result" }; },
    async getState() { calls.push(["state"]); return { sessionId: "pi-1", isStreaming: false }; },
    async getMessages() { calls.push(["messages"]); return [{ role: "assistant", content: "pi result" }]; },
    async abort() { calls.push(["abort"]); },
    async close() { calls.push(["close"]); this.alive = false; },
  };
  const adapter = new PiAdapter({ clientFactory: () => fake });
  const created = await adapter.create({ cwd: "/tmp/project", prompt: "hello", model: "provider/model", mode: "plan", title: "Pi test" });
  assert.equal(created.providerSessionId, "pi-1");
  assert.equal(created.result, "pi result");
  assert.equal((await adapter.status({ providerSessionId: "pi-1", cwd: "/tmp/project" })).status, "idle");
  assert.equal((await adapter.history({ providerSessionId: "pi-1", cwd: "/tmp/project" })).messages.length, 1);
  await adapter.cancel({ providerSessionId: "pi-1" });
  assert.deepEqual(await adapter.cleanup({ providerSessionId: "pi-1" }), { deleted: false, closed: true });
  assert.deepEqual(calls[0][1], { cwd: "/tmp/project", model: "provider/model", mode: "plan", title: "Pi test" });
});

test("Pi adapter closes its runtime when initial prompting fails", async () => {
  let closed = false;
  const adapter = new PiAdapter({
    clientFactory: () => ({
      async start() { return { sessionId: "pi-failed" }; },
      async prompt() { throw new Error("prompt failed"); },
      async abort() {},
      async close() { closed = true; },
    }),
  });
  await assert.rejects(() => adapter.create({ cwd: "/tmp/project", prompt: "fail" }), /prompt failed/);
  assert.equal(closed, true);
  assert.equal(adapter.clients.has("pi-failed"), false);
});

test("Pier adapter reuses the official Codex-compatible app-server lifecycle", async () => {
  const calls = [];
  const client = {
    async request(method, params) {
      calls.push([method, params]);
      if (method === "thread/start") return { thread: { id: "pier-1" } };
      if (method === "thread/read") return { thread: { id: "pier-1", status: "idle", turns: [] } };
      if (method === "thread/turns/items/list") return { data: [{ type: "agent_message", text: "pier result" }] };
      return {};
    },
    async turn() { return { id: "turn-1", status: "completed", items: [], capturedText: "pier result" }; },
  };
  const adapter = new PierAdapter({ client });
  assert.equal((await adapter.create({ cwd: "/tmp/project" })).providerSessionId, "pier-1");
  await adapter.resume({ providerSessionId: "pier-1", cwd: "/tmp/project" });
  assert.equal((await adapter.send({ providerSessionId: "pier-1", message: "hello" })).result, "pier result");
  await adapter.cleanup({ providerSessionId: "pier-1" });
  assert.deepEqual(calls.map(([method]) => method), ["thread/start", "thread/resume", "thread/delete"]);
});
