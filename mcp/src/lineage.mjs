import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export const DEFAULT_LINEAGE_FILE = `${process.env.XDG_STATE_HOME || `${process.env.HOME}/.local/state`}/agent-launch/session-links.jsonl`;

const ENV_PARENT_SOURCES = [
  ["CODEX_THREAD_ID", "codex"],
  ["CODEX_SESSION_ID", "codex"],
  ["CLAUDE_CODE_SESSION_ID", "claude"],
  ["CLAUDE_SESSION_ID", "claude"],
  ["OPENCODE_SESSION_ID", "opencode"],
  ["CURSOR_AGENT_ID", "cursor"],
  ["FX_SESSION_ID", "fx"],
];

export function resolveParentContext(input = {}, env = process.env) {
  if (input.parentSessionId) {
    return {
      sessionId: input.parentSessionId,
      provider: input.parentProvider || env.AGENT_MCP_PARENT_PROVIDER || "unknown",
      evidence: "explicit_tool_input",
    };
  }
  if (env.AGENT_MCP_PARENT_SESSION_ID) {
    return {
      sessionId: env.AGENT_MCP_PARENT_SESSION_ID,
      provider: env.AGENT_MCP_PARENT_PROVIDER || "unknown",
      evidence: "explicit_environment",
    };
  }
  for (const [name, provider] of ENV_PARENT_SOURCES) {
    if (env[name]) return { sessionId: env[name], provider, evidence: `host_environment:${name}` };
  }
  return null;
}

export class SessionLineageStore {
  constructor(filePath = process.env.AGENT_MCP_LINEAGE_FILE || DEFAULT_LINEAGE_FILE) {
    this.filePath = filePath;
  }

  async record({ mcpSessionId, provider, providerSessionId, cwd, title, parent }) {
    if (!parent?.sessionId) return { captured: false, reason: "parent_context_unavailable" };
    const link = {
      version: 1,
      event: "session_link",
      id: `asl_${randomUUID()}`,
      recordedAt: new Date().toISOString(),
      mechanism: "agent-launch-mcp",
      mcpSessionId,
      child: { provider, sessionId: providerSessionId },
      parent: { provider: parent.provider || "unknown", sessionId: parent.sessionId },
      cwd,
      title: title ?? null,
      evidence: parent.evidence || "explicit",
    };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await appendFile(this.filePath, `${JSON.stringify(link)}\n`, { encoding: "utf8", mode: 0o600 });
    return { captured: true, link };
  }
}
