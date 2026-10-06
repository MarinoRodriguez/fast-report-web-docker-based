#!/usr/bin/env bash
# ==============================================================================
# FastReport Cloud Stream PoC - Startup Script (Linux / macOS / Git Bash)
# ==============================================================================
set -e

echo "======================================================================"
echo " 🚀 FastReport Cloud Stream PoC - Initializing Environment           "
echo "======================================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# 1. Check prerequisites
echo "[1/4] Verifying prerequisites..."
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ Error: Docker is not installed or not in PATH." >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js is not installed or not in PATH." >&2
    exit 1
fi

echo "  ✓ Docker CLI: $(docker --version)"
echo "  ✓ Node.js:    $(node --version)"

# 2. Build Docker streaming image
echo ""
echo "[2/4] Building Docker ephemeral stream image (fastreport-stream:latest)..."
docker build -t fastreport-stream:latest -f docker/Dockerfile docker/

# 3. Install orchestrator dependencies
echo ""
echo "[3/4] Installing Node.js backend dependencies..."
cd server
npm install --no-audit --no-fund

# 4. Launch backend orchestrator
echo ""
echo "[4/4] Starting Orchestrator Server..."
echo "======================================================================"
echo " ✅ Setup complete! Open your browser at:"
echo "    👉 http://localhost:3000"
echo "======================================================================"

node orchestrator.js
