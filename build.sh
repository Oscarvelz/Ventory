#!/bin/sh
# Builds the static Ventory into dist/ (published to the `main` branch for GitHub Pages).
set -e
cd "$(dirname "$0")"
npx vite build -c vite.spa.config.ts
cd dist
ls | grep -v -e '^sw.js$' -e '^precache.json$' | python3 -c "import sys,json;print(json.dumps(['./'+l.strip() for l in sys.stdin if l.strip()]))" > precache.json
touch .nojekyll
ls -la
