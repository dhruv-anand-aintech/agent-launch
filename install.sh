#!/bin/sh
set -eu

install_dir="${HOME}/.local/bin"
mkdir -p "$install_dir"
install -m 0755 "$(dirname "$0")/bin/agent-launch" "$install_dir/agent-launch"

printf 'Installed %s\n' "$install_dir/agent-launch"
