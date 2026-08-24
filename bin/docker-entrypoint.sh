#!/bin/sh
set -eu

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  set -- "$@" --deterministic
fi

exec node --experimental-strip-types /app/src/audit/runFunctionalityAudit.ts "$@"
