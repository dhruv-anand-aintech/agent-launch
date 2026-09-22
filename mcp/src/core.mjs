import { AgentMcpError, UnsupportedCapabilityError, asAgentMcpError } from "./errors.mjs";
import { CAPABILITIES } from "./adapters.mjs";

const KNOWN_PROVIDERS = Object.keys(CAPABILITIES);

function assertProvider(provider) {
  if (!KNOWN_PROVIDERS.includes(provider)) {
    throw new AgentMcpError("invalid_provider", `Unknown provider: ${provider}`, { provider, providers: KNOWN_PROVIDERS });
  }
}

function capability(provider, name) {
  const value = CAPABILITIES[provider][name];
  if (!value) throw new UnsupportedCapabilityError(provider, name, CAPABILITIES[provider].note);
  return value;
}

export class SessionService {
  constructor({ registry, adapters, lineageStore = null, parentContext = null }) {
    this.registry = registry;
    this.adapters = adapters;
    this.lineageStore = lineageStore;
    this.parentContext = parentContext;
    this.activeTurns = new Map();
  }

  capabilities(provider) {
    if (provider) { assertProvider(provider); return { provider, ...CAPABILITIES[provider] }; }
    return Object.fromEntries(KNOWN_PROVIDERS.map((name) => [name, { provider: name, ...CAPABILITIES[name] }]));
  }

  async create(input) {
    assertProvider(input.provider);
    capability(input.provider, "create");
    if (!input.cwd || typeof input.cwd !== "string") throw new AgentMcpError("invalid_cwd", "cwd is required");
    if (!input.prompt && !CAPABILITIES[input.provider].createWithoutPrompt) capability(input.provider, "createWithoutPrompt");
    const adapter = this.adapters[input.provider];
    if (!adapter) throw new AgentMcpError("provider_unavailable", `No adapter configured for ${input.provider}`);
    const parent = input.parentSessionId
      ? { sessionId: input.parentSessionId, provider: input.parentProvider || "unknown", evidence: "explicit_tool_input" }
      : this.parentContext;
    const created = await adapter.create(input);
    let record = await this.registry.create({
      ...input,
      providerSessionId: created.providerSessionId,
      status: created.status,
      spawnMechanism: "agent-launch-mcp",
      parentSessionId: parent?.sessionId,
      parentProvider: parent?.provider,
    });
    let lineage = { captured: false, reason: "parent_context_unavailable" };
    if (this.lineageStore && parent?.sessionId) {
      try {
        lineage = await this.lineageStore.record({
          mcpSessionId: record.id,
          provider: input.provider,
          providerSessionId: created.providerSessionId,
          cwd: input.cwd,
          title: input.title,
          parent,
        });
      } catch {
        lineage = { captured: false, reason: "lineage_write_failed" };
      }
      if (lineage.captured) record = await this.registry.update(record.id, { lineageCaptured: true });
    }
    return { session: record, result: created.result ?? null, lineage };
  }

  async send(input) {
    const record = await this.registry.get(input.sessionId);
    capability(record.provider, "send");
    if (!input.message || typeof input.message !== "string") throw new AgentMcpError("invalid_message", "message is required");
    return this.registry.withLock(record.id, async () => {
      await this.registry.update(record.id, { status: "running" });
      try {
        const result = await this.adapters[record.provider].send({ ...input, providerSessionId: record.providerSessionId, cwd: record.cwd });
        this.activeTurns.delete(record.id);
        const updated = await this.registry.update(record.id, { status: result.status ?? "idle" });
        return { session: updated, result: result.result ?? null, provider: result };
      } catch (error) {
        await this.registry.update(record.id, { status: "error" });
        throw error;
      }
    });
  }

  async get(input) {
    const record = await this.registry.get(input.sessionId);
    const adapter = this.adapters[record.provider];
    const status = capability(record.provider, "status") && await adapter.status({ providerSessionId: record.providerSessionId, cwd: record.cwd });
    const response = { session: await this.registry.update(record.id, { status: status.status ?? record.status }), status };
    if (input.includeHistory) {
      capability(record.provider, "history");
      response.history = await adapter.history({ providerSessionId: record.providerSessionId, cwd: record.cwd, limit: input.limit });
    }
    return response;
  }

  async resume(input) {
    const record = await this.registry.get(input.sessionId);
    capability(record.provider, "resume");
    const result = await this.adapters[record.provider].resume({ providerSessionId: record.providerSessionId, cwd: record.cwd });
    const updated = await this.registry.update(record.id, { status: result.status ?? "idle" });
    return { session: updated, provider: result };
  }

  async cancel(input) {
    const record = await this.registry.get(input.sessionId);
    capability(record.provider, "cancel");
    const result = await this.adapters[record.provider].cancel({ providerSessionId: record.providerSessionId, cwd: record.cwd, turnId: input.turnId });
    const updated = await this.registry.update(record.id, { status: "cancelled" });
    return { session: updated, provider: result };
  }

  async cleanup(input) {
    const record = await this.registry.get(input.sessionId);
    capability(record.provider, "cleanup");
    const result = await this.adapters[record.provider].cleanup({ providerSessionId: record.providerSessionId, cwd: record.cwd });
    await this.registry.remove(record.id);
    return { sessionId: record.id, provider: result, removedFromRegistry: true };
  }
}

export function normalizeToolError(error) {
  return asAgentMcpError(error);
}
