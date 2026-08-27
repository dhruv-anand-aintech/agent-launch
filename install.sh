#!/bin/sh
set -eu

repo_slug="${AGL_INSTALL_REPOSITORY:-dhruv-anand-aintech/agent-launch}"
repo_ref="${AGL_INSTALL_REF:-main}"
archive_url="${AGL_INSTALL_ARCHIVE_URL:-https://github.com/${repo_slug}/archive/${repo_ref}.tar.gz}"
source_dir=""
if [ -f "$0" ] && [ "$(basename -- "$0")" = "install.sh" ]; then
  source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || true)
fi
temp_dir=""

if [ ! -f "$source_dir/bin/agent-launch" ] || [ ! -f "$source_dir/bin/agl-export" ]; then
  command -v curl >/dev/null 2>&1 || { printf 'curl is required for streamed installation\n' >&2; exit 1; }
  command -v tar >/dev/null 2>&1 || { printf 'tar is required for streamed installation\n' >&2; exit 1; }
  temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/agl-install.XXXXXX")
  trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM
  curl -fsSL "$archive_url" | tar -xz -C "$temp_dir" --strip-components=1
  source_dir="$temp_dir"
fi

install_dir="${HOME}/.local/bin"
completion_dir="${HOME}/.zfunc"
omz_custom_dir="${ZSH_CUSTOM:-${HOME}/.oh-my-zsh/custom}"
mkdir -p "$install_dir"
mkdir -p "$completion_dir"
install -m 0755 "$source_dir/bin/agent-launch" "$install_dir/agent-launch"
install -m 0755 "$source_dir/bin/agl-export" "$install_dir/agl-export"
ln -sf "$install_dir/agent-launch" "$install_dir/agl"
install -m 0755 "$source_dir/bin/focus-logger" "$install_dir/focus-logger"
ln -sf "$install_dir/focus-logger" "$install_dir/fl"
install -m 0644 "$source_dir/completions/_agent-launch" "$completion_dir/_agent-launch"
install -m 0644 "$source_dir/completions/_focus-logger" "$completion_dir/_focus-logger"

printf 'Installed %s\n' "$install_dir/agent-launch"
printf 'Installed %s\n' "$install_dir/agl-export"
printf 'Linked   %s -> agent-launch\n' "$install_dir/agl"
printf 'Installed %s\n' "$install_dir/focus-logger"
printf 'Linked   %s -> focus-logger\n' "$install_dir/fl"
printf 'Installed %s\n' "$completion_dir/_agent-launch"
printf 'Installed %s\n' "$completion_dir/_focus-logger"
if [ -d "$omz_custom_dir" ]; then
  install -m 0644 "$source_dir/completions/agent-launch.zsh" "$omz_custom_dir/agent-launch.zsh"
  printf 'Installed %s\n' "$omz_custom_dir/agent-launch.zsh"
fi
printf 'If completions do not appear in an existing shell, run: autoload -Uz compinit && compinit\n'

if [ "${1:-}" = "export" ]; then
  shift
  exec "$install_dir/agl" export "$@"
fi
