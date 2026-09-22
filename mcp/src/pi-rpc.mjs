import { spawn } from "node:child_process";
import { AgentMcpError } from "./errors.mjs";

const MAX_STDERR_BYTES = 16_384;

export class PiRpcClient {
  constructor({ command = process.env.AGENT_MCP_PI_BIN || "pi", spawnImpl = spawn } = {}) {
    this.command = command;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.pending = new Map();
    this.listeners = new Set();
    this.nextId = 1;
    this.buffer = "";
    this.stderr = "";
  }

  get alive() { return Boolean(this.child && this.child.exitCode === null && !this.child.killed); }

  async start({ cwd, providerSessionId, model, title, mode }) {
    const args = ["--mode", "rpc"];
    if (providerSessionId) args.push("--session", providerSessionId);
    if (model) args.push("--model", model);
    if (title) args.push("--name", title);
    if (mode === "plan") args.push("--tools", "read,grep,find,ls");
    this.child = this.spawnImpl(this.command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => this.#consume(chunk));
    this.child.stderr.on("data", (chunk) => {
      if (this.stderr.length < MAX_STDERR_BYTES) this.stderr = (this.stderr + chunk.toString()).slice(0, MAX_STDERR_BYTES);
    });
    this.child.on("error", (error) => this.#fail(error));
    this.child.on("exit", (code, signal) => {
      if (this.child) this.#fail(new AgentMcpError("provider_unavailable", `Pi RPC exited (${code ?? signal})`, { stderr: this.stderr || undefined }));
      this.child = null;
    });
    return this.getState();
  }

  #consume(chunk) {
    this.buffer += chunk.toString();
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === "response" && message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.success) pending.resolve(message.data);
        else pending.reject(new AgentMcpError("provider_rpc_error", message.error || `Pi ${message.command} failed`, { response: message }));
      } else {
        for (const listener of this.listeners) listener(message);
      }
    }
  }

  #fail(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request(type, fields = {}) {
    if (!this.child?.stdin?.writable) throw new AgentMcpError("provider_unavailable", "Pi RPC is not writable");
    const id = `agent-launch-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async prompt(message, timeoutMs = 120_000) {
    const events = [];
    let timer;
    let unsubscribe;
    const settled = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        unsubscribe();
        reject(new AgentMcpError("timeout", "Pi prompt timed out", { timeoutMs }));
      }, timeoutMs);
      timer.unref?.();
      const listener = (event) => {
        events.push(event);
        if (event.type === "agent_settled") {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      };
      this.listeners.add(listener);
      unsubscribe = () => this.listeners.delete(listener);
    });
    try {
      await this.request("prompt", { message });
      await settled;
      return { events, text: await this.getLastAssistantText() };
    } catch (error) {
      clearTimeout(timer);
      unsubscribe?.();
      throw error;
    }
  }

  getState() { return this.request("get_state"); }
  getMessages() { return this.request("get_messages").then((data) => data.messages); }
  getLastAssistantText() { return this.request("get_last_assistant_text").then((data) => data.text); }
  setSessionName(name) { return this.request("set_session_name", { name }); }
  abort() { return this.request("abort"); }

  async close() {
    const child = this.child;
    this.child = null;
    this.#fail(new AgentMcpError("provider_unavailable", "Pi RPC client closed"));
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 1_000);
      timer.unref?.();
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
