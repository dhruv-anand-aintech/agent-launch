import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentMcpError, UnsupportedCapabilityError } from "./errors.mjs";
import { AcpProcessClient } from "./acp.mjs";
import { PiRpcClient } from "./pi-rpc.mjs";

const acpCapability = (surface) => ({
  create: true, createWithoutPrompt: true, send: true, status: true, history: true,
  resume: true, cancel: true, cleanup: "close_runtime_only",
  note: `${surface}. Sessions are controlled through official ACP v1; cleanup closes the active runtime but retains provider history. Permission requests are conservatively declined.`,
});

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
  fx: acpCapability("Official fx acp stdio server"),
  cline: acpCapability("Official Cline --acp stdio server"),
  copilot: acpCapability("Official GitHub Copilot CLI --acp stdio server"),
  gemini: acpCapability("Official Gemini CLI --acp stdio server"),
  goose: acpCapability("Official Goose acp stdio server"),
  grok: acpCapability("Official Grok Build agent stdio ACP server"),
  junie: acpCapability("Official Junie --acp true stdio server"),
  kilo: acpCapability("Official Kilo Code acp stdio server"),
  kimi: acpCapability("Official Kimi CLI acp stdio server"),
  kiro: acpCapability("Official Kiro CLI acp stdio server"),
  mimo: acpCapability("Official MiMo Code acp stdio server"),
  openhands: acpCapability("Official OpenHands acp stdio server"),
  qwen: acpCapability("Official Qwen Code --acp stdio server"),
  pi: {
    create: true, createWithoutPrompt: true, send: true, status: true, history: true,
    resume: true, cancel: true, cleanup: "close_runtime_only",
    note: "Official Pi RPC JSONL mode. Cleanup closes the RPC runtime; persisted session files are retained.",
  },
  pier: {
    create: true, createWithoutPrompt: true, send: true, status: true, history: true,
    resume: true, cancel: true, cleanup: "delete",
    note: "Official Pier app-server JSONL protocol. Approval requests are declined.",
  },
};

export const ACP_PROVIDER_SPECS = {
  fx: { commandEnv: "AGENT_MCP_FX_BIN", command: "fx", args: ["acp"] },
  cline: { commandEnv: "AGENT_MCP_CLINE_BIN", command: "cline", args: ["--acp"] },
  copilot: { commandEnv: "AGENT_MCP_COPILOT_BIN", command: "copilot", args: ["--acp"] },
  gemini: { commandEnv: "AGENT_MCP_GEMINI_BIN", command: "gemini", args: ["--acp"] },
  goose: { commandEnv: "AGENT_MCP_GOOSE_BIN", command: "goose", args: ["acp"] },
  grok: { commandEnv: "AGENT_MCP_GROK_BIN", command: "grok", args: ["agent", "stdio"] },
  junie: { commandEnv: "AGENT_MCP_JUNIE_BIN", command: "junie", args: ["--acp", "true"] },
  kilo: { commandEnv: "AGENT_MCP_KILO_BIN", command: "kilo", args: ["acp"] },
  kimi: { commandEnv: "AGENT_MCP_KIMI_BIN", command: "kimi", args: ["acp"] },
  kiro: { commandEnv: "AGENT_MCP_KIRO_BIN", command: "kiro-cli", args: ["acp"] },
  mimo: { commandEnv: "AGENT_MCP_MIMO_BIN", command: "mimo", args: ["acp"] },
  openhands: { commandEnv: "AGENT_MCP_OPENHANDS_BIN", command: "openhands", args: ["acp"], env: { OPENHANDS_SUPPRESS_BANNER: "1" } },
  qwen: { commandEnv: "AGENT_MCP_QWEN_BIN", command: "qwen", args: ["--acp"] },
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

function textFromThreadItems(items = []) {
  return items.flatMap((item) => {
    if (item?.type === "agentMessage" && typeof item.text === "string") return [item.text];
    if (item?.type === "agent_message") {
      if (typeof item.text === "string") return [item.text];
      return (item.content ?? []).filter((part) => part?.type === "input_text" || part?.type === "text").map((part) => part.text);
    }
    return [];
  }).join("");
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
    try {
      const result = prompt ? await this.send({ providerSessionId: agent.agentId, cwd, message: prompt, model, mode }) : null;
      return { providerSessionId: agent.agentId, status: result?.status ?? "idle", result: result?.result ?? null };
    } catch (error) {
      agent.close();
      this.agents.delete(agent.agentId);
      this.runs.delete(agent.agentId);
      throw error;
    }
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
      if (result.status === "error") {
        throw new AgentMcpError("provider_turn_failed", result.error?.message || "Cursor run failed", { runId: run.id, status: result.status });
      }
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
    try {
      const result = prompt ? await this.send({ providerSessionId: session.id, cwd, message: prompt, model, mode, timeoutMs }) : null;
      return { providerSessionId: session.id, status: result?.status ?? "idle", result: result?.result ?? null };
    } catch (error) {
      await this.call("delete", { path: { id: session.id }, query: { directory: cwd } }).catch(() => {});
      throw error;
    }
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
        ...(process.env.AGENT_MCP_CLAUDE_BIN ? { pathToClaudeCodeExecutable: process.env.AGENT_MCP_CLAUDE_BIN } : {}),
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

function normalizeSelector(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function selectOptions(option) {
  if (option?.type !== "select") return [];
  return option.options.flatMap((item) => Array.isArray(item?.options) ? item.options : [item]);
}

function requestedAcpMode(mode, availableModes = []) {
  if (!mode || mode === "default") return null;
  const aliases = {
    ask: ["ask", "default", "manual"],
    plan: ["plan", "readonly", "read"],
    auto: ["code", "auto", "autoedit", "acceptedits", "agent", "act", "build"],
    danger: ["yolo", "danger", "bypasspermissions", "allowall"],
  }[mode] ?? [mode];
  return availableModes.find((candidate) => aliases.includes(normalizeSelector(candidate.id))
    || aliases.includes(normalizeSelector(candidate.name)));
}

export class AcpAdapter {
  constructor({ provider, spec = ACP_PROVIDER_SPECS[provider], clientFactory } = {}) {
    if (!provider || !spec) throw new AgentMcpError("invalid_provider", `Unknown ACP provider: ${provider}`);
    this.provider = provider;
    this.spec = spec;
    this.clientFactory = clientFactory ?? ((options) => new AcpProcessClient(options));
    this.clients = new Map();
  }

  makeClient() {
    const prefix = `AGENT_MCP_${this.provider.toUpperCase()}`;
    let args = this.spec.args;
    if (process.env[`${prefix}_ARGS_JSON`]) {
      try {
        const parsed = JSON.parse(process.env[`${prefix}_ARGS_JSON`]);
        if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) throw new Error("expected an array of strings");
        args = parsed;
      } catch (error) {
        throw new AgentMcpError("invalid_provider_config", `${prefix}_ARGS_JSON is invalid`, {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.clientFactory({
      provider: this.provider,
      command: process.env[this.spec.commandEnv] || this.spec.command,
      args,
      env: this.spec.env,
    });
  }

  async startClient(cwd, timeoutMs) {
    const client = this.makeClient();
    try {
      await withTimeout(client.start(cwd), timeoutMs, `${this.provider} ACP initialize`);
      const authMethod = process.env[`AGENT_MCP_${this.provider.toUpperCase()}_AUTH_METHOD`];
      if (authMethod) await withTimeout(client.authenticate(authMethod), timeoutMs, `${this.provider} ACP authenticate`);
      return client;
    } catch (error) {
      await client.close?.();
      throw error;
    }
  }

  async configure(client, providerSessionId, state, { mode, model }) {
    if (mode && mode !== "default") {
      const selected = requestedAcpMode(mode, state?.modes?.availableModes);
      if (selected) await withTimeout(client.setMode(providerSessionId, selected.id), undefined, `${this.provider} ACP set mode`);
      else if (mode === "plan" || mode === "danger") {
        throw new UnsupportedCapabilityError(this.provider, `mode:${mode}`, `ACP session did not advertise a compatible ${mode} mode`);
      }
    }
    if (model) {
      const modelConfig = state?.configOptions?.find((option) => option.category === "model"
        || normalizeSelector(option.id).includes("model")
        || normalizeSelector(option.name).includes("model"));
      const selected = selectOptions(modelConfig).find((option) => option.value === model
        || normalizeSelector(option.name) === normalizeSelector(model));
      if (!modelConfig || !selected) {
        throw new UnsupportedCapabilityError(this.provider, "model", `ACP session did not advertise model ${model}`);
      }
      await withTimeout(client.setConfigOption(providerSessionId, modelConfig.id, selected.value), undefined, `${this.provider} ACP set model`);
    }
  }

  async create({ cwd, prompt, model, mode = "default", timeoutMs }) {
    const client = await this.startClient(cwd, timeoutMs);
    let created;
    try {
      created = await withTimeout(client.newSession(cwd), timeoutMs, `${this.provider} ACP session/new`);
      await this.configure(client, created.sessionId, created, { mode, model });
      this.clients.set(created.sessionId, client);
      const result = prompt ? await this.send({ providerSessionId: created.sessionId, cwd, message: prompt, timeoutMs }) : null;
      return { providerSessionId: created.sessionId, status: result?.status ?? "idle", result: result?.result ?? null };
    } catch (error) {
      if (created?.sessionId) this.clients.delete(created.sessionId);
      if (created?.sessionId && client.initialization?.agentCapabilities?.sessionCapabilities?.close) {
        await client.closeSession(created.sessionId).catch(() => {});
      }
      await client.close?.();
      throw error;
    }
  }

  async attach({ providerSessionId, cwd, timeoutMs }) {
    const existing = this.clients.get(providerSessionId);
    if (existing && existing.alive !== false) return existing;
    const client = await this.startClient(cwd, timeoutMs);
    const capabilities = client.initialization?.agentCapabilities ?? {};
    try {
      if (capabilities.sessionCapabilities?.resume) {
        await withTimeout(client.resumeSession(providerSessionId, cwd), timeoutMs, `${this.provider} ACP session/resume`);
      } else if (capabilities.loadSession) {
        await withTimeout(client.loadSession(providerSessionId, cwd), timeoutMs, `${this.provider} ACP session/load`);
      } else {
        throw new UnsupportedCapabilityError(this.provider, "resume", "ACP agent did not advertise loadSession or session/resume");
      }
      this.clients.set(providerSessionId, client);
      return client;
    } catch (error) {
      await client.close?.();
      throw error;
    }
  }

  async resume(input) {
    await this.attach(input);
    return { providerSessionId: input.providerSessionId, status: "idle" };
  }

  async send({ providerSessionId, cwd, message, timeoutMs }) {
    const client = await this.attach({ providerSessionId, cwd, timeoutMs });
    try {
      const response = await withTimeout(client.prompt(providerSessionId, message), timeoutMs, `${this.provider} ACP prompt`);
      return { providerSessionId, status: "finished", result: response.text || null, stopReason: response.response?.stopReason };
    } catch (error) {
      await client.cancel?.(providerSessionId).catch(() => {});
      throw error;
    }
  }

  async status({ providerSessionId, cwd }) {
    const client = await this.attach({ providerSessionId, cwd });
    return {
      status: client.activePrompts?.has(providerSessionId) ? "running" : "idle",
      provider: { protocol: "acp", agent: client.initialization?.agentInfo ?? null },
    };
  }

  async history({ providerSessionId, cwd, limit }) {
    const active = this.clients.get(providerSessionId);
    if (active?.alive !== false) {
      return { updates: active.sessionUpdates(providerSessionId, limit), protocol: "acp", source: "active_runtime" };
    }
    const client = await this.startClient(cwd);
    try {
      if (!client.initialization?.agentCapabilities?.loadSession) {
        throw new UnsupportedCapabilityError(this.provider, "history", "ACP agent did not advertise loadSession replay");
      }
      const loaded = await withTimeout(client.loadSession(providerSessionId, cwd), undefined, `${this.provider} ACP history load`);
      const updates = limit ? loaded.updates.slice(-limit) : loaded.updates;
      return { updates, protocol: "acp" };
    } finally {
      await client.close?.();
    }
  }

  async cancel({ providerSessionId }) {
    const client = this.clients.get(providerSessionId);
    if (!client || !client.activePrompts?.has(providerSessionId)) return { cancelled: false, reason: "no_active_prompt" };
    await client.cancel(providerSessionId);
    return { cancelled: true };
  }

  async cleanup({ providerSessionId }) {
    const client = this.clients.get(providerSessionId);
    if (!client) return { deleted: false, closed: false, note: "no_active_runtime" };
    const supportsClose = Boolean(client.initialization?.agentCapabilities?.sessionCapabilities?.close);
    if (supportsClose) await withTimeout(client.closeSession(providerSessionId), undefined, `${this.provider} ACP close`).catch(() => {});
    await client.close();
    this.clients.delete(providerSessionId);
    return { deleted: false, closed: true, providerClose: supportsClose };
  }
}

export class PiAdapter {
  constructor({ clientFactory } = {}) {
    this.clientFactory = clientFactory ?? (() => new PiRpcClient());
    this.clients = new Map();
  }

  async create({ cwd, prompt, model, mode = "default", title, timeoutMs }) {
    const client = this.clientFactory();
    let state;
    try {
      state = await withTimeout(client.start({ cwd, model, mode, title }), timeoutMs, "Pi RPC start");
      this.clients.set(state.sessionId, client);
      const result = prompt ? await this.send({ providerSessionId: state.sessionId, cwd, message: prompt, timeoutMs }) : null;
      return { providerSessionId: state.sessionId, status: result?.status ?? "idle", result: result?.result ?? null };
    } catch (error) {
      if (state?.sessionId) this.clients.delete(state.sessionId);
      await client.close?.().catch(() => {});
      throw error;
    }
  }

  async attach({ providerSessionId, cwd, timeoutMs }) {
    const existing = this.clients.get(providerSessionId);
    if (existing && existing.alive !== false) return existing;
    const client = this.clientFactory();
    const state = await withTimeout(client.start({ cwd, providerSessionId }), timeoutMs, "Pi RPC resume");
    if (state.sessionId !== providerSessionId) {
      await client.close();
      throw new AgentMcpError("provider_session_not_found", `Pi resumed ${state.sessionId} instead of ${providerSessionId}`);
    }
    this.clients.set(providerSessionId, client);
    return client;
  }

  async resume(input) { await this.attach(input); return { providerSessionId: input.providerSessionId, status: "idle" }; }

  async send({ providerSessionId, cwd, message, timeoutMs }) {
    const client = await this.attach({ providerSessionId, cwd, timeoutMs });
    try {
      const result = await client.prompt(message, timeoutMs);
      return { providerSessionId, status: "finished", result: result.text || null };
    } catch (error) {
      await client.abort?.().catch(() => {});
      throw error;
    }
  }

  async status({ providerSessionId, cwd }) {
    const client = await this.attach({ providerSessionId, cwd });
    const state = await withTimeout(client.getState(), undefined, "Pi RPC status");
    return { status: state.isStreaming ? "running" : "idle", provider: state };
  }

  async history({ providerSessionId, cwd, limit }) {
    const client = await this.attach({ providerSessionId, cwd });
    const messages = await withTimeout(client.getMessages(), undefined, "Pi RPC history");
    return { messages: limit ? messages.slice(-limit) : messages };
  }

  async cancel({ providerSessionId }) {
    const client = this.clients.get(providerSessionId);
    if (!client) return { cancelled: false, reason: "no_active_runtime" };
    await client.abort();
    return { cancelled: true };
  }

  async cleanup({ providerSessionId }) {
    const client = this.clients.get(providerSessionId);
    await client?.close();
    this.clients.delete(providerSessionId);
    return { deleted: false, closed: Boolean(client) };
  }
}

export class CodexAppServerClient {
  constructor({ spawnImpl = spawn, command = process.env.CODEX_APP_SERVER_BIN || "codex", args = ["app-server", "--stdio"] } = {}) {
    this.spawnImpl = spawnImpl;
    this.command = command;
    this.args = args;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.turns = new Map();
    this.turnTexts = new Map();
    this.activeTurns = new Map();
    this.initialized = false;
  }

  async start() {
    if (this.child) return;
    this.child = this.spawnImpl(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
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
      clientInfo: { name: "agent-launch-mcp", title: "Unified Agent MCP", version: "0.3.0" },
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
    if (message.method === "item/agentMessage/delta") {
      const turnId = message.params?.turnId;
      if (turnId) this.turnTexts.set(turnId, `${this.turnTexts.get(turnId) ?? ""}${message.params?.delta ?? ""}`);
      return;
    }
    if (message.method === "item/completed") {
      const turnId = message.params?.turnId;
      const text = textFromThreadItems([message.params?.item]);
      if (turnId && text && !this.turnTexts.get(turnId)) this.turnTexts.set(turnId, text);
      return;
    }
    if (message.method === "turn/completed") {
      const turn = message.params?.turn;
      const waiter = turn && this.turns.get(turn.id);
      if (waiter) {
        this.turns.delete(turn.id);
        turn.capturedText = this.turnTexts.get(turn.id) ?? "";
        this.turnTexts.delete(turn.id);
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
    this.turnTexts.set(turnId, "");
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
    const params = { cwd, model, approvalPolicy: "never", sandbox: mode === "plan" ? "read-only" : mode === "danger" ? "danger-full-access" : "workspace-write" };
    const result = await this.client.request("thread/start", params);
    const id = result.thread?.id;
    if (!id) throw new AgentMcpError("provider_protocol_error", "Codex thread/start returned no thread id");
    try {
      const turn = prompt ? await this.client.turn(id, prompt, timeoutMs) : null;
      const text = turn ? await this.turnText(id, turn) : null;
      return { providerSessionId: id, status: turn?.status ?? "idle", result: text || null };
    } catch (error) {
      await this.client.request("thread/delete", { threadId: id }).catch(() => {});
      throw error;
    }
  }

  async turnText(threadId, turn) {
    if (turn?.capturedText) return turn.capturedText;
    const inline = textFromThreadItems(turn?.items);
    if (inline) return inline;
    try {
      const page = await this.client.request("thread/turns/items/list", { threadId, turnId: turn.id, limit: 500, sortDirection: "ascending" });
      return textFromThreadItems(page?.data);
    } catch {
      return "";
    }
  }

  async resume({ providerSessionId, cwd }) {
    await this.client.request("thread/resume", { threadId: providerSessionId, cwd });
    return { providerSessionId, status: "idle" };
  }

  async send({ providerSessionId, message, timeoutMs }) {
    const turn = await this.client.turn(providerSessionId, message, timeoutMs);
    return { providerSessionId, status: turn.status, result: await this.turnText(providerSessionId, turn) || null, turnId: turn.id };
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

export class PierAdapter extends CodexAdapter {
  constructor({ client } = {}) {
    super({
      client: client ?? new CodexAppServerClient({
        command: process.env.PIER_APP_SERVER_BIN || "pier",
        args: ["app-server", "--stdio"],
      }),
    });
  }
}

export function createDefaultAdapters() {
  const adapters = {
    cursor: new CursorAdapter(),
    opencode: new OpenCodeAdapter(),
    codex: new CodexAdapter(),
    claude: new ClaudeAdapter(),
    pi: new PiAdapter(),
    pier: new PierAdapter(),
  };
  for (const provider of Object.keys(ACP_PROVIDER_SPECS)) adapters[provider] = new AcpAdapter({ provider });
  return adapters;
}
