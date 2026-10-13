#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install it with: brew install node"
  exit 1
fi
node scripts/doctor.js || exit $?
exec node server/index.js
