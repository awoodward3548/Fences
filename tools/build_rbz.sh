#!/usr/bin/env bash
# Packages the extension as dist/fence_builder.rbz for Extension Manager.
set -euo pipefail
cd "$(dirname "$0")/../src"
mkdir -p ../dist
rm -f ../dist/fence_builder.rbz
zip -qr ../dist/fence_builder.rbz fence_builder.rb fence_builder -x 'fence_builder/data/last_settings.json'
echo "Built dist/fence_builder.rbz"
