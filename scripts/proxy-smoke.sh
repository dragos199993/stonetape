#!/bin/bash
# E2E smoke test for `stonetape proxy` as a real detached process.
set -e
cd "$(dirname "$0")/.."
REPO="$PWD"
CASSETTE=/tmp/cli-proxy-smoke.yaml
rm -f "$CASSETTE"

# 1. fake upstream
node -e '
const http = require("node:http");
http.createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{
  s.setHeader("content-type","application/json");
  s.end(JSON.stringify({answer:42}));
})}).listen(19871);
' &
UPSTREAM_PID=$!
sleep 0.5

# 2. recording proxy (a real child process, like any external tool would see)
node "$REPO/dist/cli/index.js" proxy --cassette "$CASSETTE" --target http://127.0.0.1:19871 --mode record --port 19872 &
PROXY_PID=$!
sleep 1

# 3. an "external process" (curl) records through it
RESP=$(curl -s -X POST http://127.0.0.1:19872/v1/chat \
  -H "content-type: application/json" \
  -H "authorization: Bearer sk-cli-secret-9999" \
  -d '{"q":"meaning"}')
echo "record response: $RESP"
[ "$RESP" = '{"answer":42}' ] || { echo "FAIL: bad record response"; exit 1; }

# 4. SIGINT the proxy -> cassette must be written on shutdown
kill -INT $PROXY_PID
wait $PROXY_PID 2>/dev/null || true
grep -q "REDACTED" "$CASSETTE" || { echo "FAIL: secret not redacted"; exit 1; }
grep -q "sk-cli-secret" "$CASSETTE" && { echo "FAIL: secret leaked"; exit 1; }
echo "cassette written + redacted ✓"

# 5. kill the upstream entirely — replay must not care
kill $UPSTREAM_PID 2>/dev/null || true
sleep 0.3

# 6. replay proxy, upstream dead
node "$REPO/dist/cli/index.js" proxy --cassette "$CASSETTE" --target http://127.0.0.1:19871 --mode replay --port 19873 &
REPLAY_PID=$!
sleep 1
RESP2=$(curl -s -X POST http://127.0.0.1:19873/v1/chat \
  -H "content-type: application/json" \
  -d '{"q":"meaning"}')
echo "replay response: $RESP2 (upstream is dead)"
kill -INT $REPLAY_PID 2>/dev/null || true
[ "$RESP2" = '{"answer":42}' ] || { echo "FAIL: bad replay response"; exit 1; }

rm -f "$CASSETTE"
echo "PROXY E2E SMOKE: OK"
