import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentMcpError, UnsupportedCapabilityError } from "./errors.mjs";

export const CAPABILITIES = {
  cursor: {
    create: true, createWithoutPrompt: true, send: true, status: true, history: true,
    resume: true, cancel: true, cleanup: "close_runtime_only",
    note: "Official @cursor/sdk local agents. Cleanup closes the runtime; local persisted agent records are not deleted by the SDK.",
  },
  opencode: {
    create: true, createWithoutPrompt: true, send: true, status: true, history: true,
    resume: true, cancel: true, cleanup: "delete",
    note: "Official OpenCode generated HTTP client against an opencode serve endpoint.",
  },
  codex: {
    create: true, createWithoutPrompt: true, send: true, status: true, history: true,
    resume: true, cancel: true, cleanup: "delete",
    note: "Official Codex app-server JSONL protocol. Approval requests are declined unless a future approval bridge is configured.",
  },
  claude: {
    create: true, createWithoutPrompt: false, send: true, status: true, history: true,
    resume: true, cancel: true, cleanup: "delete",
    note: "Official Claude Agent SDK. A session is created by the first query, so an initial prompt is required.",
  },
};

const DEFAULT_TIMEOUT_MS = 120_000;

function withTimeout(promise, timeoutMs, label) {
  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AgentMcpError("timeout", `${label} timed out`, { timeoutMs: timeout })), timeout);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function textFromMessage(message) {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(textFromMessage).join("");
  if (!message || typeof message !== "object") return "";
  if (message.type === "text" && typeof message.text === "string") return message.text;
  if (typeof message.result === "string") return message.result;
  const content = Array.isArray(message.content) ? message.content : [];
  return content.filter((part) => part?.type === "text").map((part) => part.text).join("");
}

function modeToPermission(mode) {
  if (mode === "plan") return "plan";
  if (mode === "danger") return "bypassPermissions";
  if (mode === "auto") return "auto";
  return "default";
}

export class CursorAdapter {
  constructor({ sdk, sdkLoader } = {}) {
    this.sdk = sdk;
    this.sdkLoader = sdkLoader ?? (() => import("@cursor/sdk"));
    this.agents = new Map();
    this.runs = new Map();
  }

  async load() {
    return this.sdk ??= await this.sdkLoader();
  }

  async create({ cwd, prompt, model, mode = "auto", title }) {
    const sdk = await this.load();
    const agent = await sdk.Agent.create({
      name: title,
      model: { id: model || "composer-2.5" },
      mode: mode === "plan" ? "plan" : "agent",
      local: { cwd, settingSources: ["project"] },
    });
    this.agents.set(agent.agentId, agent);
    const result = prompt ? await this.send({ providerSessionId: agent.agentId, cwd, message: prompt, model, mode }) : null;
    return { providerSessionId: agent.agentId, status: result?.status ?? "idle", result: result?.result ?? null };
  }

  async resume({ providerSessionId, cwd }) {
    const sdk = await this.load();
    const agent = await sdk.Agent.resume(providerSessionId, { local: { cwd, settingSources: ["project"] } });
    this.agents.set(providerSessionId, agent);
    return { providerSessionId, status: "idle" };
  }

  async send({ providerSessionId, cwd, message, model, mode = "auto", timeoutMs }) {
    const sdk = await this.load();
    const agent = this.agents.get(providerSessionId) ?? await sdk.Agent.resume(providerSessionId, { local: { cwd, settingSources: ["project"] } });
    this.agents.set(providerSessionId, agent);
    const run = await agent.send(message, {
      model: model ? { id: model } : undefined,
      mode: mode === "plan" ? "plan" : "agent",
      local: { force: false },
    });
    this.runs.set(providerSessionId, run.id);
    try {
      const result = await withTimeout(run.wait(), timeoutMs, "Cursor run");
      return { providerSessionId, runId: run.id, status: result.status, result: result.result ?? null };
    } finally {
      this.runs.delete(providerSessionId);
    }
  }

  async status({ providerSessionId, cwd }) {
    const sdk = await this.load();
    const listed = await sdk.Agent.list({ runtime: "local", cwd });
    const info = listed.items.find((item) => item.agentId === providerSessionId);
    if (!info) throw new AgentMcpError("provider_session_not_found", `Cursor agent not found: ${providerSessionId}`);
    return { status: info.status ?? "idle", provider: info };
  }

  async history({ providerSessionId, cwd, limit }) {
    const sdk = await this.load();
    return { messages: await sdk.Agent.messages.list(providerSessionId, { runtime: "local", cwd, limit }) };
  }

  async cancel({ providerSessionId, cwd }) {
    const runId = this.runs.get(providerSessionId);
    if (!runId) return { cancelled: false, reason: "no_active_run" };
    const sdk = await this.load();
    await sdk.Agent.cancelRun(runId, { runtime: "local", cwd });
    return { cancelled: true, runId };
  }

  async cleanup({ providerSessionId }) {
    const agent = this.agents.get(providerSessionId);
    agent?.close();
    this.agents.delete(providerSessionId);
    this.runs.delete(providerSessionId);
    return { deleted: false, closed: true, note: CAPABILITIES.cursor.note };
  }
}

export class OpenCodeAdapter {
  constructor({ client, clientFactory, baseUrl = process.env.AGENT_MCP_OPENCODE_URL || "http://127.0.0.1:4096" } = {}) {
    this.client = client;
    this.clientFactory = clientFactory ?? (async (url) => {
      const { createOpencodeClient } = await import("@opencode-ai/sdk");
      return createOpencodeClient({ baseUrl: url });
    });
    this.baseUrl = baseUrl;
  }

  async load() {
    return this.client ??= await this.clientFactory(this.baseUrl);
  }

  async call(method, options) {
    const client = await this.load();
    return client.session[method]({ ...options, responseStyle: "data", throwOnError: true });
  }

  async create({ cwd, prompt, model, mode = "auto", title, timeoutMs }) {
    const session = await this.call("create", { query: { directory: cwd }, body: { title } });
    const result = prompt ? await this.send({ providerSessionId: session.id, cwd, message: prompt, model, mode, timeoutMs }) : null;
    return { providerSessionId: session.id, status: result?.status ?? "idle", result: result?.result ?? null };
  }

  async resume({ providerSessionId, cwd }) {
    await this.call("get", { path: { id: providerSessionId }, query: { directory: cwd } });
    return { providerSessionId, status: "idle" };
  }

  async send({ providerSessionId, cwd, message, model, mode = "auto", timeoutMs }) {
    const response = await withTimeout(this.call("prompt", {
      path: { id: providerSessionId },
      query: { directory: cwd },
      body: {
        parts: [{ type: "text", text: message }],
        model: model ? { providerID: model.split("/")[0], modelID: model.split("/").slice(1).join("/") } : undefined,
        agent: mode === "plan" ? "plan" : undefined,
      },
    }), timeoutMs, "OpenCode prompt");
    return { providerSessionId, status: "finished", result: response.parts?.map(textFromMessage).join("") || null };
  }

  async status({ providerSessionId, cwd }) {
    const response = await this.call("status", { query: { directory: cwd } });
    return { status: response[providerSessionId]?.type ?? response[providerSessionId] ?? "idle", provider: response[providerSessionId] ?? null };
  }

  async history({ providerSessionId, cwd, limit }) {
    return { messages: await this.call("messages", { path: { id: providerSessionId }, query: { directory: cwd, limit } }) };
  }

  async cancel({ providerSessionId, cwd }) {
    return { cancelled: await this.call("abort", { path: { id: providerSessionId }, query: { directory: cwd } }) };
  }

  async cleanup({ providerSessionId, cwd }) {
    return { deleted: await this.call("delete", { path: { id: providerSessionId }, query: { directory: cwd } }) };
  }
}

export class ClaudeAdapter {
  constructor({ sdk, sdkLoader } = {}) {
    this.sdk = sdk;
    this.sdkLoader = sdkLoader ?? (() => import("@anthropic-ai/claude-agent-sdk"));
    this.queries = new Map();
  }

  async load() {
    return this.sdk ??= await this.sdkLoader();
  }

  async run({ providerSessionId, cwd, prompt, model, mode = "auto", timeoutMs }) {
    const sdk = await this.load();
    const query = sdk.query({
      prompt,
      options: {
        cwd,
        ...(providerSessionId ? { resume: providerSessionId } : {}),
        model,
        permissionMode: modeToPermission(mode),
        allowDangerouslySkipPermissions: mode === "danger",
        settingSources: ["project"],
      },
    });
    if (providerSessionId) this.queries.set(providerSessionId, query);
    let discoveredId = providerSessionId;
    let resultText = "";
    let status = "finished";
    try {
      const consume = (async () => {
        for await (const message of query) {
          if (message?.session_id) discoveredId = message.session_id;
          if (message?.type === "assistant") resultText += textFromMessage(message.message);
          if (message?.type === "result") {
            status = message.subtype === "success" ? "finished" : "error";
            resultText = message.result || resultText;
          }
        }
        return { providerSessionId: discoveredId, status, result: resultText || null };
      })();
      return await withTimeout(consume, timeoutMs, "Claude query");
    } finally {
      this.queries.delete(discoveredId);
      query.close();
    }
  }

  async create({ cwd, prompt, model, mode, timeoutMs }) {
    if (!prompt) throw new AgentMcpError("initial_prompt_required", "Claude Agent SDK requires an initial prompt to create a session");
    return this.run({ cwd, prompt, model, mode, timeoutMs });
  }

  async resume({ providerSessionId, cwd }) {
    const sdk = await this.load();
    const info = await sdk.getSessionInfo(providerSessionId, { dir: cwd });
    if (!info) throw new AgentMcpError("provider_session_not_found", `Claude session not found: ${providerSessionId}`);
    return { providerSessionId, status: "idle", provider: info };
  }

  async send({ providerSessionId, cwd, message, model, mode, timeoutMs }) {
    return this.run({ providerSessionId, cwd, prompt: message, model, mode, timeoutMs });
  }

  async status({ providerSessionId, cwd }) {
    const sdk = await this.load();
    const info = await sdk.getSessionInfo(providerSessionId, { dir: cwd });
    if (!info) throw new AgentMcpError("provider_session_not_found", `Claude session not found: ${providerSessionId}`);
    return { status: this.queries.has(providerSessionId) ? "running" : "idle", provider: info };
  }

  async history({ providerSessionId, cwd, limit }) {
    const sdk = await this.load();
    return { messages: await sdk.getSessionMessages(providerSessionId, { dir: cwd, limit }) };
  }

  async cancel({ providerSessionId }) {
    const query = this.queries.get(providerSessionId);
    if (!query) return { cancelled: false, reason: "no_active_query" };
    await query.interrupt();
    return { cancelled: true };
  }

  async cleanup({ providerSessionId, cwd }) {
    const query = this.queries.get(providerSessionId);
    query?.close();
    const sdk = await this.load();
    await sdk.deleteSession(providerSessionId, { dir: cwd });
    return { deleted: true };
  }
}

export class CodexAppServerClient {
  constructor({ spawnImpl = spawn, command = process.env.CODEX_APP_SERVER_BIN || "codex" } = {}) {
    this.spawnImpl = spawnImpl;
    this.command = command;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.turns = new Map();
    this.activeTurns = new Map();
    this.initialized = false;
  }

  async start() {
    if (this.child) return;
    this.child = this.spawnImpl(this.command, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    const readline = createInterface({ input: this.child.stdout });
    readline.on("line", (line) => this.#handleLine(line));
    this.child.on("exit", (code, signal) => {
      const error = new AgentMcpError("provider_unavailable", `Codex app-server exited (${code ?? signal})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.child = null;
      this.initialized = false;
    });
    await this.request("initialize", {
      clientInfo: { name: "agent-launch-mcp", title: "Unified Agent MCP", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  #handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new AgentMcpError("provider_rpc_error", message.error.message || "Codex app-server request failed", { rpc: message.error }));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
      this.write({ id: message.id, result: { decision: "decline" } });
      return;
    }
    if (message.method === "turn/completed") {
      const turn = message.params?.turn;
      const waiter = turn && this.turns.get(turn.id);
      if (waiter) {
        this.turns.delete(turn.id);
        if (turn.status === "failed") waiter.reject(new AgentMcpError("provider_turn_failed", turn.error?.message || "Codex turn failed", { turn }));
        else waiter.resolve(turn);
      }
    }
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new AgentMcpError("provider_unavailable", "Codex app-server is not writable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) { this.write({ method, params }); }

  async request(method, params) {
    await (method === "initialize" || this.initialized ? Promise.resolve() : this.start());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.write({ id, method, params }); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  async turn(threadId, text, timeoutMs) {
    const started = await this.request("turn/start", { threadId, input: [{ type: "text", text }] });
    const turnId = started.turn?.id;
    if (!turnId) throw new AgentMcpError("provider_protocol_error", "Codex turn/start returned no turn id");
    this.activeTurns.set(threadId, turnId);
    const completed = new Promise((resolve, reject) => this.turns.set(turnId, { resolve, reject }));
    try {
      return await withTimeout(completed, timeoutMs, "Codex turn");
    } finally {
      this.activeTurns.delete(threadId);
    }
  }

  async close() {
    this.child?.kill();
    this.child = null;
    this.initialized = false;
  }
}

export class CodexAdapter {
  constructor({ client } = {}) { this.client = client ?? new CodexAppServerClient(); }

  async create({ cwd, prompt, model, mode = "auto", timeoutMs }) {
    const params = { cwd, model, approvalPolicy: "never", sandbox: mode === "plan" ? "readOnly" : mode === "danger" ? "dangerFullAccess" : "workspaceWrite" };
    const result = await this.client.request("thread/start", params);
    const id = result.thread?.id;
    if (!id) throw new AgentMcpError("provider_protocol_error", "Codex thread/start returned no thread id");
    const turn = prompt ? await this.client.turn(id, prompt, timeoutMs) : null;
    return { providerSessionId: id, status: turn?.status ?? "idle", result: turn?.items?.filter((item) => item.type === "agentMessage").map((item) => item.text).join("") || null };
  }

  async resume({ providerSessionId, cwd }) {
    await this.client.request("thread/resume", { threadId: providerSessionId, cwd });
    return { providerSessionId, status: "idle" };
  }

  async send({ providerSessionId, message, timeoutMs }) {
    const turn = await this.client.turn(providerSessionId, message, timeoutMs);
    return { providerSessionId, status: turn.status, result: turn.items?.filter((item) => item.type === "agentMessage").map((item) => item.text).join("") || null, turnId: turn.id };
  }

  async status({ providerSessionId }) {
    const result = await this.client.request("thread/read", { threadId: providerSessionId, includeTurns: false });
    return { status: result.thread?.status ?? "idle", provider: result.thread };
  }

  async history({ providerSessionId }) {
    const result = await this.client.request("thread/read", { threadId: providerSessionId, includeTurns: true });
    return { turns: result.thread?.turns ?? [], provider: result.thread };
  }

  async cancel({ providerSessionId, turnId }) {
    turnId ??= this.client.activeTurns?.get(providerSessionId);
    if (!turnId) return { cancelled: false, reason: "no_active_turn" };
    await this.client.request("turn/interrupt", { threadId: providerSessionId, turnId });
    return { cancelled: true, turnId };
  }

  async cleanup({ providerSessionId }) {
    await this.client.request("thread/delete", { threadId: providerSessionId });
    return { deleted: true };
  }
}

export function createDefaultAdapters() {
  return {
    cursor: new CursorAdapter(),
    opencode: new OpenCodeAdapter(),
    codex: new CodexAdapter(),
    claude: new ClaudeAdapter(),
  };
}
