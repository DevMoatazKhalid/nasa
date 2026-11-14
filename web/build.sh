#!/usr/bin/env bash
# Build the static site into web/dist (React + TypeScript bundled by esbuild).
# Uses ./node_modules after `npm install`; falls back to a preinstalled tool directory via NODE_PATH.
set -euo pipefail
cd "$(dirname "$0")"
if [ -x node_modules/.bin/esbuild ]; then ESBUILD=node_modules/.bin/esbuild; else ESBUILD=$(command -v esbuild || echo /opt/npm-tools/node_modules/.bin/esbuild); export NODE_PATH=${NODE_PATH:-/opt/npm-tools/node_modules}; fi
mkdir -p dist
"$ESBUILD" src/main.tsx --bundle --minify --format=iife --target=es2020 --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' --outfile=dist/app.js --log-level=warning
cp src/app.css dist/app.css
cp index.html dist/index.html
if [ -f public/data/dem_8ppd.bin.gz ]; then
  rm -rf dist/data && cp -r public/data dist/data
else
  echo "public/data has no grids (run pipeline/run_all.sh to regenerate); keeping the shipped dist/data grids"
  mkdir -p dist/data && cp public/data/*.json dist/data/ 2>/dev/null || true
fi
# hosts that only serve text/image types: wrap each gzip grid as a base64 JSON string
python3 - <<'PY'
import base64, glob, json, os
for f in glob.glob('dist/data/*.gz'):
    json.dump(base64.b64encode(open(f, 'rb').read()).decode(), open(f + '.json', 'w')); os.remove(f)
PY
echo "built: $(du -sh dist | cut -f1)"
