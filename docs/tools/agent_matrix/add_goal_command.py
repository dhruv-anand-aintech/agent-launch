#!/usr/bin/env python3
"""One-off helper: insert goal_command after custom_commands in each agent JSON."""

from __future__ import annotations

import json
from collections import OrderedDict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

GOAL_BY_FILE: dict[str, dict[str, str]] = {
    "codex-cli.json": {
        "support": "full",
        "source_url": "https://developers.openai.com/codex/cli/slash-commands#set-or-view-a-task-goal-with-goal:~:text=%2Fgoal",
        "comment": "Built-in `/goal` sets a persistent thread objective with pause, resume, view, and clear; Codex keeps working until the goal is met or you stop it. Enable with `features.goals` in config if missing from the slash menu.",
    },
    "claude-code.json": {
        "support": "full",
        "source_url": "https://code.claude.com/docs/en/goal#use-goal:~:text=%2Fgoal",
        "comment": "Built-in `/goal` sets a completion condition; after each turn a fast evaluator decides whether Claude should continue until the condition holds (Claude Code v2.1.139+).",
    },
    "opencode.json": {
        "support": "none",
        "source_url": "https://opencode.ai/docs/commands/#built-in:~:text=%2Finit",
        "comment": "Built-in TUI commands are `/init`, `/undo`, `/redo`, `/share`, and `/help` only; no first-party `/goal` for persistent session objectives yet.",
    },
    "cursor.json": {
        "support": "none",
        "source_url": "https://cursor.com/docs/cli/using#use-plan:~:text=%2Fplan",
        "comment": "Cursor Agent CLI documents `/plan`, `/ask`, and `/resume` slash commands but no built-in `/goal` for persistent completion conditions.",
    },
    "aider.json": {
        "support": "none",
        "source_url": "https://aider.chat/docs/usage/commands.html#emacs:~:text=%2F",
        "comment": "In-chat `/` commands (e.g. `/add`, `/commit`) are built-in chat commands, not a persisted `/goal` loop with pause/resume until a completion condition.",
    },
    "amp.json": {
        "support": "none",
        "source_url": "https://ampcode.com/manual#cli:~:text=CLI",
        "comment": "Amp documents CLI and editor workflows but no built-in `/goal` slash command for persistent session objectives.",
    },
    "antigravity.json": {
        "support": "none",
        "source_url": "https://antigravity.google/docs/cli-features#antigravity-cli-features:~:text=CLI",
        "comment": "Antigravity CLI docs cover plugins, sandbox, and slash commands but do not document a Codex-style `/goal` primitive.",
    },
    "cline.json": {
        "support": "none",
        "source_url": "https://docs.cline.bot/core-workflows/using-commands#slash-commands:~:text=Slash%20Commands",
        "comment": "Cline supports custom slash commands via workflow files; no built-in `/goal` for auto-continuing until a completion condition.",
    },
    "cohere-north.json": {
        "support": "none",
        "source_url": "https://cohere.com/north/agent-studio#create-automations-tailored-to-your-goals:~:text=goals",
        "comment": "North is a hosted agent studio with automations/goals in the product sense, not a terminal `/goal` slash command.",
    },
    "devin.json": {
        "support": "none",
        "source_url": "https://docs.devin.ai/work-with-devin/slash-commands#source:~:text=slash%20commands",
        "comment": "Devin supports team custom slash commands; no documented `/goal` for persistent thread-level objectives with auto-continuation.",
    },
    "factory-droid.json": {
        "support": "none",
        "source_url": "https://docs.factory.ai/reference/cli-reference#source:~:text=%2Fcommands",
        "comment": "Factory documents custom slash commands via `/commands`; no built-in `/goal` for persistent objectives.",
    },
    "gemini-cli.json": {
        "support": "none",
        "source_url": "https://antigravity.google/docs/cli-getting-started#source:~:text=CLI",
        "comment": "Deprecated Gemini CLI surface; no documented `/goal`. Google points CLI users to Antigravity, which also lacks a `/goal` command in public docs.",
    },
    "github-copilot-coding-agent.json": {
        "support": "none",
        "source_url": "https://docs.github.com/en/copilot/reference/copilot-cli-command-reference#source:~:text=slash",
        "comment": "GitHub Copilot CLI has slash commands and agent modes but no `/goal` for persistent completion conditions across turns.",
    },
    "grok-build.json": {
        "support": "none",
        "source_url": "https://x.ai/news/grok-build-cli#built-to-fit-your-workflow:~:text=Grok%20Build",
        "comment": "Grok Build launch materials mention plugins, hooks, and skills but not a `/goal` slash command.",
    },
    "jules.json": {
        "support": "none",
        "source_url": "https://jules.google/docs/#source:~:text=Jules",
        "comment": "Jules is a hosted async agent for GitHub issues/PRs; no interactive `/goal` slash command in public docs.",
    },
    "junie.json": {
        "support": "none",
        "source_url": "https://www.jetbrains.com/help/ai-assistant/junie-agent.html#source:~:text=Junie",
        "comment": "Junie runs as an IDE agent with tasks and modes; no built-in `/goal` slash command documented.",
    },
    "kilo-code.json": {
        "support": "none",
        "source_url": "https://kilo.ai/docs/customize/workflows#source:~:text=slash%20commands",
        "comment": "Kilo Code uses custom workflows/slash commands; no first-party `/goal` for persistent session objectives.",
    },
    "kimi-cli.json": {
        "support": "none",
        "source_url": "https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html#source:~:text=Kimi%20Code%20CLI",
        "comment": "Kimi Code CLI docs cover core operations and plugins but not a `/goal` command.",
    },
    "kiro.json": {
        "support": "none",
        "source_url": "https://kiro.dev/cli/#source:~:text=commands",
        "comment": "Kiro CLI documents slash-style commands but no built-in `/goal` for persistent objectives.",
    },
    "qwen-code.json": {
        "support": "none",
        "source_url": "https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/#source:~:text=commands",
        "comment": "Qwen Code supports custom shortcut commands; no built-in `/goal` for auto-continuing until a completion condition.",
    },
    "replit-agent.json": {
        "support": "none",
        "source_url": "https://docs.replit.com/replitai/agent#source:~:text=Agent",
        "comment": "Replit Agent is a hosted web agent; no terminal `/goal` slash command.",
    },
    "roo-code.json": {
        "support": "none",
        "source_url": "https://docs.roocode.com/features/slash-commands#source:~:text=slash%20commands",
        "comment": "Roo Code supports custom slash commands; no built-in `/goal` for persistent session objectives.",
    },
    "windsurf.json": {
        "support": "none",
        "source_url": "https://docs.windsurf.com/windsurf/cascade/cascade#source:~:text=Cascade",
        "comment": "Windsurf Cascade has workflows and hooks but no documented `/goal` slash command for persistent objectives.",
    },
}


def insert_goal_command(path: Path, goal: dict[str, str]) -> None:
    row = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
    if "goal_command" in row:
        return
    out = OrderedDict()
    for key, value in row.items():
        out[key] = value
        if key == "custom_commands":
            out["goal_command"] = goal
    if "goal_command" not in out:
        out["goal_command"] = goal
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    for filename, goal in sorted(GOAL_BY_FILE.items()):
        insert_goal_command(DATA_DIR / filename, goal)
        print(f"updated {filename}")


if __name__ == "__main__":
    main()
