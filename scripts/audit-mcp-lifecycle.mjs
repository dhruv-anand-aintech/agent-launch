#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, resolve } from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_ENV_FILE = "/Users/dhruvanand/Code/.env";
const DEFAULT_TIMEOUT_MS = 180_000;
const OPENAI_FALLBACK_MODEL = "gpt-5-mini";
const SECRET_NAMES = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
]);
const SECRET_VALUES = new Set();

function parseArgs(argv) {
  const options = {
    cwd: REPO_ROOT,
    envFile: DEFAULT_ENV_FILE,
    outputDir: null,
    parentProvider: "codex",
    parentSessionId: process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || null,
    providers: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--cwd") options.cwd = resolve(value), index += 1;
    else if (arg === "--env-file") options.envFile = resolve(value), index += 1;
    else if (arg === "--output-dir") options.outputDir = resolve(value), index += 1;
    else if (arg === "--parent-provider") options.parentProvider = value, index += 1;
    else if (arg === "--parent-session-id") options.parentSessionId = value, index += 1;
    else if (arg === "--providers") options.providers = value.split(",").map((item) => item.trim()).filter(Boolean), index += 1;
    else if (arg === "--timeout-ms") options.timeoutMs = Number(value), index += 1;
    else if (arg === "--help") {
      process.stdout.write("Usage: node scripts/audit-mcp-lifecycle.mjs [--providers a,b] [--cwd PATH] [--output-dir PATH] [--env-file PATH] [--parent-session-id ID] [--timeout-ms MS]\n");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.parentSessionId) throw new Error("An exact parent session ID is required (CODEX_THREAD_ID, CODEX_SESSION_ID, or --parent-session-id)");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 900_000) throw new Error("--timeout-ms must be between 1 and 900000");
  return options;
}

function decodeEnvValue(raw) {
  const value = raw.trim();
  if (value.length >= 2 && value[0] === "'" && value.at(-1) === "'") return value.slice(1, -1);
  if (value.length >= 2 && value[0] === '"' && value.at(-1) === '"') {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value.replace(/\s+#.*$/, "").trim();
}

async function loadSecretEnvironment(filePath) {
  let source;
  try { source = await readFile(filePath, "utf8"); } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && SECRET_NAMES.has(match[1])) {
      result[match[1]] = decodeEnvValue(match[2]);
      if (result[match[1]]) SECRET_VALUES.add(result[match[1]]);
    }
  }
  return result;
}

function cleanEnvironment(extra = {}) {
  return Object.fromEntries(Object.entries({ ...process.env, ...extra }).filter(([, value]) => typeof value === "string"));
}

function shortText(value, limit = 500) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  for (const secret of SECRET_VALUES) text = text.split(secret).join("[redacted]");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function joinedTextFields(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) joinedTextFields(item, output);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "text" && typeof item === "string") output.push(item);
      else joinedTextFields(item, output);
    }
  }
  return output.join("");
}

function toolBody(response) {
  const body = response.structuredContent ?? JSON.parse(response.content?.find((item) => item.type === "text")?.text ?? "null");
  if (response.isError || body?.error) {
    const error = new Error(body?.error?.message || "MCP tool returned an error");
    error.code = body?.error?.code || "tool_error";
    error.details = body?.error?.details;
    throw error;
  }
  return body;
}

function errorEvidence(error) {
  return {
    code: error?.code || error?.name || "error",
    message: shortText(error?.message || String(error), 1_000),
    ...(error?.details ? { details: shortText(error.details, 2_000) } : {}),
  };
}

async function callTool(client, name, args, timeoutMs) {
  return toolBody(await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs + 15_000 }));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function startOpenCode(cwd) {
  const port = await freePort();
  const stderr = [];
  const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd,
    env: cleanEnvironment(),
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    if (stderr.join("").length < 8_192) stderr.push(chunk.toString());
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`opencode serve exited (${child.exitCode}): ${shortText(stderr.join(""))}`);
    try {
      const response = await fetch(`${baseUrl}/global/health`);
      if (response.ok) return { child, baseUrl };
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  child.kill("SIGTERM");
  throw new Error(`opencode serve did not become ready: ${shortText(stderr.join(""))}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function runSecureCommand(command, args, { cwd, env, timeoutMs = 30_000 }) {
  const child = spawn(command, args, { cwd, env: cleanEnvironment(env), stdio: "ignore" });
  let timer;
  try {
    const result = await Promise.race([
      new Promise((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => code === 0 ? resolveExit() : reject(new Error(`${command} exited (${code ?? signal})`)));
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${command} configuration timed out`)), timeoutMs); }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

function providerRuntime(provider, secretEnv, clineDataDir) {
  const openAiKey = secretEnv.OPENAI_API_KEY;
  const runtime = { env: {}, model: undefined, fallback: null };
  if (provider === "cursor") {
    runtime.model = "gpt-5.3-codex-low";
  } else if (provider === "claude") {
    runtime.env.AGENT_MCP_CLAUDE_BIN = "/Users/dhruvanand/.local/bin/claude";
  } else if (provider === "cline" && clineDataDir) {
    runtime.env.CLINE_DATA_DIR = clineDataDir;
    runtime.env.CLINE_SESSION_BACKEND_MODE = "local";
    runtime.env.AGENT_MCP_CLINE_ARGS_JSON = JSON.stringify(["--data-dir", clineDataDir, "--acp"]);
    runtime.fallback = { provider: "openai", model: OPENAI_FALLBACK_MODEL, temporaryConfig: true };
  } else if (provider === "copilot" && openAiKey) {
    Object.assign(runtime.env, {
      COPILOT_OFFLINE: "true",
      COPILOT_PROVIDER_TYPE: "openai",
      COPILOT_PROVIDER_BASE_URL: "https://api.openai.com/v1",
      COPILOT_PROVIDER_API_KEY: openAiKey,
      COPILOT_MODEL: OPENAI_FALLBACK_MODEL,
    });
    runtime.fallback = { provider: "openai", model: OPENAI_FALLBACK_MODEL, temporaryConfig: false };
  } else if (provider === "gemini" && (secretEnv.GEMINI_API_KEY || secretEnv.GOOGLE_API_KEY)) {
    runtime.env.AGENT_MCP_GEMINI_AUTH_METHOD = "gemini-api-key";
    runtime.fallback = { provider: "google", model: "provider-default", temporaryConfig: false };
  } else if (provider === "junie" && openAiKey) {
    runtime.env.AGENT_MCP_JUNIE_ARGS_JSON = JSON.stringify(["--acp", "true", "--provider=openai", "--model=gpt", `--openai-api-key=${openAiKey}`, "--skip-update-check"]);
    runtime.fallback = { provider: "openai", model: "gpt", temporaryConfig: false };
  } else if ((provider === "kilo" || provider === "mimo") && openAiKey) {
    runtime.model = `openai/${OPENAI_FALLBACK_MODEL}`;
    runtime.fallback = { provider: "openai", model: runtime.model, temporaryConfig: false };
  } else if (provider === "kiro") {
    runtime.env.AGENT_MCP_KIRO_BIN = "/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli";
  } else if (provider === "openhands" && openAiKey) {
    Object.assign(runtime.env, {
      AGENT_MCP_OPENHANDS_ARGS_JSON: JSON.stringify(["acp", "--override-with-envs"]),
      LLM_API_KEY: openAiKey,
      LLM_BASE_URL: "https://api.openai.com/v1",
      LLM_MODEL: `openai/${OPENAI_FALLBACK_MODEL}`,
    });
    runtime.fallback = { provider: "openai", model: `openai/${OPENAI_FALLBACK_MODEL}`, temporaryConfig: false };
  } else if (provider === "qwen" && openAiKey) {
    Object.assign(runtime.env, {
      AGENT_MCP_QWEN_ARGS_JSON: JSON.stringify(["--acp", "--auth-type=openai", "--openai-api-key", openAiKey, "--openai-base-url", "https://api.openai.com/v1", "--model", "gpt-4o-mini"]),
    });
    runtime.fallback = { provider: "openai", model: "gpt-4o-mini", temporaryConfig: false };
  }
  return runtime;
}

async function readLineage(path) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function scrubRecentSecretLogs(directory, sinceMs) {
  let names;
  try { names = await readdir(directory); } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  let changed = 0;
  for (const name of names) {
    const filePath = resolve(directory, name);
    let metadata;
    try { metadata = await stat(filePath); } catch { continue; }
    if (!metadata.isFile() || metadata.mtimeMs < sinceMs - 1_000 || metadata.size > 5_000_000) continue;
    let source = await readFile(filePath, "utf8");
    const original = source;
    for (const secret of SECRET_VALUES) source = source.split(secret).join("[redacted]");
    if (source !== original) {
      await writeFile(filePath, source, { mode: metadata.mode });
      changed += 1;
    }
  }
  return changed;
}

async function auditProvider({ provider, capabilities, options, runDir, secretEnv, openCode, clineDataDir }) {
  // Keep exact-response tokens short: several local harness backends are prone
  // to clipping long opaque suffixes even when transport delivery is correct.
  const nonce = randomBytes(2).toString("hex");
  const initMarker = `INIT_OK_${provider.toUpperCase()}_${nonce}`;
  const followupMarker = `TURN2_OK_${provider.toUpperCase()}_${nonce}`;
  const stateFile = resolve(runDir, `${provider}-registry.json`);
  const lineageFile = resolve(runDir, "session-links.jsonl");
  const ownerId = `audit_${provider}_${nonce}`;
  const runtime = providerRuntime(provider, secretEnv, clineDataDir);
  const environment = cleanEnvironment({
    ...secretEnv,
    ...runtime.env,
    AGENT_MCP_STATE_FILE: stateFile,
    AGENT_MCP_LINEAGE_FILE: lineageFile,
    AGENT_MCP_OWNER_ID: ownerId,
    AGENT_MCP_PARENT_SESSION_ID: options.parentSessionId,
    AGENT_MCP_PARENT_PROVIDER: options.parentProvider,
    ...(openCode ? { AGENT_MCP_OPENCODE_URL: openCode.baseUrl } : {}),
  });
  const report = {
    provider,
    status: "failed",
    capability: capabilities[provider],
    startedAt: new Date().toISOString(),
    checks: {},
    backendFallback: runtime.fallback,
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(REPO_ROOT, "mcp/src/main.mjs")],
    cwd: REPO_ROOT,
    env: environment,
    stderr: "pipe",
  });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk) => { serverStderr = `${serverStderr}${chunk}`.slice(-16_384); });
  const client = new Client({ name: "agent-launch-lifecycle-audit", version: "1.0.0" });
  let sessionId = null;
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    report.checks.mcp = { connected: true, toolCount: toolNames.length, requiredToolsPresent: ["agent_create_session", "agent_send_message", "agent_get_session", "agent_cleanup_session"].every((name) => toolNames.includes(name)) };
    if (!report.checks.mcp.requiredToolsPresent) throw new Error("Unified MCP lifecycle tools are incomplete");

    process.stdout.write(`[${provider}] create + initialization\n`);
    const created = await callTool(client, "agent_create_session", {
      provider,
      cwd: options.cwd,
      prompt: `This is a lifecycle transport check. Do not use tools or modify files. Reply with exactly: ${initMarker}`,
      ...(runtime.model ? { model: runtime.model } : {}),
      mode: "default",
      title: `MCP lifecycle audit: ${provider}`,
      parentSessionId: options.parentSessionId,
      parentProvider: options.parentProvider,
      timeoutMs: options.timeoutMs,
    }, options.timeoutMs);
    sessionId = created.session?.id;
    if (!sessionId || !created.session?.providerSessionId) throw new Error("Create returned no MCP/provider session ID");
    report.session = {
      mcpSessionId: sessionId,
      providerSessionId: created.session.providerSessionId,
      spawnMechanism: created.session.spawnMechanism,
      parentProvider: created.session.parentProvider,
      parentSessionId: created.session.parentSessionId,
    };
    report.checks.initialization = {
      marker: initMarker,
      matched: String(created.result ?? "").includes(initMarker),
      response: shortText(created.result),
    };
    if (!report.checks.initialization.matched) throw new Error("Initialization response did not contain its unique marker");
    report.checks.createLineage = {
      captured: created.lineage?.captured === true,
      exactParent: created.lineage?.link?.parent?.provider === options.parentProvider && created.lineage?.link?.parent?.sessionId === options.parentSessionId,
      exactChild: created.lineage?.link?.child?.provider === provider && created.lineage?.link?.child?.sessionId === created.session.providerSessionId,
      evidence: created.lineage?.link?.evidence,
    };
    if (!report.checks.createLineage.captured || !report.checks.createLineage.exactParent || !report.checks.createLineage.exactChild) throw new Error("Create did not return an exact parent/child lineage link");

    process.stdout.write(`[${provider}] distinct follow-up\n`);
    const sent = await callTool(client, "agent_send_message", {
      sessionId,
      message: `This is the separate follow-up turn. Do not use tools or modify files. Reply with exactly: ${followupMarker}`,
      mode: "default",
      timeoutMs: options.timeoutMs,
    }, options.timeoutMs);
    report.checks.followup = {
      marker: followupMarker,
      matched: String(sent.result ?? "").includes(followupMarker),
      response: shortText(sent.result),
    };
    if (!report.checks.followup.matched) throw new Error("Follow-up response did not contain its unique marker");

    process.stdout.write(`[${provider}] status + history + lineage ledger\n`);
    const inspected = await callTool(client, "agent_get_session", { sessionId, includeHistory: true, limit: 500 }, options.timeoutMs);
    const serializedHistory = JSON.stringify(inspected.history ?? null);
    const streamedHistoryText = joinedTextFields(inspected.history);
    report.checks.inspect = {
      statusReturned: Boolean(inspected.status),
      historyReturned: inspected.history !== undefined,
      historyContainsInitialization: serializedHistory.includes(initMarker) || streamedHistoryText.includes(initMarker),
      historyContainsFollowup: serializedHistory.includes(followupMarker) || streamedHistoryText.includes(followupMarker),
      historyEvidence: shortText(inspected.history, 1_000),
    };
    if (!report.checks.inspect.statusReturned || !report.checks.inspect.historyReturned) throw new Error("Status/history inspection did not return provider-native data");
    if (!report.checks.inspect.historyContainsInitialization || !report.checks.inspect.historyContainsFollowup) {
      throw new Error("Provider-native history did not preserve both verified turns");
    }
    const links = await readLineage(lineageFile);
    const ledgerLink = links.find((link) => link.mcpSessionId === sessionId);
    report.checks.lineageLedger = {
      entryCount: links.length,
      found: Boolean(ledgerLink),
      exactParent: ledgerLink?.parent?.provider === options.parentProvider && ledgerLink?.parent?.sessionId === options.parentSessionId,
      exactChild: ledgerLink?.child?.provider === provider && ledgerLink?.child?.sessionId === created.session.providerSessionId,
      mechanism: ledgerLink?.mechanism,
      evidence: ledgerLink?.evidence,
    };
    if (!report.checks.lineageLedger.found || !report.checks.lineageLedger.exactParent || !report.checks.lineageLedger.exactChild) throw new Error("Persisted lineage ledger is missing the exact parent/child link");

    process.stdout.write(`[${provider}] cleanup + registry removal\n`);
    const cleaned = await callTool(client, "agent_cleanup_session", { sessionId }, options.timeoutMs);
    report.checks.cleanup = {
      capability: capabilities[provider]?.cleanup,
      removedFromRegistry: cleaned.removedFromRegistry === true,
      providerResult: cleaned.provider,
    };
    if (!report.checks.cleanup.removedFromRegistry) throw new Error("Cleanup did not remove the MCP registry record");
    try {
      await callTool(client, "agent_get_session", { sessionId }, options.timeoutMs);
      report.checks.cleanup.lookupAfterCleanup = "unexpectedly_found";
      throw new Error("Session still resolves after cleanup");
    } catch (error) {
      if (error.code !== "session_not_found") throw error;
      report.checks.cleanup.lookupAfterCleanup = "session_not_found";
    }
    sessionId = null;
    report.status = "passed";
  } catch (error) {
    report.error = errorEvidence(error);
    if (sessionId) {
      try {
        const cleaned = await callTool(client, "agent_cleanup_session", { sessionId }, options.timeoutMs);
        report.emergencyCleanup = { succeeded: true, result: cleaned };
        sessionId = null;
      } catch (cleanupError) {
        report.emergencyCleanup = { succeeded: false, error: errorEvidence(cleanupError) };
      }
    }
  } finally {
    report.endedAt = new Date().toISOString();
    if (serverStderr) report.mcpServerStderr = shortText(serverStderr, 2_000);
    await client.close().catch(() => transport.close().catch(() => {}));
  }
  return report;
}

async function main() {
  const auditStartedMs = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = options.outputDir || resolve(REPO_ROOT, ".artifacts", `mcp-lifecycle-${stamp}`);
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const secretEnv = await loadSecretEnvironment(options.envFile);
  const report = {
    version: 1,
    mechanism: "agent-launch-mcp",
    startedAt: new Date().toISOString(),
    cwd: options.cwd,
    parent: { provider: options.parentProvider, sessionId: options.parentSessionId },
    credentialEnvironment: {
      source: basename(options.envFile),
      openAiAvailable: Boolean(secretEnv.OPENAI_API_KEY),
      valuesPersisted: false,
    },
    results: [],
  };

  let openCode = null;
  let clineDataDir = null;
  let discoveryTransport = null;
  let discoveryClient = null;
  try {
    discoveryTransport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(REPO_ROOT, "mcp/src/main.mjs")],
      cwd: REPO_ROOT,
      env: cleanEnvironment(secretEnv),
      stderr: "pipe",
    });
    discoveryClient = new Client({ name: "agent-launch-lifecycle-discovery", version: "1.0.0" });
    await discoveryClient.connect(discoveryTransport);
    const capabilities = await callTool(discoveryClient, "agent_capabilities", {}, options.timeoutMs);
    const providers = options.providers || Object.keys(capabilities);
    const unknown = providers.filter((provider) => !capabilities[provider]);
    if (unknown.length) throw new Error(`Unknown providers: ${unknown.join(", ")}`);
    await discoveryClient.close();
    discoveryClient = null;
    discoveryTransport = null;

    if (providers.includes("opencode")) {
      process.stdout.write("[opencode] starting owned headless service\n");
      openCode = await startOpenCode(options.cwd);
    }
    if (providers.includes("cline") && secretEnv.OPENAI_API_KEY) {
      clineDataDir = resolve(runDir, ".cline-audit-config");
      await mkdir(clineDataDir, { recursive: true, mode: 0o700 });
      process.stdout.write("[cline] configuring isolated OpenAI backend\n");
      await runSecureCommand("cline", [
        "auth", "--provider", "openai", "--apikey", secretEnv.OPENAI_API_KEY,
        "--modelid", OPENAI_FALLBACK_MODEL, "--data-dir", clineDataDir, "--cwd", options.cwd,
      ], { cwd: options.cwd, env: { ...secretEnv, CLINE_DATA_DIR: clineDataDir } });
    }
    for (const provider of providers) {
      const result = await auditProvider({ provider, capabilities, options, runDir, secretEnv, openCode: provider === "opencode" ? openCode : null, clineDataDir });
      report.results.push(result);
      await writeFile(resolve(runDir, "report.json"), `${JSON.stringify({ ...report, endedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
      process.stdout.write(`[${provider}] ${result.status.toUpperCase()}${result.error ? `: ${result.error.code}: ${result.error.message}` : ""}\n`);
    }
  } finally {
    await discoveryClient?.close().catch(() => discoveryTransport?.close().catch(() => {}));
    await stopChild(openCode?.child);
    if (clineDataDir) await rm(clineDataDir, { recursive: true, force: true });
    report.credentialEnvironment.scrubbedProviderLogFiles = await scrubRecentSecretLogs("/Users/dhruvanand/.junie/logs", auditStartedMs);
  }
  report.endedAt = new Date().toISOString();
  report.summary = {
    total: report.results.length,
    passed: report.results.filter((result) => result.status === "passed").length,
    failed: report.results.filter((result) => result.status !== "passed").length,
  };
  await writeFile(resolve(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(resolve(runDir, "exit-status"), `${report.summary.failed ? 1 : 0}\n`, { mode: 0o600 });
  process.stdout.write(`REPORT=${resolve(runDir, "report.json")}\n`);
  process.stdout.write(`SUMMARY=${JSON.stringify(report.summary)}\n`);
  process.exitCode = report.summary.failed ? 1 : 0;
}

main().catch(async (error) => {
  process.stderr.write(`Lifecycle audit failed before completion: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
