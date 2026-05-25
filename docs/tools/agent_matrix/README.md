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

Columns span metadata (name, form factor, release, pricing), context (rules, skills), automation (hooks, commands, subagents), settings (model, approvals, sandbox, resume, continue, headless, output, statusline, telemetry), models (arbitrary providers), and platform (hosted agent).

## Rows

| Name | Form factor | Released | Latest major update | Rules | Skills | Hooks | MCP | Hosted agent | Arbitrary models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aider | CLI | June 2023 | August 2025 | partial | partial | partial | none | none | full |
| Amp | CLI, Extension | May 2025 | May 2026 | full | full | full | full | none | partial |
| Antigravity CLI | CLI | May 2026 | May 2026 | full | full | full | full | none | none |
| Antigravity IDE | IDE | 2025 | May 2026 | partial | partial | unknown | partial | none | unknown |
| Claude Code | CLI, IDE, Extension, SDK | February 2025 | May 2026 | full | full | full | full | partial | partial |
| Cline | IDE, Extension, CLI | July 2024 | May 2026 | full | full | full | full | none | full |
| Cursor | IDE, CLI, Extension | 2023 | May 2026 | full | full | unknown | full | full | full |
| GitHub Copilot | IDE, Extension, CLI | June 2025 | May 2026 | full | full | full | full | full | full |
| Kilo Code | CLI, IDE, Extension | February 2026 | May 2026 | full | full | full | full | partial | full |
| Kimi CLI | CLI, Extension | October 2025 | May 2026 | full | full | partial | full | none | full |
| OpenAI Codex CLI | CLI, Extension | April 2025 | May 2026 | full | full | full | full | full | full |
| OpenCode | CLI | 2025 | May 2026 | full | full | full | full | none | full |
| Qwen Code | CLI, Extension | June 2025 | May 2026 | full | full | full | full | partial | full |
| Roo Code | IDE, Extension, CLI | Mid-2025 | May 2026 | full | full | none | full | none | full |
| Windsurf Cascade | IDE, Extension, CLI | November 2024 | April 2026 | full | full | full | full | full | partial |

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
