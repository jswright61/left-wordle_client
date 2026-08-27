#!/usr/bin/env zsh
set -euo pipefail

# Runs the API (rackup) and Caddy together so the client is reachable at
# https://left-wordle.test -- see api/config/caddy/dev/Caddyfile.
#
# If you keep a customized launcher at devbin/launch.rb (devbin/ is
# gitignored, for personal dev tooling -- see .gitignore), that runs
# instead; otherwise this falls back to the bare-bones dev/launch.rb below.
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
custom="$repo_root/devbin/launch.rb"

if [[ -f "$custom" ]]; then
    exec ruby "$custom" "$@"
fi

exec ruby "$script_dir/launch.rb" "$@"
