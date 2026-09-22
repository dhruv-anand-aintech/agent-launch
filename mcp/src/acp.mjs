import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acpSdk from "@agentclientprotocol/sdk";
import { AgentMcpError } from "./errors.mjs";

const MAX_STDERR_BYTES = 16_384;

function appendBounded(current, chunk) {
  if (current.length >= MAX_STDERR_BYTES) return current;
  return (current + chunk.toString()).slice(0, MAX_STDERR_BYTES);
}

function rejectionFor(options = []) {
  const rejected = options.find((option) => option.kind === "reject_once")
    ?? options.find((option) => option.kind === "reject_always");
  return rejected
    ? { outcome: { outcome: "selected", optionId: rejected.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

function textFromUpdate(update) {
  return update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text"
    ? update.content.text
    : "";
}

export class AcpProcessClient {
  constructor({
    provider,
    command,
    args = [],
    spawnImpl = spawn,
    sdk = acpSdk,
    env = {},
  }) {
    this.provider = provider;
    this.command = command;
    this.args = args;
    this.spawnImpl = spawnImpl;
    this.sdk = sdk;
    this.env = env;
    this.child = null;
    this.connection = null;
    this.agent = null;
    this.initialization = null;
    this.collectors = new Map();
    this.histories = new Map();
    this.activePrompts = new Set();
    this.stderr = "";
    this.processGroupId = null;
  }

  get alive() { return Boolean(this.child && this.child.exitCode === null && !this.child.killed); }

  async start(cwd) {
    if (this.alive && this.agent) return this.initialization;
    this.child = this.spawnImpl(this.command, this.args, {
      cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.processGroupId = this.child.pid ?? null;
    this.child.stderr?.on("data", (chunk) => { this.stderr = appendBounded(this.stderr, chunk); });
    this.child.on("error", (error) => this.connection?.close(error));
    this.child.on("exit", (code, signal) => {
      if (code && !this.connection?.signal.aborted) {
        this.connection?.close(new AgentMcpError(
          "provider_unavailable",
          `${this.provider} ACP server exited (${code ?? signal})`,
          { stderr: this.stderr || undefined },
        ));
      }
      this.child = null;
      this.agent = null;
    });

    const stream = this.sdk.ndJsonStream(
      Writable.toWeb(this.child.stdin),
      Readable.toWeb(this.child.stdout),
    );
    const app = this.sdk.client({ name: "agent-launch-mcp" })
      .onRequest(this.sdk.methods.client.session.requestPermission, ({ params }) => rejectionFor(params.options))
      .onNotification(this.sdk.methods.client.session.update, ({ params }) => this.#recordUpdate(params));
    this.connection = app.connect(stream);
    this.agent = this.connection.agent;
    try {
      this.initialization = await this.agent.request(this.sdk.methods.agent.initialize, {
        protocolVersion: this.sdk.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "agent-launch-mcp", title: "Unified Agent MCP", version: "0.2.0" },
      });
    } catch (error) {
      await this.close();
      throw new AgentMcpError("provider_unavailable", `Could not initialize ${this.provider} ACP server`, {
        cause: error instanceof Error ? error.message : String(error),
        stderr: this.stderr || undefined,
      });
    }
    if (this.initialization.protocolVersion !== this.sdk.PROTOCOL_VERSION) {
      await this.close();
      throw new AgentMcpError("provider_protocol_error", `${this.provider} negotiated unsupported ACP version`, {
        requested: this.sdk.PROTOCOL_VERSION,
        received: this.initialization.protocolVersion,
      });
    }
    return this.initialization;
  }

  #recordUpdate(notification) {
    const history = this.histories.get(notification.sessionId) ?? [];
    history.push(notification.update);
    if (history.length > 5_000) history.splice(0, history.length - 5_000);
    this.histories.set(notification.sessionId, history);
    for (const collector of this.collectors.get(notification.sessionId) ?? []) collector.push(notification.update);
  }

  sessionUpdates(sessionId, limit) {
    const updates = this.histories.get(sessionId) ?? [];
    return limit ? updates.slice(-limit) : [...updates];
  }

  async authenticate(methodId) {
    return this.agent.request(this.sdk.methods.agent.authenticate, { methodId });
  }

  async #capture(sessionId, operation) {
    const startIndex = (this.histories.get(sessionId) ?? []).length;
    const response = await operation();
    // Some ACP agents resolve session/prompt before their final session/update
    // notification is delivered. Drain the stdio notification queue briefly,
    // then derive this turn from the durable in-runtime update history.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { response, updates: (this.histories.get(sessionId) ?? []).slice(startIndex) };
  }

  async newSession(cwd) {
    return this.agent.request(this.sdk.methods.agent.session.new, { cwd, mcpServers: [] });
  }

  async loadSession(sessionId, cwd) {
    return this.#capture(sessionId, () => this.agent.request(this.sdk.methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: [],
    }));
  }

  async resumeSession(sessionId, cwd) {
    return this.agent.request(this.sdk.methods.agent.session.resume, { sessionId, cwd, mcpServers: [] });
  }

  async prompt(sessionId, message) {
    this.activePrompts.add(sessionId);
    try {
      const captured = await this.#capture(sessionId, () => this.agent.request(this.sdk.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: message }],
      }));
      return { ...captured, text: captured.updates.map(textFromUpdate).join("") };
    } finally {
      this.activePrompts.delete(sessionId);
    }
  }

  async setMode(sessionId, modeId) {
    return this.agent.request(this.sdk.methods.agent.session.setMode, { sessionId, modeId });
  }

  async setConfigOption(sessionId, configId, value, type) {
    return this.agent.request(this.sdk.methods.agent.session.setConfigOption, {
      sessionId,
      configId,
      value,
      ...(type === "boolean" ? { type } : {}),
    });
  }

  async cancel(sessionId) {
    await this.agent.notify(this.sdk.methods.agent.session.cancel, { sessionId });
  }

  async closeSession(sessionId) {
    return this.agent.request(this.sdk.methods.agent.session.close, { sessionId });
  }

  async close() {
    this.connection?.close();
    this.connection = null;
    this.agent = null;
    this.histories.clear();
    const child = this.child;
    const processGroupId = this.processGroupId;
    this.child = null;
    this.processGroupId = null;
    if (!child && !processGroupId) return;
    const signal = (name) => {
      if (process.platform !== "win32" && processGroupId) {
        try { process.kill(-processGroupId, name); return; } catch {}
      }
      if (child?.exitCode === null) child.kill(name);
    };
    signal("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 250));
    let groupAlive = false;
    if (process.platform !== "win32" && processGroupId) {
      try { process.kill(-processGroupId, 0); groupAlive = true; } catch {}
    }
    if (groupAlive || child?.exitCode === null) signal("SIGKILL");
  }
}

export function acpTextFromUpdates(updates) {
  return updates.map(textFromUpdate).join("");
}
