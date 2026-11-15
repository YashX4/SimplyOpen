#!/usr/bin/env bash
#
# Starts everything SimplyOpen needs on your own computer, in this one terminal:
#
#   analyzer   http://127.0.0.1:3000   reads an upload and writes its manifest
#   chat       http://127.0.0.1:3100   changing things by chatting
#   api        http://127.0.0.1:3200   the website's server
#   site       http://localhost:5173   the website itself  <- open this one
#
# Anything already on those ports is stopped first, so running it again is a
# restart. Ctrl+C stops all four. The Claude key is read from web/.env and is
# never printed.

set -u
cd "$(dirname "$0")"

if [ ! -f web/.env ]; then
  echo "There is no web/.env. Copy web/.env.example to web/.env and fill it in first."
  exit 1
fi

# The value after ANTHROPIC_API_KEY=, without quotes or spaces around it.
KEY=$(grep -E '^[[:space:]]*ANTHROPIC_API_KEY[[:space:]]*=' web/.env | head -1 \
  | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//; s/^["'\'']//; s/["'\'']$//')
if [ -z "$KEY" ]; then
  echo "web/.env has no ANTHROPIC_API_KEY, so the analyzer and chat cannot start."
  exit 1
fi

echo "Stopping anything already on 3000, 3100, 3200 and 5173"
for port in 3000 3100 3200 5173; do
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; fi
done
sleep 1

for dir in analyzer chat web web/client; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing what $dir needs, once"
    (cd "$dir" && npm install --no-audit --no-fund --loglevel=error) || exit 1
  fi
done

# Every line a service prints, with its name in front.
label() { while IFS= read -r line; do printf '%-9s %s\n' "[$1]" "$line"; done; }

trap 'echo; echo "Stopping everything"; kill 0 2>/dev/null; exit 0' INT TERM

(cd analyzer && PORT=3000 ANTHROPIC_API_KEY="$KEY" npm run dev 2>&1 | label analyzer) &
(cd chat && PORT=3100 ANTHROPIC_API_KEY="$KEY" CHECK_URL=http://127.0.0.1:3000/analyze npm run dev 2>&1 | label chat) &
(cd web && PORT=3200 ANALYZER_URL=http://127.0.0.1:3000/analyze CHAT_URL=http://127.0.0.1:3100 npm run dev 2>&1 | label api) &
(cd web/client && npm run dev -- --port 5173 --strictPort 2>&1 | label site) &

# Say when it is actually ready, rather than leaving you to guess.
for _ in $(seq 1 60); do
  if curl -fs http://127.0.0.1:3200/api/health >/dev/null 2>&1 && curl -fs http://localhost:5173 >/dev/null 2>&1; then
    echo
    echo "Ready. Open http://localhost:5173   (Ctrl+C stops everything)"
    echo
    break
  fi
  sleep 1
done

wait
