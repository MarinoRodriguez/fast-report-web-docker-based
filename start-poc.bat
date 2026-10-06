@echo off
REM ==============================================================================
REM FastReport Cloud Stream PoC - Startup Script (Windows Batch)
REM ==============================================================================
echo ======================================================================
echo  FastReport Cloud Stream PoC - Initializing Environment (Batch)
echo ======================================================================

cd /d "%~dp0"

echo [1/4] Verifying prerequisites...
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Docker is not installed or not in PATH.
    pause
    exit /b 1
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

echo [2/4] Checking Docker stream image...
set IMAGE_FOUND=
for /f "tokens=*" %%i in ('docker images -q fastreport-stream:latest') do set IMAGE_FOUND=%%i
if defined IMAGE_FOUND (
    echo   Image 'fastreport-stream:latest' already exists. Skipping build!
) else (
    echo   Building image for the first time...
    docker build -t fastreport-stream:latest -f docker/Dockerfile docker/
    if %errorlevel% neq 0 (
        echo Error building Docker image.
        pause
        exit /b 1
    )
)

echo [3/5] Verifying network and Nginx Gateway (testinglab.local)...
docker network create stream-net >nul 2>nul
docker compose up -d >nul 2>nul
echo   Nginx Gateway active on port 80.

echo [4/5] Installing Node.js backend dependencies...
cd server
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo Error installing npm packages.
    pause
    exit /b 1
)

echo [5/5] Starting Orchestrator Server...
echo ======================================================================
echo  Setup complete! Open your browser at:
echo  http://testinglab.local
echo  (o directamente http://localhost:3000)
echo ======================================================================
node orchestrator.js
pause
