#!/bin/bash
# Cloud sessions start from a fresh clone with no node_modules, so every
# thread used to spend its first minutes on `npm ci`. Do it here instead,
# and prebuild the mid-game save the browser check (npm run uicheck) loads.
# Local sessions already have their dependencies, so they skip this.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
npm ci --no-audit --no-fund
npm run makesave --silent -- 75 YYZ
