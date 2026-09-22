# Unified agent-session MCP server

This package adds a provider-neutral MCP surface to `agent-launch-cli`. It keeps the existing `agent-launch` CLI unchanged and adds official provider adapters for local, owner-scoped session control. One MCP server now controls SDK, HTTP, app-server, ACP, and RPC harnesses through the same seven tools.

Start it over stdio:

```sh
npm install
npm run mcp:start
```

For OpenCode, run its official headless server separately and point the adapter at it:

```sh
opencode serve --hostname 127.0.0.1 --port 4096
AGENT_MCP_OPENCODE_URL=http://127.0.0.1:4096 npm run mcp:start
```

The server exposes these tools:

| Tool | Purpose |
| --- | --- |
| `agent_capabilities` | Return the provider capability matrix; unsupported operations are explicit. |
| `agent_create_session` | Create a provider session and optionally run its initial prompt. |
| `agent_send_message` | Send a serialized follow-up turn. Concurrent turns for one session are serialized. |
| `agent_get_session` | Read status and optionally provider-native history. |
| `agent_resume_session` | Re-attach to the provider session. |
| `agent_cancel_session` | Request provider-native cancellation. |
| `agent_cleanup_session` | Delete/close the provider session where the provider supports it. |

## Capability matrix

| Provider | Official surface | Create without prompt | History | Resume | Cancel | Cleanup |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Cursor | `@cursor/sdk` local `Agent` API | yes | yes | yes | yes | close runtime only; local persisted records are retained |
| OpenCode | `@opencode-ai/sdk` against `opencode serve` | yes | yes | yes | yes | delete |
| Codex | `codex app-server --stdio` JSONL protocol | yes | yes | yes | yes | thread delete |
| Claude | `@anthropic-ai/claude-agent-sdk` | no; first query creates the session | yes | yes | yes | `deleteSession` |
| Fx, Cline, Copilot CLI, Gemini CLI, Goose, Grok Build, Junie, Kilo, Kimi CLI, Kiro, MiMo Code, OpenHands, Qwen Code | Official ACP v1 stdio server | yes | replay via `session/load` | `session/resume` or `session/load` | yes | close active runtime; saved history retained |
| Pi | Official `--mode rpc` JSONL protocol | yes | yes | yes | yes | close active runtime; saved history retained |
| Pier Code | Official Codex-compatible `app-server --stdio` JSONL protocol | yes | yes | yes | yes | thread delete |

The server does not use browser automation, CDP, raw shell command strings, or unauthenticated CLI approximations for provider control. App-server, ACP, and RPC processes are spawned with fixed executable argument vectors; provider-specific prompts remain protocol data. Each ACP session owns one subprocess because ACP agents permit one active prompt per connection; the registry still serializes concurrent sends for the same session.

## ACP providers

The shared ACP adapter uses the official `@agentclientprotocol/sdk` v1 client and supports these provider values and commands:

| Provider | Command |
| --- | --- |
| `fx` | `fx acp` |
| `cline` | `cline --acp` |
| `copilot` | `copilot --acp` |
| `gemini` | `gemini --acp` |
| `goose` | `goose acp` |
| `grok` | `grok agent stdio` |
| `junie` | `junie --acp true` |
| `kilo` | `kilo acp` |
| `kimi` | `kimi acp` |
| `kiro` | `kiro-cli acp` |
| `mimo` | `mimo acp` |
| `openhands` | `openhands acp` |
| `qwen` | `qwen --acp` |

All commands were verified from current vendor documentation or live CLI help. The real lifecycle audit below is the source of truth for current local installation, authentication, prompt, history, linkage, and cleanup health; documentation-only support must not be reported as a passing local execution.

ACP mode and model selectors are applied only when the agent advertises matching session options. `plan` and `danger` fail explicitly when no compatible ACP mode exists. Unresolved ACP permission requests are declined; the MCP does not silently grant tool access. Provider binaries can be overridden with `AGENT_MCP_<PROVIDER>_BIN`, for example `AGENT_MCP_FX_BIN=/absolute/path/to/fx`.

### Other control surfaces checked

- Pi exposes a documented bidirectional RPC mode with session state, messages, prompt streaming, and abort. It uses a dedicated adapter because Pi is not natively ACP.
- Pier generates its own app-server schemas and currently exposes the same thread/turn methods used by the Codex adapter.
- Crush and Factory Droid expose local server/daemon commands, but no stable public client protocol or supported JavaScript client was found. Muse Code's `session-message` command requires internal session credentials and is not a general lifecycle API. Amp, Aider, Amazon Q Developer CLI, Antigravity, Kiro's predecessor surfaces, and Trae provide one-shot/headless execution or interactive resume but no verified public control protocol suitable for this MCP.
- Hosted services such as Devin, Jules, GitHub Copilot coding agent, and Replit Agent were not folded into this local-session MCP; their remote task APIs have different ownership, billing, and repository-mutation semantics.

## Ownership and state

The registry stores only a generated MCP session ID, provider session ID, provider name, workspace path, owner, title, status, and timestamps. It never stores prompts, responses, or credentials. By default the owner ID is random per server process. To resume the same registry after a restart, set a stable private value in `AGENT_MCP_OWNER_ID` and use a private state file via `AGENT_MCP_STATE_FILE`. Tests always use a temporary state directory and owner.

Provider credentials are resolved by the official SDK/server from their normal environment or local authentication. They are not printed, copied, committed, or placed in the registry. The adapter never mutates global provider configuration; tests inject mocked SDK/API clients.

### Parent and child provenance

Every created session is marked with `spawnMechanism: "agent-launch-mcp"`. When the MCP host exposes an exact caller session ID, the server appends a parent-to-child record to `~/.local/state/agent-launch/session-links.jsonl` with mode `0600`. Codex provides this automatically through `CODEX_THREAD_ID`; other hosts can pass `parentSessionId` and `parentProvider` to `agent_create_session` or configure `AGENT_MCP_PARENT_SESSION_ID` and `AGENT_MCP_PARENT_PROVIDER`. No timestamp or prompt-text inference is used.

The lineage ledger stores only session IDs, providers, workspace, title, mechanism, and timestamps. It is append-only so concurrent MCP hosts do not overwrite one another, and session cleanup intentionally retains provenance. Override its path with `AGENT_MCP_LINEAGE_FILE`.

## Permissions

Provider permission modes map conservatively to the existing launcher modes. `plan` is read-only where the provider exposes it. `danger` is opt-in and passed to the official provider permission/sandbox controls. Codex app-server approval requests are declined by the current adapter rather than silently approved; a future interactive approval bridge should be added as a separately reported capability.

## Provider setup

- Cursor: install/authenticate the official Cursor Agent SDK environment and provide `CURSOR_API_KEY` if the local SDK requires one. The adapter uses `@cursor/sdk` local agents with the requested workspace.
- OpenCode: start `opencode serve`; configure `AGENT_MCP_OPENCODE_URL`. Use OpenCode's own provider authentication/configuration.
- Codex: authenticate the installed Codex CLI and ensure `codex app-server --stdio` works locally.
- Claude: install/authenticate the official Claude Agent SDK using Anthropic's documented API-key or supported provider configuration. A Claude session needs an initial prompt.
- ACP providers: install/authenticate the selected provider CLI and verify the command in the ACP table starts. The MCP launches and owns the stdio process.
- Pi: install/authenticate `pi`; the adapter launches `pi --mode rpc` and resumes by exact session ID.
- Pier: install/authenticate `pier` and ensure `pier app-server --stdio` starts locally.

Run mocked tests without provider calls:

```sh
npm run mcp:test
```

Run the real end-to-end lifecycle audit from a Codex task (this creates model traffic and then deletes/closes every created session):

```sh
npm run mcp:audit-lifecycle
```

The audit starts an isolated MCP server per provider, sends a unique initialization turn and a separate follow-up, verifies status/history and exact parent-child lineage, invokes provider cleanup, and confirms the MCP registry no longer resolves the session. Reports are written with mode `0600` under `.artifacts/mcp-lifecycle-*`. Provider credentials are loaded in memory from `/Users/dhruvanand/Code/.env`; secret values are never written to the report or logs. Use `-- --providers fx,codex` to audit a subset.

For a detached `tmux` audit, always pass `--parent-session-id "$CODEX_THREAD_ID"` explicitly when constructing the session command. A long-lived tmux server can retain an older `CODEX_THREAD_ID` in its global environment, so relying on implicit inheritance can attach otherwise-valid child evidence to the wrong Codex task.
