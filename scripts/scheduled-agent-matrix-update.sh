#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/dhruvanand/Code/agent-launch-cli"
AGL_BIN="/Users/dhruvanand/.local/bin/agl"
GH_BIN="/opt/homebrew/bin/gh"
WORK_ROOT="$HOME/.cache/agent-launch-matrix-updater"
WORKTREE_DIR="$WORK_ROOT/worktree"
PATH_SHIM_DIR="$WORK_ROOT/bin"
ARTIFACT_DIR="$WORK_ROOT/artifacts"
LOG_DIR="$HOME/Library/Logs/agent-launch-matrix-updater"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BRANCH="matrix-auto-update-$STAMP"
LOG_FILE="$LOG_DIR/run-$STAMP.log"
LAST_MESSAGE="$LOG_DIR/last-message-$STAMP.md"
PROMPT_FILE="$LOG_DIR/prompt-$STAMP.txt"
LOCK_DIR="/tmp/agent-launch-matrix-updater.lock"

mkdir -p "$WORK_ROOT" "$PATH_SHIM_DIR" "$ARTIFACT_DIR" "$LOG_DIR"
ln -sf /opt/homebrew/bin/python3 "$PATH_SHIM_DIR/python"
export PATH="$PATH_SHIM_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date -u +%FT%TZ) another matrix updater run is active" >> "$LOG_FILE"
  exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

exec > >(tee -a "$LOG_FILE") 2>&1

echo "$(date -u +%FT%TZ) starting scheduled agent matrix update"

if [[ ! -x "$AGL_BIN" ]]; then
  echo "agl binary missing at $AGL_BIN"
  exit 1
fi

if [[ ! -x "$GH_BIN" ]]; then
  echo "gh binary missing at $GH_BIN"
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  GITHUB_TOKEN="$("$GH_BIN" auth token 2>/dev/null || true)"
  if [[ -n "$GITHUB_TOKEN" ]]; then
    export GITHUB_TOKEN
    export GH_TOKEN="$GITHUB_TOKEN"
  fi
fi

git -C "$REPO_DIR" fetch origin main

if [[ -d "$WORKTREE_DIR/.git" || -f "$WORKTREE_DIR/.git" ]]; then
  git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR" || true
fi
rm -rf "$WORKTREE_DIR"

git -C "$REPO_DIR" worktree add -B "$BRANCH" "$WORKTREE_DIR" origin/main

cat > "$PROMPT_FILE" <<'PROMPT'
You are running as an unattended scheduled maintenance job for the coding agent feature matrix.

Persistent artifact directory:
`/Users/dhruvanand/.cache/agent-launch-matrix-updater/artifacts`

Goal:
Research current public updates for every agent in `docs/tools/agent_matrix/data/*.json` and update any matrix cells whose support value, source URL, comment, pricing, release/update metadata, or form-factor links have changed.

Also seek out newly released or newly relevant coding-agent harnesses from major AI labs, model providers, cloud vendors, IDE/editor vendors, and well-known developer-tool companies. Examples of source families to check include official product pages, docs/changelogs/blogs, official GitHub orgs, package registries, and launch posts from OpenAI, Anthropic, Google, GitHub, Amazon, xAI, Meta, Z.ai/Zhipu, Alibaba/Qwen, Moonshot/Kimi, JetBrains, Cursor, Replit, Cognition/Devin, Sourcegraph/Amp, All Hands/OpenHands, and similarly prominent companies. Explicitly check Z.ai/Zhipu's ZCode IDE/app and any GLM Coding CLI or GLM Code command-line harness separately; if they are distinct surfaces, represent them as distinct matrix entries and only add launcher support for installable local commands with verified flags.

Rules:
- Address only the matrix dataset/site artifacts and the `agent-launch` wrapper files required for newly added CLI-capable harnesses. Do not edit unrelated scripts or unrelated project files.
- Prefer official sources: product docs, changelogs, release notes, official blogs, official GitHub repos, marketplace pages, and pricing pages.
- For each changed cell, keep the existing schema shape and support vocabulary: `full`, `partial`, `none`, `unknown`, or empty string.
- Keep `source_url` precise. Prefer URLs with heading anchors and `:~:text=` fragments that match current browser text when possible.
- For form factors, keep `form_factor.values` and `form_factor.links` in sync. Every concrete form factor should have a useful install/download/docs link when available.
- For a new harness, add a matrix file only when there is official evidence that it is a coding-agent surface or agentic development environment, not merely a base model, prompt pack, or generic chat product.
- If a new harness has a local CLI or installable command, add it to `bin/agent-launch`, shell completions, and user-facing launcher docs when the backend flags can be verified. Preserve existing backend behavior.
- Validate new local harness support on this machine where practical: install via the official documented method without sudo, verify the executable is on PATH, capture `--version` or `--help`, then run `./install.sh` and verify the installed `~/.local/bin/agl` dry-run for that agent. If install requires sudo, GUI approval, paid login, invite access, or unsupported hardware, do not install it; document the blocker in the run artifact and PR body.
- If a source is blocked by login, Cloudflare, bot challenge, or paywall, do not invent evidence. Leave the existing value unless another official accessible source confirms a change.
- If no reliable update is found for a cell, leave it unchanged.
- Preserve unrelated dirty state if present.

Artifact reuse:
- Before doing broad research, inspect recent text artifacts in `/Users/dhruvanand/.cache/agent-launch-matrix-updater/artifacts`.
- Use those artifacts to avoid redoing work for agents/cells recently verified as unchanged, unless the artifact is stale, incomplete, blocked, or there is newer official evidence.
- Treat artifacts as cached notes, not source of truth. The JSON data and current official sources still win.
- Write text artifacts at the end of every run:
  - `run-YYYYMMDDTHHMMSSZ.md`: concise run summary, changed agents/cells, validation results, PR URL/merge result if any, blocked sources, and unresolved follow-ups.
  - `agent-<slug>.md`: per-agent latest checked sources, last checked timestamp, cells changed or confirmed unchanged, blocked URLs, and next recommended check.
- Keep artifacts human-readable Markdown so future `codex exec` runs can skim them quickly.
- Do not commit these cache artifacts to the repo.

Required final steps:
- Run `npm run matrix:validate`.
- Run `npm run matrix:bundle`.
- Run `npm run matrix:llms-txt`.
- If no matrix changes remain after generation, do not create a commit or PR; say there were no updates.
- If changes exist, stage only matrix/site artifacts:
  `docs/tools/agent_matrix/README.md`, `bundle.json`, `updated.json`, `llms.txt`, `schema.json`, `data_utils.py`, `docs/tools/agent_matrix/data/*.json`, and `worker/matrix.js`.
- If a newly added harness required launcher support, also stage only the relevant wrapper artifacts:
  `bin/agent-launch`, `completions/_agent-launch`, `completions/agent-launch.zsh`, root `README.md`, `package.json`, and `package-lock.json`.
- Commit the staged changes with message `Scheduled coding agent matrix update`.
- Push the current branch. The wrapper already created the branch from `origin/main`; get its name with `git branch --show-current`.
- Create a GitHub PR with `gh pr create --base main --head <current-branch> --title "Scheduled coding agent matrix update"` and a body that includes summary, changed agents/attributes, newly discovered harnesses considered, local install/help/dry-run validation for added harnesses, blocked sources/installers, and the validation commands.
- Merge that PR with `gh pr merge <PR_URL> --merge --delete-branch`.
- Do not deploy.
- In your final response, include changed agents/attributes, blocked sources, validation commands, PR URL, and merge result.
PROMPT

"$AGL_BIN" \
  --non-interactive \
  --prefer codex \
  --cwd "$WORKTREE_DIR" \
  --mode danger \
  --prompt-file "$PROMPT_FILE" | tee "$LAST_MESSAGE"

echo "$(date -u +%FT%TZ) scheduled matrix update completed"

git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR" || true
