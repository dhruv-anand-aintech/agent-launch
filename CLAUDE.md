# agent-launch-cli

## Project
`agent-launch-cli` provides the `agent-launch` / `agl` wrapper for launching local coding-agent CLIs with normalized agent selection, prompt, cwd, model, mode, resume, and non-interactive failover behavior.

## Important Paths
- `bin/agent-launch`: main CLI implementation and source of truth for wrapper behavior.
- `install.sh`: copies the CLI into `~/.local/bin` and installs zsh completions.
- `completions/`: zsh completion sources.
- `docs/tools/agent_matrix/`: data-first feature matrix; JSON data, schema, and generated artifacts live here.
- `worker/matrix.js`: Cloudflare Worker serving matrix data/assets.
- `scripts/scheduled-agent-matrix-update.sh`: scheduled matrix updater.
- `launchd/com.dhruvanand.agent-launch-matrix-updater.plist`: local LaunchAgent for matrix updates.
- `wrangler.toml`: Worker deploy config for `compare.ainorthstar.tech`.

## Discovered Commands
- Local install: `./install.sh`
- Matrix validation: `npm run matrix:validate`
- Matrix bundle generation: `npm run matrix:bundle`
- LLM text generation: `npm run matrix:llms-txt`
- Matrix deploy pipeline: `npm run deploy:matrix`
- Dry-run backend mapping: `./bin/agent-launch --dry-run -a codex -n -m danger -C /tmp -p hello`
- Installed wrapper check after install: `agl --dry-run ...`

## Conventions and Gotchas
- Before listing/searching remote branches, run `git fetch --all`.
- The repo directory is `agent-launch-cli`, but the package/CLI name is `agent-launch`; older notes may refer to the old `agent-launch` folder.
- When wrapper behavior differs from expectations, inspect `bin/agent-launch` and current `--dry-run` output before trusting docs.
- The installed user-facing binaries may be stale copies in `~/.local/bin`; use `./install.sh` before verifying installed `agl`.
- Cloudflare custom domain deploys should use `custom_domain = true` in `wrangler.toml`.
- Matrix updates are not done until deployed and verified. After any change under `docs/tools/agent_matrix/`, `worker/matrix.js`, or `wrangler.toml`, run `npm run deploy:matrix`, then verify `https://compare.ainorthstar.tech/api/deployment-info` reports `git_commit` equal to `git rev-parse HEAD` and smoke-hit the production page plus `/bundle.json`.

## Verification Note
Commands above are discovered from repo docs/manifests. They were not run while creating this file.
