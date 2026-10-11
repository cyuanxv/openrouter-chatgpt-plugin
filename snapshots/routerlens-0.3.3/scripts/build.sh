#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
# Keep npm and shell builds on the same TypeScript bundler.
# worker/index.js is not a source file; never copy it as a prebuilt artifact.
exec node "$project_root/scripts/build.mjs"
