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

Columns span metadata (name, form factor, release, pricing), context (rules, skills, transcripts), automation (hooks, commands, subagents, monitor/watch capability), settings (model, approvals, sandbox, resume, continue, headless, output, statusline, telemetry), models (arbitrary providers), and platform (hosted agent).

Form factor values are deliberately strict: each value should have a concrete per-form-factor install/download link in `form_factor.links`. Use `Extension` only for an installable editor extension, `IDE` for a standalone editor/IDE, `Mac App` for a native macOS desktop app that is distinct from the IDE surface, `CLI` for a terminal binary, `SDK` for a published programmatic API/library, and `Web` for a hosted browser app.

## Rows

| Name | Form factor | Released | Latest major update | Some free | No account | Other subs | Rules | Skills | Monitor | Transcripts | Hooks | MCP | Hosted agent | Arbitrary models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aider | CLI | Jun '23 | May '26 | full | full | full | partial | partial | none | partial | partial | none | none | full |
| Amazon Q Developer CLI | CLI | Mar '25 | Nov '25 | full | none | none | full | partial | none | partial | full | full | none | none |
| Amp | CLI, SDK, Web, Mobile | May '25 | Sep '26 | full |  | full | full | full | partial | unknown | full | full | full | partial |
| Antigravity | CLI, IDE, Web | 2025 | Sep '26 | full |  |  | full | full | unknown | partial | full | full | none | unknown |
| Claude Code | CLI, Extension, SDK, Web, Mac App | Feb '25 | Sep '26 |  |  |  | full | full | full | full | full | full | partial | partial |
| Cline | CLI, Extension, SDK, Desktop App | Jul '24 | Sep '26 | full | full | full | full | full | partial | unknown | full | full | none | full |
| Cohere North | SDK, Web | Jan '25 | Jun '26 |  |  |  | partial | partial | partial | partial | full | full | full | none |
| Command Code | CLI, Extension, Web, Desktop App | Jul '26 | Sep '26 | partial | none | full | full | full | partial | full | full | full | none | full |
| Crush | CLI, TUI | Jul '25 | Sep '26 | full | full | full | full | full | partial | full | partial | full | none | full |
| Cursor | CLI, IDE, SDK, Web, Mobile | 2023 | Sep '26 | full |  |  | full | full | full | full | full | full | full | full |
| Devin | CLI, Extension, SDK, Web | Dec '24 | Sep '26 | full |  |  | full | full | partial | partial | full | full | full | unknown |
| Factory Droid | CLI, Extension, SDK, Web, Desktop App | 2025 | Sep '26 |  | partial | full | full | full | partial | partial | full | full | full | full |
| Gemini CLI | CLI | Jun '25 | Sep '26 | full |  | full | full | partial | partial | unknown | full | full | none | partial |
| GitHub Copilot | CLI, IDE, Extension, SDK, Web, Desktop App | Jun '25 | Sep '26 |  |  |  | full | full | partial | unknown | full | full | full | full |
| GitHub Copilot CLI | CLI | Sep '25 | Sep '26 | partial | none | full | full | full | partial | full | full | full | none | full |
| Google Jules | Web | Aug '25 | Mar '26 |  |  |  | unknown | none | partial | partial | partial | partial | full | none |
| Goose | CLI, Desktop App | Jan '25 | Sep '26 | full | full | full | full | full | partial | full | full | full | none | full |
| Grok Build | CLI, Web, Mobile | May '26 | Aug '26 |  |  |  | full | full | unknown | unknown | full | full | full | partial |
| JetBrains Air | IDE, Web, Desktop App | Mar '26 | Sep '26 | full | partial | full | full | full | full | partial | partial | full | full | full |
| JetBrains Junie | CLI, IDE, Web, GitHub Action, GitLab CI/CD | Jan '25 | Aug '26 |  |  |  | full | full | partial | full | full | full | partial | full |
| Kilo Code | CLI, Extension | Feb '26 | Sep '26 | full | full | full | full | full | partial | unknown | full | full | partial | full |
| Kimi Code CLI | CLI, Extension | May '26 | Sep '26 |  |  |  | full | full | partial | unknown | partial | full | none | full |
| Kiro | CLI, IDE, Web | Jul '25 | Sep '26 | full |  |  | full | full | partial | partial | full | full | full | none |
| Kiro Crew | CLI, Web, Desktop App, Mobile | Aug '26 | Sep '26 | full | none | none | full | full | full | full | full | full | none | none |
| MiMo Code | CLI, IDE, Extension | Jun '26 | Sep '26 | full | full | full | full | full | partial | full | partial | full | none | full |
| Muse Code | CLI | Aug '26 | Sep '26 | unknown | none | none | full | full | partial | full | unknown | unknown | none | partial |
| OpenAI Agents API | SDK, Hosted Agent | Sep '26 | Sep '26 | none | none | none | partial | full | full | full | full | full | full | none |
| OpenAI Codex CLI | CLI, Extension, SDK, Web, Mac App | Apr '25 | Sep '26 | full |  | full | full | full | partial | full | full | full | full | full |
| OpenCode | CLI, Extension, SDK, Mac App | 2025 | Sep '26 | full | full | full | full | full | partial | full | full | full | none | full |
| OpenHands | CLI, IDE, Web, Docker, Hosted Agent | Mar '24 | Sep '26 | full | full | full | full | full | none | full | full | full | full | full |
| Pi | CLI, SDK | May '26 | Sep '26 |  | full | full | full | full | none | full | full | none | none | full |
| Pier Code | CLI | Jun '26 | Jul '26 | none | partial | none | full | partial | partial | full | partial | full | full | partial |
| Qoder | CLI, IDE, Extension, SDK, Web, Desktop App, Mobile | Oct '25 | Sep '26 |  |  |  | full | full | partial | full | full | full | full | full |
| Qwen Code | CLI, Extension, SDK, Web, Desktop App, Mobile | Jun '25 | Sep '26 |  |  |  | full | full | partial | unknown | full | full | partial | full |
| Replit Agent | Web | Sep '24 | Aug '26 |  |  |  | partial | full | partial | partial | partial | unknown | full | none |
| Roo Code | Extension | Mid-2025 | May '26 |  |  |  | full | full | partial | unknown | none | full | none | full |
| Trae Agent | CLI | Jun '25 | Feb '26 | full | full | full | partial | none | none | full | none | partial | none | full |
| Windsurf Cascade | CLI, IDE, Extension | Nov '24 | Aug '26 |  |  |  | full | full | partial | unknown | full | full | full | partial |
| ZCode | IDE, Desktop App, Mobile | 2026 | Sep '26 | full |  |  | full | full | partial | partial | partial | full | none | full |

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
