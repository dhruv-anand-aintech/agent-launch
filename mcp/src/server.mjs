import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { errorPayload } from "./errors.mjs";
import { CAPABILITIES, createDefaultAdapters } from "./adapters.mjs";
import { SessionRegistry } from "./registry.mjs";
import { SessionService, normalizeToolError } from "./core.mjs";
import { SessionLineageStore, resolveParentContext } from "./lineage.mjs";

const provider = z.enum(Object.keys(CAPABILITIES));
const common = { sessionId: z.string().min(1) };

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function failure(error) {
  const body = errorPayload(normalizeToolError(error));
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent: body };
}

function guarded(handler) {
  return async (input) => {
    try { return result(await handler(input)); } catch (error) { return failure(error); }
  };
}

export function createServer({ service } = {}) {
  const registry = service?.registry ?? new SessionRegistry(
    process.env.AGENT_MCP_STATE_FILE || `${process.env.XDG_STATE_HOME || `${process.env.HOME}/.local/state`}/agent-launch/mcp-sessions.json`,
    process.env.AGENT_MCP_OWNER_ID,
  );
  const sessionService = service ?? new SessionService({
    registry,
    adapters: createDefaultAdapters(),
    lineageStore: new SessionLineageStore(),
    parentContext: resolveParentContext(),
  });
  const server = new McpServer({ name: "agent-launch-unified", version: "0.3.0" });

  server.registerTool("agent_capabilities", {
    description: "Report provider-specific supported session operations. Unsupported operations are never simulated.",
    inputSchema: { provider: provider.optional() },
  }, guarded(({ provider: selected }) => sessionService.capabilities(selected)));

  server.registerTool("agent_create_session", {
    description: "Create an owner-scoped coding-agent session using the provider's official SDK/API.",
    inputSchema: {
      provider,
      cwd: z.string().min(1),
      prompt: z.string().optional(),
      model: z.string().optional(),
      mode: z.enum(["default", "ask", "plan", "auto", "danger"]).optional(),
      title: z.string().optional(),
      parentSessionId: z.string().min(1).optional(),
      parentProvider: z.string().min(1).optional(),
      timeoutMs: z.number().int().positive().max(900_000).optional(),
    },
  }, guarded((input) => sessionService.create(input)));

  server.registerTool("agent_send_message", {
    description: "Send one serialized message to an existing owner-scoped agent session.",
    inputSchema: { ...common, message: z.string().min(1), model: z.string().optional(), mode: z.enum(["default", "ask", "plan", "auto", "danger"]).optional(), timeoutMs: z.number().int().positive().max(900_000).optional() },
  }, guarded((input) => sessionService.send(input)));

  server.registerTool("agent_get_session", {
    description: "Read session status and, optionally, provider-native history.",
    inputSchema: { ...common, includeHistory: z.boolean().optional(), limit: z.number().int().positive().max(500).optional() },
  }, guarded((input) => sessionService.get(input)));

  server.registerTool("agent_resume_session", {
    description: "Re-attach to a persisted provider session using its official resume operation.",
    inputSchema: common,
  }, guarded((input) => sessionService.resume(input)));

  server.registerTool("agent_cancel_session", {
    description: "Request cancellation of the active provider turn. Cancellation is provider-native and best effort.",
    inputSchema: { ...common, turnId: z.string().optional() },
  }, guarded((input) => sessionService.cancel(input)));

  server.registerTool("agent_cleanup_session", {
    description: "Clean up a provider session when the provider exposes a supported delete/close operation.",
    inputSchema: common,
  }, guarded((input) => sessionService.cleanup(input)));

  return server;
}

export async function runServer() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
