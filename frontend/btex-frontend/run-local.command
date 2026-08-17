#!/bin/zsh
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm ci
fi
npm run dev -- -H 0.0.0.0 -p 4320
