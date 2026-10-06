#!/usr/bin/env bash
# ==============================================================================
# FastReport Docker Stream - URL Redirector / Interceptor
# ==============================================================================
# This script intercepts all URL launch requests made by Wine applications
# (via winebrowser, xdg-open, or system browser calls). Instead of launching a
# browser inside the container, it forwards the URL via HTTP POST to the local
# bridge server, which then streams it via SSE to the user's host browser.
# ==============================================================================

set -e

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://host.docker.internal:3000}"
SESSION_ID="${SESSION_ID:-default}"
TARGET_URL=""

# Inspect arguments to extract the target URL
for arg in "$@"; do
    if [[ "$arg" =~ ^https?:// ]] || [[ "$arg" =~ ^mailto: ]] || [[ "$arg" =~ ^ftp:// ]] || [[ "$arg" =~ ^file:// ]]; then
        TARGET_URL="$arg"
        break
    fi
done

# If no protocol scheme was found, fall back to first non-flag argument
if [ -z "$TARGET_URL" ]; then
    for arg in "$@"; do
        if [[ ! "$arg" =~ ^- ]]; then
            TARGET_URL="$arg"
            break
        fi
    done
fi

if [ -n "$TARGET_URL" ]; then
    echo "[URL-REDIRECTOR] Intercepted URL from Wine: ${TARGET_URL}" >&2
    
    # Send HTTP POST directly to Orchestrator endpoint
    ENDPOINT="${ORCHESTRATOR_URL}/api/session/${SESSION_ID}/open-url"
    curl -s -m 3 -X POST "${ENDPOINT}" \
         -H "Content-Type: application/json" \
         -d "{\"url\": \"${TARGET_URL}\", \"source\": \"wine\"}" > /dev/null 2>&1 || true
else
    echo "[URL-REDIRECTOR] Warning: No URL found in arguments: $*" >&2
fi

# Always exit 0 to prevent Wine from showing error dialogs
exit 0
