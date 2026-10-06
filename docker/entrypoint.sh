#!/usr/bin/env bash
# ==============================================================================
# FastReport Docker Stream - Container Entrypoint
# ==============================================================================
# Initializes Xvfb virtual display, Openbox window manager, bridge HTTP/SSE server,
# x11vnc server, websockify (VNC over WebSocket), and launches FastReport Designer
# (or fallback test app) under Wine.
# ==============================================================================

set -m # Enable job control

# If custom arguments or command passed, execute directly
if [ $# -gt 0 ]; then
    exec "$@"
fi

echo "=========================================================="
echo " Starting FastReport Ephemeral Container Environment      "
echo "=========================================================="

export DISPLAY="${DISPLAY:-:99}"
export RESOLUTION="${RESOLUTION:-1600x900x24}"
export WINEPREFIX="${WINEPREFIX:-/root/.wine}"
export WINEDEBUG="${WINEDEBUG:--all}"
export BROWSER="/usr/local/bin/winebrowser"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
export BRIDGE_PORT="${BRIDGE_PORT:-8080}"
export VNC_PORT="${VNC_PORT:-5900}"
export WS_PORT="${WS_PORT:-6080}"

# 1. Clean up any stale X11 lock files
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true

# 2. Start Xvfb (Virtual Framebuffer X Server)
echo "[1/6] Launching Xvfb display on ${DISPLAY} (${RESOLUTION})..."
Xvfb "${DISPLAY}" -screen 0 "${RESOLUTION}" -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb to become ready
echo "      Waiting for X server display ${DISPLAY}..."
MAX_TRIES=50
COUNT=0
while ! xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; do
    sleep 0.1
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -ge "$MAX_TRIES" ]; then
        echo "Error: Xvfb failed to start within timeout." >&2
        exit 1
    fi
done
echo "      Xvfb is ready."

# 3. Start Openbox Window Manager (avoids WM focus and window stacking issues)
echo "[2/6] Starting Openbox Window Manager..."
openbox &
OPENBOX_PID=$!

# 4. Start Auto-Saver loop (Silent xdotool Ctrl+S every 30s to RAM tmpfs)
echo "[3/6] Starting Auto-Saver loop (xdotool Ctrl+S every 30s)..."
(
    sleep 15
    while true; do
        sleep 30
        xdotool key --clearmodifiers ctrl+s >/dev/null 2>&1 || true
    done
) &
AUTOSAVE_PID=$!

# 5. Start x11vnc (VNC Server on port 5900 with CPU-idle throttling & unidirectional clipboard)
echo "[4/6] Starting x11vnc server (wait 50, defer 40, seldir recv)..."
x11vnc -display "${DISPLAY}" -forever -nopw -shared -rfbport "${VNC_PORT}" -listen 0.0.0.0 -wait 50 -defer 40 -seldir recv -bg -o /tmp/x11vnc.log

# 6. Start Websockify (Exposes VNC over WebSocket on port 6080)
echo "[5/6] Starting Websockify on port ${WS_PORT}..."
websockify --web /usr/share/novnc "${WS_PORT}" "127.0.0.1:${VNC_PORT}" &
WEBSOCKIFY_PID=$!

# 7. Prepare Workspace Report File (in RAM tmpfs)
mkdir -p "${WORKSPACE_DIR}"
REPORT_FILE="${WORKSPACE_DIR}/report.frx"

# Wait briefly for orchestrator to inject initial report bytes into RAM
for i in {1..30}; do
    if [ -s "${REPORT_FILE}" ]; then
        break
    fi
    sleep 0.1
done

if [ ! -s "${REPORT_FILE}" ]; then
    echo "      Copying initial default template to ${REPORT_FILE}..."
    cp /app/default_report.frx "${REPORT_FILE}"
fi

# Ensure Wine-Mono is installed silently without UI prompt
if [ ! -d "/root/.wine/drive_c/windows/Microsoft.NET" ] && [ -f "/root/.cache/wine/wine-mono-9.2.0-x86.msi" ]; then
    echo "      Installing Wine-Mono silently..."
    wine msiexec /i /root/.cache/wine/wine-mono-9.2.0-x86.msi /qn >/dev/null 2>&1 || true
fi

# Ensure Wine associations route web links to our URL redirector (if Wine is present)
if command -v wine >/dev/null 2>&1; then
    echo "      Configuring Wine browser redirector..."
    wine reg add "HKEY_CLASSES_ROOT\http\shell\open\command" /ve /t REG_SZ /d "C:\windows\system32\winebrowser.exe \"%1\"" /f >/dev/null 2>&1 || true
    wine reg add "HKEY_CLASSES_ROOT\https\shell\open\command" /ve /t REG_SZ /d "C:\windows\system32\winebrowser.exe \"%1\"" /f >/dev/null 2>&1 || true
fi

# Signal Handler for graceful shutdown
cleanup() {
    echo ""
    echo "=========================================================="
    echo " Stopping container processes gracefully...               "
    echo "=========================================================="
    kill -TERM "$APP_PID" 2>/dev/null || true
    kill -TERM "$AUTOSAVE_PID" 2>/dev/null || true
    kill -TERM "$WEBSOCKIFY_PID" 2>/dev/null || true
    kill -TERM "$OPENBOX_PID" 2>/dev/null || true
    kill -TERM "$XVFB_PID" 2>/dev/null || true
    if command -v wineserver >/dev/null 2>&1; then
        wineserver -k 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# 8. Launch Target Application
echo "[6/6] Launching target application..."
if command -v mono >/dev/null 2>&1; then
    echo "      Running via Native ARM64 Mono..."
    if [ -f "/app/FastReport-WindowsDesigner/Designer.exe" ]; then
        echo "      Launching FastReport Designer with file: ${REPORT_FILE}"
        mono /app/FastReport-WindowsDesigner/Designer.exe "${REPORT_FILE}" &
        APP_PID=$!
    else
        echo "      Error: Designer.exe not found!"
        exit 1
    fi
elif [ "${APP_MODE}" = "test" ]; then
    echo "      Running in TEST APP mode: Wine Wordpad with hyperlinks test document"
    cp /app/test_doc.rtf "${WORKSPACE_DIR}/test_doc.rtf" 2>/dev/null || true
    wine start "Z:\\workspace\\test_doc.rtf" &
    APP_PID=$!
elif [ -f "/app/FastReport-WindowsDesigner/Designer.exe" ]; then
    echo "      Launching FastReport Designer via Wine with file: ${REPORT_FILE}"
    wine /app/FastReport-WindowsDesigner/Designer.exe "${REPORT_FILE}" &
    APP_PID=$!
else
    echo "      FastReport Designer not found at /app/FastReport-WindowsDesigner/Designer.exe"
    echo "      Falling back to Wine Wordpad with test document..."
    wine wordpad /app/test_doc.rtf &
    APP_PID=$!
fi

echo "=========================================================="
echo " Container services successfully started and streaming.   "
echo " VNC WebSocket: :${WS_PORT} | Bridge SSE: :${BRIDGE_PORT} "
echo "=========================================================="

# Wait for session to initialize and block until closed
if command -v mono >/dev/null 2>&1 && [ -n "$APP_PID" ]; then
    echo "Monitoring Mono application session (PID $APP_PID)..."
    wait "$APP_PID" 2>/dev/null || true
    echo "Mono session finished. Container shutting down."
    cleanup
else
    echo "Monitoring Wine desktop session..."
    for i in {1..30}; do
        if pgrep -f "wineserver" >/dev/null 2>&1; then
            break
        fi
        sleep 0.2
    done
    wineserver -w 2>/dev/null || true
    echo "Wine session finished. Container shutting down."
    cleanup
fi
