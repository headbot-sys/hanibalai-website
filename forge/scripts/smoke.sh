#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Seeding"
npm run seed --prefix server >/tmp/forge-seed.out
KEY=$(python3 -c "import json; print(json.load(open('server/data/demo-credentials.json'))['enrollment_key'])")

echo "==> Starting server"
node server/src/index.js >/tmp/forge-server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
sleep 1

echo "==> Health"
curl -sf http://localhost:8787/api/health | grep -q '"ok":true'

echo "==> Dashboard"
curl -sf -H 'X-Api-Key: forge-dev-console-key' http://localhost:8787/api/v1/console/dashboard | grep -q '"devices"'

echo "==> Agent enroll + job"
python3 agent/forge_agent.py --config /tmp/forge-smoke-agent.json enroll --server http://localhost:8787 --key "$KEY" >/dev/null
DEV=$(python3 -c "import json; print(json.load(open('/tmp/forge-smoke-agent.json'))['device_id'])")
JOB=$(curl -sf -H 'X-Api-Key: forge-dev-console-key' -H 'Content-Type: application/json' \
  -d "{\"device_id\":\"$DEV\",\"title\":\"echo-test\",\"payload\":\"echo forge-ok\",\"shell\":\"bash\"}" \
  http://localhost:8787/api/v1/console/jobs)
echo "$JOB" | grep -q job_

python3 - <<PY
import json, sys
sys.path.insert(0, "agent")
import forge_agent as fa
from pathlib import Path
c = json.loads(Path("/tmp/forge-smoke-agent.json").read_text())
resp = fa.heartbeat_once(c)
assert resp.get("jobs"), "expected queued job"
for job in resp["jobs"]:
    result = fa.run_job(job)
    fa.report_job(c, job["id"], result)
    assert result["status"] == "succeeded"
    assert "forge-ok" in result["stdout"]
print("job ok")
PY

echo "==> All smoke checks passed"
