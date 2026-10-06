# ==============================================================================
# FastReport Cloud Stream PoC - Startup Script (Windows PowerShell)
# ==============================================================================
$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " 🚀 FastReport Cloud Stream PoC - Initializing Environment (PowerShell)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 1. Check prerequisites
Write-Host "[1/4] Verifying prerequisites..." -ForegroundColor Yellow
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "❌ Error: Docker CLI is not installed or not in PATH."
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "❌ Error: Node.js is not installed or not in PATH."
    exit 1
}

$dockerVer = (docker --version)
$nodeVer = (node --version)
Write-Host "  ✓ Docker CLI: $dockerVer" -ForegroundColor Green
Write-Host "  ✓ Node.js:    $nodeVer" -ForegroundColor Green

# 2. Check if Docker image already exists
Write-Host "`n[2/4] Checking Docker stream image (fastreport-stream:latest)..." -ForegroundColor Yellow
$imageExists = docker images -q fastreport-stream:latest
if ($imageExists) {
    Write-Host "  ✓ Image 'fastreport-stream:latest' already exists. Skipping build!" -ForegroundColor Green
} else {
    Write-Host "  Building image (first time only)..." -ForegroundColor Yellow
    docker build -t fastreport-stream:latest -f docker/Dockerfile docker/
}

# 3. Ensure Docker network and Nginx Gateway
Write-Host "`n[3/5] Verifying network and Nginx Gateway (testinglab.local)..." -ForegroundColor Yellow
$netExists = docker network ls --filter name=^stream-net$ -q
if (-not $netExists) {
    Write-Host "  Creating network 'stream-net'..." -ForegroundColor DarkYellow
    docker network create stream-net | Out-Null
}
Write-Host "  Starting Nginx Gateway container..." -ForegroundColor DarkYellow
docker compose up -d | Out-Null
Write-Host "  ✓ Nginx Gateway is active on port 80" -ForegroundColor Green

# 4. Install orchestrator dependencies
Write-Host "`n[4/5] Installing Node.js backend dependencies..." -ForegroundColor Yellow
Set-Location "$ScriptDir\server"
npm install --no-audit --no-fund

# 5. Launch backend orchestrator
Write-Host "`n[5/5] Starting Orchestrator Server..." -ForegroundColor Yellow

# Clean up any previous orchestrator process on port 3000
$portOccupied = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($portOccupied) {
    Write-Host "  Closing previous process on port 3000 (PID: $($portOccupied.OwningProcess))..." -ForegroundColor DarkYellow
    Stop-Process -Id $portOccupied.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " ✅ Setup complete! Open your browser at:" -ForegroundColor Green
Write-Host "    👉 http://testinglab.local" -ForegroundColor Yellow
Write-Host "    (o directamente http://localhost:3000)" -ForegroundColor Gray
Write-Host "======================================================================" -ForegroundColor Cyan

node orchestrator.js
