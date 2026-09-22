#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DATA_DIR = resolve(import.meta.dirname, "../docs/tools/agent_matrix/data");
const LOCATIONS = {
  aider: ".aider.chat.history.md (workspace/configured)",
  "amazon-q-developer-cli": "Per-working-directory saved history; internal path undocumented",
  amp: "Undocumented",
  antigravity: "~/.gemini/antigravity/brain/<uuid>/*.md; ~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb",
  "claude-code": "~/.claude/projects/<proj-path-dashes>/<sessionId>.jsonl",
  cline: "Undocumented",
  "codex-cli": "~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<id>.jsonl",
  "cohere-north": "Hosted service; no local default",
  "command-code": "/session-file (runtime-resolved path)",
  crush: "Local SQLite; exact path undocumented",
  cursor: "~/.cursor/projects/<slug>/agent-transcripts/<agentId>/<agentId>.jsonl; IDE: ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
  devin: "Hosted service; no local default",
  "factory-droid": "Factory-managed local session store; exact path undocumented",
  fx: "Per-workspace saved sessions; exact path undocumented",
  "gemini-cli": "Undocumented",
  "github-copilot-cli": "~/.copilot/logs/ (logs); --share=PATH exports Markdown",
  "github-copilot-coding-agent": "Hosted service; no local default documented",
  goose: "~/.local/share/goose/sessions/sessions.db (Unix); %APPDATA%\\Block\\goose\\data\\sessions\\sessions.db (Windows)",
  "grok-build": "Undocumented",
  "jetbrains-air": "Task chats retained in-app; no portable local transcript path documented",
  jules: "Hosted service; no local default",
  junie: "Undocumented; /history and Ctrl+T expose saved/current sessions",
  "kilo-code": "Undocumented",
  "kimi-cli": "Undocumented",
  kiro: "Directory-based conversation store; exact path undocumented",
  "kiro-crew": "Persistent workspace history under the Crew data home; exact path undocumented",
  "mimo-code": "$MIMOCODE_HOME/data",
  "muse-code": "Local session/event logs; exact path undocumented",
  "openai-agents-api": "Hosted service sessions; input/output/tool/event items retrieved via API",
  opencode: "~/.local/share/opencode/opencode.db; legacy: ~/.local/share/opencode/storage/session|message|part/",
  openhands: "~/.openhands/conversations/",
  pi: "~/.pi/agent/sessions/",
  "pier-code": "Local Pier state; exact path undocumented",
  qoder: "Local session store; list/resume via --list-sessions; exact path undocumented",
  "qwen-code": "Undocumented",
  "replit-agent": "Hosted service; no local default",
  "roo-code": "Undocumented",
  "trae-agent": "Trajectory JSON at auto-generated or custom path",
  windsurf: "~/.windsurf/transcripts/{trajectory_id}.jsonl when transcript hook is enabled; default store undocumented",
  zcode: "Desktop task/conversation history; exact path undocumented",
};

for (const name of (await readdir(DATA_DIR)).filter((entry) => entry.endsWith(".json")).sort()) {
  const path = resolve(DATA_DIR, name);
  const agent = JSON.parse(await readFile(path, "utf8"));
  const slug = agent.links?.slug;
  if (!(slug in LOCATIONS)) throw new Error(`Missing transcript location mapping for ${slug || name}`);
  if (!agent.transcripts) throw new Error(`Missing transcripts evidence for ${slug}`);
  const next = {};
  for (const [key, value] of Object.entries(agent)) {
    next[key] = value;
    if (key === "transcripts") {
      next.transcript_location = {
        value: LOCATIONS[slug],
        source_url: agent.transcripts.source_url,
        comment: agent.transcripts.comment,
      };
    }
  }
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

process.stdout.write(`Updated ${Object.keys(LOCATIONS).length} transcript locations.\n`);
