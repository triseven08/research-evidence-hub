#!/usr/bin/env bash
# Run inside the remote GPU container; no Docker daemon is needed.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$ROOT/eval/livemcpbench/run.py" "$@"
