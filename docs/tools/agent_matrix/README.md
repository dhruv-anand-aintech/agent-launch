# Coding Agent Feature Matrix

This directory is the source-of-truth dataset for a coding-agent/CLI/IDE comparison table, modeled after the VectorHub vector database table structure:

- `schema.json` defines columns and groups. The `$comment` values use `Group | Column | Description`.
- `data/*.json` contains one product/surface per file.
- `bundle.json` is generated from the individual files for website or app consumption.
- `icons/` holds manually curated favicons served by the compare worker (`aider.png`, `amp.svg`) when Google’s favicon service fails for a domain.
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
| Amp | CLI, Extension, SDK | May 2025 | May 2026 | full | full | full | full | none | partial |
| Antigravity | CLI, IDE | 2025 | May 2026 | full | full | full | full | none | unknown |
| Claude Code | CLI, IDE, Extension, SDK | February 2025 | May 2026 | full | full | full | full | partial | partial |
| Cline | IDE, Extension, CLI, SDK | July 2024 | May 2026 | full | full | full | full | none | full |
| Cursor | IDE, CLI, Extension, SDK | 2023 | May 2026 | full | full | unknown | full | full | full |
| Devin | Extension, CLI, Web, SDK | December 2024 | May 2026 | partial | partial | unknown | partial | full | unknown |
| GitHub Copilot | IDE, Extension, CLI, SDK | June 2025 | May 2026 | full | full | full | full | full | full |
| Kilo Code | CLI, IDE, Extension, SDK | February 2026 | May 2026 | full | full | full | full | partial | full |
| Kimi CLI | CLI, Extension, SDK | October 2025 | May 2026 | full | full | partial | full | none | full |
| OpenAI Codex CLI | CLI, Extension, SDK | April 2025 | May 2026 | full | full | full | full | full | full |
| OpenCode | CLI, SDK | 2025 | May 2026 | full | full | full | full | none | full |
| Qwen Code | CLI, Extension, SDK | June 2025 | May 2026 | full | full | full | full | partial | full |
| Roo Code | IDE, Extension, CLI | Mid-2025 | May 2026 | full | full | none | full | none | full |
| Windsurf Cascade | IDE, Extension, CLI | November 2024 | April 2026 | full | full | full | full | full | partial |

## Maintenance

Validate:

```sh
python docs/tools/agent_matrix/data_utils.py validate
```

Bundle (fetches GitHub release/commit dates for sort keys; optional `GITHUB_TOKEN` avoids rate limits):

```sh
python docs/tools/agent_matrix/data_utils.py bundle
```

On the compare site, click **Released** or **Latest Major Update** row labels to sort agent columns by date. Non-deprecated agents with a real `links.github` repo get `sort_date` from GitHub (oldest release or repo `created_at` for release; latest default-branch commit for update). Deprecated agents and products without a repo URL keep curated display values and parsed fallback dates only.

Deploy (compare.ainorthstar.tech): pushes to `main` that touch `docs/tools/agent_matrix/**`, `worker/matrix.js`, or `wrangler.toml` run `.github/workflows/deploy-matrix.yml`. Add repo secrets `CLOUDFLARE_API_TOKEN` (Workers deploy) and optionally `GITHUB_TOKEN` (bundle date enrichment).

Each non-obvious cell should carry a `source_url` and a short `comment` when the support level needs interpretation.

**SDK** in form factor means a published library to embed or drive the agent programmatically (e.g. `@cursor/sdk`, `@openai/codex-sdk`), not headless CLI flags or enterprise analytics APIs alone.
