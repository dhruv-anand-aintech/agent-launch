# Unified agent-session MCP server

This package adds a provider-neutral MCP surface to `agent-launch-cli`. It keeps the existing `agent-launch` CLI unchanged and adds official provider adapters for local, owner-scoped session control.

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

The server does not use browser automation, CDP, raw shell command strings, or unauthenticated CLI approximations for provider control. The Codex app-server is spawned with a fixed executable argument vector; provider-specific prompts remain data passed through the official protocol.

## Ownership and state

The registry stores only a generated MCP session ID, provider session ID, provider name, workspace path, owner, title, status, and timestamps. It never stores prompts, responses, or credentials. By default the owner ID is random per server process. To resume the same registry after a restart, set a stable private value in `AGENT_MCP_OWNER_ID` and use a private state file via `AGENT_MCP_STATE_FILE`. Tests always use a temporary state directory and owner.

Provider credentials are resolved by the official SDK/server from their normal environment or local authentication. They are not printed, copied, committed, or placed in the registry. The adapter never mutates global provider configuration; tests inject mocked SDK/API clients.

## Permissions

Provider permission modes map conservatively to the existing launcher modes. `plan` is read-only where the provider exposes it. `danger` is opt-in and passed to the official provider permission/sandbox controls. Codex app-server approval requests are declined by the current adapter rather than silently approved; a future interactive approval bridge should be added as a separately reported capability.

## Provider setup

- Cursor: install/authenticate the official Cursor Agent SDK environment and provide `CURSOR_API_KEY` if the local SDK requires one. The adapter uses `@cursor/sdk` local agents with the requested workspace.
- OpenCode: start `opencode serve`; configure `AGENT_MCP_OPENCODE_URL`. Use OpenCode's own provider authentication/configuration.
- Codex: authenticate the installed Codex CLI and ensure `codex app-server --stdio` works locally.
- Claude: install/authenticate the official Claude Agent SDK using Anthropic's documented API-key or supported provider configuration. A Claude session needs an initial prompt.

Run mocked tests without provider calls:

```sh
npm run mcp:test
```
