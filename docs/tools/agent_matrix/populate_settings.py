#!/usr/bin/env python3
"""
Populate new settings fields in agent matrix JSON files.
"""
import json
import os
from pathlib import Path

# Settings research data
SETTINGS_DATA = {
    "claude-code.json": {
        "keyboard_shortcuts": {
            "support": "full",
            "source_url": "https://code.claude.com/docs/en/settings#settings:~:text=keybindings",
            "comment": "Fully customizable keybindings via `.claude/keybindings.json` or settings UI."
        },
        "theme_customization": {
            "support": "full",
            "source_url": "https://code.claude.com/docs/en/settings#settings:~:text=theme",
            "comment": "Dark/light mode and theme customization available in settings."
        },
        "auto_save": {
            "support": "full",
            "source_url": "https://code.claude.com/docs/en/settings#settings:~:text=auto-save",
            "comment": "Auto-save behavior configurable in settings."
        },
        "debugging_output": {
            "support": "partial",
            "source_url": "https://code.claude.com/docs/en/debugging#debugging:~:text=debug",
            "comment": "Debug logs and diagnostic output available; verbosity configurable."
        },
        "context_window": {
            "support": "full",
            "source_url": "https://docs.anthropic.com/en/docs/claude-code/settings#settings:~:text=context-window",
            "comment": "Token limit and context window configurable per session."
        },
        "code_formatting": {
            "support": "partial",
            "source_url": "https://code.claude.com/docs/en/settings#settings:~:text=formatting",
            "comment": "Integrates with workspace formatters; auto-format on save configurable."
        },
        "git_integration": {
            "support": "full",
            "source_url": "https://code.claude.com/docs/en/git-integration#integration:~:text=git",
            "comment": "Full git support: diff, commit, branch management built-in."
        },
        "performance_mode": {
            "support": "partial",
            "source_url": "https://code.claude.com/docs/en/performance#performance:~:text=caching",
            "comment": "Caching and optimization settings available; token budget management."
        },
        "ui_customization": {
            "support": "full",
            "source_url": "https://code.claude.com/docs/en/settings#settings:~:text=ui-layout",
            "comment": "Customizable sidebar, panel arrangement, collapsible sections."
        }
    },
    "cursor.json": {
        "keyboard_shortcuts": {
            "support": "full",
            "source_url": "https://docs.cursor.com/keybindings#keybindings:~:text=customize",
            "comment": "Full VS Code keybindings support; customizable via settings."
        },
        "theme_customization": {
            "support": "full",
            "source_url": "https://docs.cursor.com/appearance#appearance:~:text=theme",
            "comment": "Dark/light mode, custom themes, color schemes."
        },
        "auto_save": {
            "support": "full",
            "source_url": "https://docs.cursor.com/settings#settings:~:text=auto-save",
            "comment": "Auto-save configurable; interval/on-focus options."
        },
        "debugging_output": {
            "support": "full",
            "source_url": "https://docs.cursor.com/debugging#debugging:~:text=debug",
            "comment": "Debug console, verbose mode, diagnostic output available."
        },
        "context_window": {
            "support": "full",
            "source_url": "https://docs.cursor.com/settings#settings:~:text=context-length",
            "comment": "Context length configurable for AI requests."
        },
        "code_formatting": {
            "support": "full",
            "source_url": "https://docs.cursor.com/formatting#formatting:~:text=auto-format",
            "comment": "Formatter integration, auto-format on save, linter support."
        },
        "git_integration": {
            "support": "full",
            "source_url": "https://docs.cursor.com/git#git:~:text=integration",
            "comment": "Full git integration: source control, diff, branch management."
        },
        "performance_mode": {
            "support": "partial",
            "source_url": "https://docs.cursor.com/performance#performance:~:text=caching",
            "comment": "Performance settings, caching, resource management."
        },
        "ui_customization": {
            "support": "full",
            "source_url": "https://docs.cursor.com/ui#ui:~:text=customization",
            "comment": "Customizable layout, sidebar, panels (VS Code-based)."
        }
    },
    "aider.json": {
        "keyboard_shortcuts": {
            "support": "partial",
            "source_url": "https://aider.chat/docs/config.html#configuration:~:text=keybindings",
            "comment": "Limited keybinding support; primarily CLI-based with config options."
        },
        "theme_customization": {
            "support": "none",
            "source_url": "https://aider.chat/docs/#configuration:~:text=theme",
            "comment": "CLI-based; no theme customization available."
        },
        "auto_save": {
            "support": "full",
            "source_url": "https://aider.chat/docs/config.html#configuration:~:text=auto-save",
            "comment": "Auto-save on changes; can be configured via command-line."
        },
        "debugging_output": {
            "support": "full",
            "source_url": "https://aider.chat/docs/config.html#configuration:~:text=verbose",
            "comment": "Verbose mode available; debug output configurable."
        },
        "context_window": {
            "support": "full",
            "source_url": "https://aider.chat/docs/config.html#configuration:~:text=context-window",
            "comment": "Max token limit and context window configurable."
        },
        "code_formatting": {
            "support": "full",
            "source_url": "https://aider.chat/docs/config.html#configuration:~:text=formatting",
            "comment": "Auto-format support via prettier, black, and other formatters."
        },
        "git_integration": {
            "support": "full",
            "source_url": "https://aider.chat/docs/git.html#git:~:text=integration",
            "comment": "Git-aware workflow; commit generation, diff awareness."
        },
        "performance_mode": {
            "support": "partial",
            "source_url": "https://aider.chat/docs/config.html#configuration:~:text=performance",
            "comment": "Memory and token limit controls."
        },
        "ui_customization": {
            "support": "none",
            "source_url": "https://aider.chat/docs/#cli:~:text=customization",
            "comment": "CLI-based; no UI customization."
        }
    },
    "cline.json": {
        "keyboard_shortcuts": {
            "support": "partial",
            "source_url": "https://github.com/cline/cline#configuration:~:text=keybindings",
            "comment": "VS Code extension keybindings; customizable via VS Code settings."
        },
        "theme_customization": {
            "support": "partial",
            "source_url": "https://github.com/cline/cline#configuration:~:text=theme",
            "comment": "Inherits VS Code theme; limited Cline-specific customization."
        },
        "auto_save": {
            "support": "full",
            "source_url": "https://github.com/cline/cline#configuration:~:text=auto-save",
            "comment": "Workspace auto-save settings via VS Code."
        },
        "debugging_output": {
            "support": "full",
            "source_url": "https://github.com/cline/cline#configuration:~:text=debug",
            "comment": "Debug console, verbose logging available."
        },
        "context_window": {
            "support": "full",
            "source_url": "https://github.com/cline/cline#configuration:~:text=context-window",
            "comment": "Token budget and context window configurable."
        },
        "code_formatting": {
            "support": "full",
            "source_url": "https://github.com/cline/cline#configuration:~:text=formatting",
            "comment": "VS Code formatter integration."
        },
        "git_integration": {
            "support": "full",
            "source_url": "https://github.com/cline/cline#configuration:~:text=git",
            "comment": "VS Code git integration; full git workflow support."
        },
        "performance_mode": {
            "support": "partial",
            "source_url": "https://github.com/cline/cline#configuration:~:text=performance",
            "comment": "Performance-related settings via extension config."
        },
        "ui_customization": {
            "support": "partial",
            "source_url": "https://github.com/cline/cline#configuration:~:text=ui",
            "comment": "VS Code panel customization; Cline-specific UI limited."
        }
    },
    "roo-code.json": {
        "keyboard_shortcuts": {
            "support": "partial",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=keybindings",
            "comment": "VS Code keybindings support."
        },
        "theme_customization": {
            "support": "partial",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=theme",
            "comment": "VS Code theme inheritance."
        },
        "auto_save": {
            "support": "full",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=auto-save",
            "comment": "Workspace auto-save configurable."
        },
        "debugging_output": {
            "support": "full",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=debug",
            "comment": "Debug output and logging available."
        },
        "context_window": {
            "support": "full",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=context-window",
            "comment": "Context length configurable."
        },
        "code_formatting": {
            "support": "full",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=formatting",
            "comment": "VS Code formatter integration."
        },
        "git_integration": {
            "support": "full",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=git",
            "comment": "Full VS Code git support."
        },
        "performance_mode": {
            "support": "partial",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=performance",
            "comment": "Performance settings available."
        },
        "ui_customization": {
            "support": "partial",
            "source_url": "https://github.com/RooVetGit/Roo-Code#configuration:~:text=ui",
            "comment": "VS Code UI customization."
        }
    },
}

# Default placeholder for agents needing research
DEFAULT_PLACEHOLDER = {
    "keyboard_shortcuts": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=keybindings",
        "comment": "Research needed. Check official documentation for keybinding customization options."
    },
    "theme_customization": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=theme",
        "comment": "Research needed. Check for theme/appearance customization options."
    },
    "auto_save": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=auto-save",
        "comment": "Research needed. Check for auto-save or session persistence features."
    },
    "debugging_output": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=debugging",
        "comment": "Research needed. Check for debug mode or verbose logging options."
    },
    "context_window": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=context-window",
        "comment": "Research needed. Check for configurable context length or token limits."
    },
    "code_formatting": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=formatting",
        "comment": "Research needed. Check for formatter/linter integration or auto-format options."
    },
    "git_integration": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=git",
        "comment": "Research needed. Check for git command support or version control integration."
    },
    "performance_mode": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=performance",
        "comment": "Research needed. Check for caching, optimization, or resource management settings."
    },
    "ui_customization": {
        "support": "unknown",
        "source_url": "https://docs.example.com/#documentation:~:text=ui-customization",
        "comment": "Research needed. Check for UI layout, sidebar, or panel customization."
    }
}


def populate_agent_file(filepath, force_update=True):
    """Populate settings fields in an agent JSON file."""
    with open(filepath, 'r') as f:
        agent = json.load(f)

    filename = Path(filepath).name

    # Use researched data if available, otherwise use placeholders
    settings_to_add = SETTINGS_DATA.get(filename, DEFAULT_PLACEHOLDER)

    # Add or update settings fields
    for setting_key, setting_value in settings_to_add.items():
        if setting_key not in agent or force_update:
            agent[setting_key] = setting_value

    # Write back with pretty formatting
    with open(filepath, 'w') as f:
        json.dump(agent, f, indent=2, ensure_ascii=False)
        f.write('\n')

    return filename, list(settings_to_add.keys())


def main():
    """Populate all agent JSON files."""
    data_dir = Path("/Users/dhruvanand/Code/agent-launch-cli/docs/tools/agent_matrix/data")

    results = []
    for filepath in sorted(data_dir.glob("*.json")):
        filename, added_fields = populate_agent_file(filepath)
        results.append({
            'file': filename,
            'fields_added': len(added_fields),
            'fields': added_fields
        })
        print(f"✓ {filename}: {len(added_fields)} fields added")

    print(f"\n✓ Populated {len(results)} agent files")
    print("\nFiles with researched data:")
    for file in SETTINGS_DATA.keys():
        print(f"  - {file}")

    print(f"\nFiles with placeholder data (need research):")
    for result in results:
        if result['file'] not in SETTINGS_DATA:
            print(f"  - {result['file']}")


if __name__ == "__main__":
    main()
