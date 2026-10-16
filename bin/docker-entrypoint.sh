#!/bin/sh
set -eu

exec node --experimental-strip-types /app/src/audit/runFunctionalityAudit.ts "$@"
