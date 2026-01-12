#!/usr/bin/env bash
set -euo pipefail

alias_name="${1:-fw-dev}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
bin_dir="${HOME}/.bun/bin"
bin_path="${bin_dir}/${alias_name}"

echo "Building Firewatch CLI..."
bun run --cwd "${repo_root}" --filter @outfitter/firewatch-cli build

mkdir -p "${bin_dir}"
ln -sf "${repo_root}/apps/cli/dist/fw" "${bin_path}"

echo "Linked ${bin_path} -> ${repo_root}/apps/cli/dist/fw"
echo "Run: ${alias_name}"
