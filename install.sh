#!/bin/sh
set -eu

install_dir="${HOME}/.local/bin"
completion_dir="${HOME}/.zfunc"
omz_custom_dir="${ZSH_CUSTOM:-${HOME}/.oh-my-zsh/custom}"
mkdir -p "$install_dir"
mkdir -p "$completion_dir"
install -m 0755 "$(dirname "$0")/bin/agent-launch" "$install_dir/agent-launch"
ln -sf "$install_dir/agent-launch" "$install_dir/agl"
install -m 0644 "$(dirname "$0")/completions/_agent-launch" "$completion_dir/_agent-launch"

printf 'Installed %s\n' "$install_dir/agent-launch"
printf 'Linked   %s -> agent-launch\n' "$install_dir/agl"
printf 'Installed %s\n' "$completion_dir/_agent-launch"
if [ -d "$omz_custom_dir" ]; then
  install -m 0644 "$(dirname "$0")/completions/agent-launch.zsh" "$omz_custom_dir/agent-launch.zsh"
  printf 'Installed %s\n' "$omz_custom_dir/agent-launch.zsh"
fi
printf 'If completions do not appear in an existing shell, run: autoload -Uz compinit && compinit\n'
