# Settings Research Matrix

Research document for populating agent settings across all platforms.

## Settings Categories

### 1. Keyboard Shortcuts (`keyboard_shortcuts`)
- Rebindable keybindings, command palette customization
- **Expected in:** Claude Code, Cursor, VS Code extensions, JetBrains IDEs

### 2. Theme Customization (`theme_customization`)
- Dark/light mode, custom themes, color schemes
- **Expected in:** Desktop/IDE agents, web interfaces

### 3. Auto-Save (`auto_save`)
- Automatic file save, session persistence
- **Expected in:** IDE-based, desktop, and web agents

### 4. Debugging Output (`debugging_output`)
- Verbose logging, debug mode, diagnostic output
- **Expected in:** CLI-based agents, developer-focused tools

### 5. Context Window (`context_window`)
- Configurable context length, token limits, memory constraints
- **Expected in:** Model-dependent agents (Cursor, Claude Code, Cline, etc.)

### 6. Code Formatting (`code_formatting`)
- Formatter/linter integration, auto-format on save
- **Expected in:** Code-generation focused agents

### 7. Git Integration (`git_integration`)
- Git commands, diff viewing, branch management, commit workflow
- **Expected in:** All coding agents

### 8. Performance Mode (`performance_mode`)
- Caching, optimization, performance tuning, resource management
- **Expected in:** Heavy-computation agents, large codebase handlers

### 9. UI Customization (`ui_customization`)
- Sidebar layout, panel arrangement, collapsible sections
- **Expected in:** GUI-based agents (IDEs, extensions, web)

---

## Agent Research Status

### ✅ Claude Code
- **Keyboard Shortcuts:** Full - `.claude/keybindings.json`, rebindable via settings
- **Theme Customization:** Full - Dark/light mode in settings
- **Auto-Save:** Full - Settings control auto-save behavior
- **Debugging Output:** Partial - Debug logs available
- **Context Window:** Full - Token limit configurable
- **Code Formatting:** Partial - Integrates with workspace formatters
- **Git Integration:** Full - Git command support built-in
- **Performance Mode:** Partial - Caching, optimization settings available
- **UI Customization:** Full - Layout customizable

### ✅ Cursor
- **Keyboard Shortcuts:** Full - Keybindings customizable
- **Theme Customization:** Full - Theme support
- **Auto-Save:** Full - Auto-save configurable
- **Debugging Output:** Full - Debug mode available
- **Context Window:** Full - Context length configurable
- **Code Formatting:** Full - Formatter integration
- **Git Integration:** Full - Built-in git features
- **Performance Mode:** Partial - Optimization settings
- **UI Customization:** Full - VS Code-like layout customization

### ⏳ Cline (Roo Code)
- **Keyboard Shortcuts:** Unknown - check VS Code extension settings
- **Theme Customization:** Partial - inherits from VS Code
- **Auto-Save:** Full - workspace settings
- **Debugging Output:** Full - Debug console
- **Context Window:** Full - Configurable token budget
- **Code Formatting:** Full - VS Code formatters
- **Git Integration:** Full - VS Code git integration
- **Performance Mode:** Unknown - check extension settings
- **UI Customization:** Partial - VS Code UI

### ⏳ Aider
- **Keyboard Shortcuts:** Partial - CLI args, limited keybinding support
- **Theme Customization:** None - CLI-based
- **Auto-Save:** Full - Auto-save on changes
- **Debugging Output:** Full - Verbose mode available
- **Context Window:** Full - Token limit configurable
- **Code Formatting:** Full - Auto-format support
- **Git Integration:** Full - Git-aware workflow
- **Performance Mode:** Partial - Memory limits
- **UI Customization:** None - CLI-based

### ⏳ GitHub Copilot
- Research needed - IDE-specific, limited customization

### ⏳ OpenCode
- Research needed - needs documentation check

### ⏳ Gemini CLI
- Research needed - check official docs

### ⏳ Others (Devin, Cohere North, Jules, etc.)
- Research needed - proprietary/enterprise tools

---

## Implementation Plan

1. ✅ Schema updated with new settings properties
2. ⏳ Research each agent's documentation
3. ⏳ Populate all agent JSON files
4. ⏳ Create agent-rules-sync-standalone TODO list
5. ⏳ Add settings sync implementation tasks

## Sources

- Claude Code: https://docs.anthropic.com/en/docs/claude-code/settings
- Cursor: https://docs.cursor.com/
- Cline: https://github.com/cline/cline
- Aider: https://aider.chat/docs/
- Others: See individual docs

