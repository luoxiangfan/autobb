#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/gnx-analyze.sh [--embeddings] [--no-force]

Options:
  --embeddings  Run analyze with embeddings enabled
  --no-force    Do not pass --force to gitnexus analyze
  -h, --help    Show this help

Env:
  GNX_LOCK_WAIT_SECONDS   Lock wait timeout in seconds (default: 900)
  HF_ENDPOINT             Hugging Face endpoint (defaults to hf-mirror for --embeddings)
EOF
}

with_embeddings=false
with_force=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --embeddings)
      with_embeddings=true
      shift
      ;;
    --no-force)
      with_force=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$with_embeddings" == "true" && "$with_force" != "true" ]]; then
  echo "Note: --embeddings requires rebuild; ignoring --no-force."
  with_force=true
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

lock_dir="${repo_root}/.gitnexus-analyze.lock"
pid_file="${lock_dir}/pid"
wait_seconds="${GNX_LOCK_WAIT_SECONDS:-900}"
wait_started="$(date +%s)"

while ! mkdir "$lock_dir" 2>/dev/null; do
  if [[ -f "$pid_file" ]]; then
    existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && ! kill -0 "$existing_pid" 2>/dev/null; then
      rm -rf "$lock_dir"
      continue
    fi
  fi

  now="$(date +%s)"
  if (( now - wait_started >= wait_seconds )); then
    echo "Timed out waiting for GitNexus lock: $lock_dir" >&2
    exit 1
  fi
  sleep 2
done

cleanup() {
  rm -rf "$lock_dir"
}
trap cleanup EXIT INT TERM

echo "$$" > "$pid_file"

if command -v gitnexus >/dev/null 2>&1; then
  gnx_cmd=(gitnexus)
else
  gnx_cmd=(npx gitnexus)
fi

analyze_args=(analyze)
if [[ "$with_force" == "true" ]]; then
  analyze_args+=(--force)
fi
if [[ "$with_embeddings" == "true" ]]; then
  analyze_args+=(--embeddings)
  if [[ -z "${HF_ENDPOINT:-}" ]]; then
    export HF_ENDPOINT="https://hf-mirror.com"
  fi
fi
analyze_args+=(.)

log_file="${repo_root}/.gitnexus-last-analyze.log"
echo "Running: ${gnx_cmd[*]} ${analyze_args[*]}"
echo "Log: ${log_file}"

set +e
"${gnx_cmd[@]}" "${analyze_args[@]}" 2>&1 | tee "$log_file"
analyze_rc=${PIPESTATUS[0]}
set -e

status_out="$("${gnx_cmd[@]}" status 2>&1 || true)"
if ! printf '%s' "$status_out" | rg -q 'Status: ✅ up-to-date'; then
  echo "$status_out" >&2
  echo "GitNexus status check failed after analyze." >&2
  exit "${analyze_rc:-1}"
fi

if [[ "$with_embeddings" == "true" ]]; then
  embeddings_count="$(node -e 'try{const fs=require("fs");const m=JSON.parse(fs.readFileSync(".gitnexus/meta.json","utf8"));process.stdout.write(String((m.stats&&m.stats.embeddings)||0));}catch{process.stdout.write("0");}')"
  if ! [[ "$embeddings_count" =~ ^[0-9]+$ ]] || (( embeddings_count <= 0 )); then
    echo "Embeddings validation failed. stats.embeddings=${embeddings_count}" >&2
    exit "${analyze_rc:-1}"
  fi
fi

if (( analyze_rc != 0 )); then
  echo "Analyze exited non-zero, but index validation passed. Treating as success."
fi

echo "GitNexus index is healthy."
