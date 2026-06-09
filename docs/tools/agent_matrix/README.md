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

Columns span metadata (name, form factor, release, pricing), context (rules, skills, transcripts), automation (hooks, commands, subagents), settings (model, approvals, sandbox, resume, continue, headless, output, statusline, telemetry), models (arbitrary providers), and platform (hosted agent).

Form factor values are deliberately strict: each value should have a concrete per-form-factor install/download link in `form_factor.links`. Use `Extension` only for an installable editor extension, `IDE` for a standalone editor/IDE, `Mac App` for a native macOS desktop app that is distinct from the IDE surface, `CLI` for a terminal binary, `SDK` for a published programmatic API/library, and `Web` for a hosted browser app.

## Rows

| Name | Form factor | Released | Latest major update | Rules | Skills | Transcripts | Hooks | MCP | Hosted agent | Arbitrary models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aider | CLI | Jun '23 | May '26 | partial | partial | partial | partial | none | none | full |
| Amp | CLI, Extension, SDK | May '25 | May '26 | full | full | unknown | full | full | none | partial |
| Antigravity | CLI, IDE | 2025 | May '26 | full | full | partial | full | full | none | unknown |
| Claude Code | CLI, Extension, SDK, Web, Mac App | Feb '25 | Jun '26 | full | full | full | full | full | partial | partial |
| Cline | CLI, Extension, SDK | Jul '24 | Jun '26 | full | full | unknown | full | full | none | full |
| Cohere North | SDK, Web | Jan '25 | May '26 | partial | partial | partial | full | full | full | none |
| Cursor | CLI, IDE, SDK | 2023 | May '26 | full | full | full | unknown | full | full | full |
| Devin | CLI, Extension, SDK, Web | Dec '24 | Feb '26 | full | full | partial | full | full | full | unknown |
| Factory Droid | CLI, Extension, Web | 2025 | May '26 | full | full | partial | full | full | partial | full |
| Gemini CLI | CLI | Jun '25 | May '26 | full | partial | unknown | full | full | none | partial |
| GitHub Copilot | CLI, IDE, Extension, SDK, Web | Jun '25 | May '26 | full | full | unknown | full | full | full | full |
| Google Jules | Web | Aug '25 | May '26 | unknown | none | partial | partial | unknown | full | none |
| Grok Build | CLI | May '26 | May '26 | full | full | unknown | full | full | none | partial |
| JetBrains Junie | CLI, IDE | Jan '25 | May '26 | partial | unknown | unknown | none | unknown | none | partial |
| Kilo Code | CLI, Extension | Feb '26 | Jun '26 | full | full | unknown | full | full | partial | full |
| Kimi CLI | CLI, Extension, SDK | Oct '25 | Jun '26 | full | full | unknown | partial | full | none | full |
| Kiro | CLI, IDE, Web | Jul '25 | May '26 | full | full | partial | full | full | partial | none |
| OpenAI Codex CLI | CLI, Extension, SDK, Web, Mac App | Apr '25 | Jun '26 | full | full | full | full | full | full | full |
| OpenCode | CLI, Extension, SDK, Mac App | 2025 | Jun '26 | full | full | full | full | full | none | full |
| Pi | CLI, SDK | May '26 | Jun '26 | full | full | full | full | none | none | full |
| Qwen Code | CLI, Extension, SDK | Jun '25 | May '26 | full | full | unknown | full | full | partial | full |
| Replit Agent | Web | Sep '24 | Sep '25 | partial | none | partial | partial | unknown | full | none |
| Roo Code | Extension | Mid-2025 | May '26 | full | full | unknown | none | full | none | full |
| Windsurf Cascade | CLI, IDE, Extension | Nov '24 | Apr '26 | full | full | unknown | full | full | full | partial |

## Suggested Next Columns

The current feature set is now broad enough that the next useful granularity is less about "has an agent" and more about operating model:

| Candidate attribute | Why it matters |
| --- | --- |
| `git_worktrees` | Separates true parallel local agents from agents that share one checkout. |
| `parallel_agent_limit` | Captures concurrency differences like Jules task limits, Grok Build subagents, and Claude/Codex desktop multi-session flows. |
| `execution_environment` | Distinguishes local shell, local sandbox, cloud VM, browser workspace, and enterprise VPC/on-prem. |
| `agent_protocol` | Tracks ACP, MCP-only, proprietary app APIs, and REST/SDK control surfaces. |
| `approval_granularity` | Plan approval, diff approval, shell-command approval, tool-permission policies, and fully autonomous modes behave differently. |
| `pr_issue_workflow` | GitHub issue assignment, PR review/fix, auto-review, and branch publishing are now major differentiators. |
| `browser_app_testing` | Replit, Devin, Claude desktop, and others increasingly verify UI apps through browsers/previews. |
| `debugger_runtime_access` | Junie-style debugger integration is materially different from static code edits. |
| `memory_scope` | Project files, global user memory, org knowledge, session memory, and cross-session memory should be split. |
| `enterprise_controls` | SSO, audit logs, VPC/on-prem, data retention, and policy controls are separate from developer features. |

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
