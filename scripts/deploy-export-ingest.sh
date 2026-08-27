#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
commit=$(git -C "$repo_dir" rev-parse HEAD)

cd "$repo_dir"
npx wrangler deploy --config wrangler.export.toml --var "BUILD_COMMIT:$commit"

health=$(curl -fsS "https://agl-exports.ainorthstar.tech/health")
HEALTH_JSON="$health" EXPECTED_COMMIT="$commit" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["HEALTH_JSON"])
assert payload.get("ok") is True, payload
assert payload.get("commit") == os.environ["EXPECTED_COMMIT"], payload
print(f"Verified production export ingestion commit {payload['commit']}")
PY
