# Coding Agent Feature Matrix

This directory is the source-of-truth dataset for a coding-agent/CLI/IDE comparison table, modeled after the VectorHub vector database table structure:

- `schema.json` defines columns and groups. The `$comment` values use `Group | Column | Description`.
- `data/*.json` contains one product/surface per file.
- `bundle.json` is generated from the individual files for website or app consumption.
- `data_utils.py` validates the local support vocabulary and bundles the JSON files.

Support values:

| Value | Meaning |
| --- | --- |
| `full` | First-class documented support |
| `partial` | Supported with caveats, through another abstraction, or only on some surfaces |
| `none` | No support found |
| `unknown` | Not enough public evidence yet |
| empty string | Intentionally unfilled |

Initial columns include name, form factor, release date, latest major update, rules, skills, hooks, individual settings, and arbitrary model provider support.

## Current Rows

| Name | Form factor | Released | Latest major update | Rules | Skills | Hooks | MCP | Arbitrary models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Antigravity CLI | CLI | May 2026 | May 2026 | full | full | full | full | none |
| Antigravity IDE | IDE | 2025 | May 2026 | partial | partial | unknown | partial | unknown |
| Claude Code | CLI, IDE integrations, and SDK | February 2025 | May 2026 | full | full | full | full | partial |
| Cursor Agent CLI | CLI for Cursor Agent | 2025 | May 2026 | full | full | unknown | full | full |
| Cursor IDE | IDE | 2023 | May 2026 | full | full | unknown | full | full |
| Gemini CLI | CLI | June 2025 | May 2026 | full | partial | full | full | partial |
| OpenAI Codex CLI | CLI and hosted coding agent | April 2025 | May 2026 | full | full | full | full | full |
| OpenCode | Terminal UI and CLI | 2025 | May 2026 | full | full | full | full | full |

## Placeholder Rows

These released tools have placeholder rows with `unknown` feature support until their tracking issues are filled with sourced data:

- Aider (`data/aider.json`)
- Amp (`data/amp.json`)
- Cline (`data/cline.json`)
- Devin (`data/devin.json`)
- GitHub Copilot coding agent (`data/github-copilot-coding-agent.json`)
- Kilo Code (`data/kilo-code.json`)
- Kimi CLI (`data/kimi-cli.json`)
- Qwen Code (`data/qwen-code.json`)
- Roo Code (`data/roo-code.json`)
- Windsurf (`data/windsurf.json`)

## Maintenance

Validate:

```sh
python docs/tools/agent_matrix/data_utils.py validate
```

Bundle:

```sh
python docs/tools/agent_matrix/data_utils.py bundle
```

Each non-obvious cell should carry a `source_url` and a short `comment` when the support level needs interpretation.
