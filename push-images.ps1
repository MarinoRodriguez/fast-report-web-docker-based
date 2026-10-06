<#
.SYNOPSIS
    Script automatizado para compilar y subir las 3 imágenes a Docker Hub con soporte Multi-Arquitectura (AMD64 + ARM64).
.EXAMPLE
    .\push-images.ps1 -DockerUser "tu_usuario"
    .\push-images.ps1 -DockerUser "tu_usuario" -Tag "v1.0.0"
#>

param (
    [Parameter(Mandatory = $false, Position = 0)]
    [string]$DockerUser,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  🚀 FastReport Web Editor - Publicación a Docker Hub (Multi-Arch)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Solicitar usuario si no fue proporcionado
if ([string]::IsNullOrWhiteSpace($DockerUser)) {
    $DockerUser = Read-Host "👉 Ingresa tu nombre de usuario de Docker Hub"
    if ([string]::IsNullOrWhiteSpace($DockerUser)) {
        Write-Error "El usuario de Docker Hub no puede estar vacío."
        exit 1
    }
}

Write-Host "`nℹ️  Usuario Docker Hub: $DockerUser" -ForegroundColor Green
Write-Host "ℹ️  Tag de versión:    $Tag`n" -ForegroundColor Green

# 2. Login a Docker Hub si no hay sesión activa
Write-Host "🔐 Verificando autenticación en Docker Hub..." -ForegroundColor Yellow
docker login
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo en la autenticación de Docker Hub. Proceso abortado."
    exit 1
}

# 3. Configurar Docker Buildx para soporte Multi-Arquitectura (AMD64 + ARM64)
Write-Host "`n🔧 Configurando Docker Buildx (multiarch-builder)..." -ForegroundColor Yellow
$builderExists = docker buildx ls | Select-String -Pattern "multiarch-builder"
if (-not $builderExists) {
    docker buildx create --name multiarch-builder --driver docker-container --use
} else {
    docker buildx use multiarch-builder
}
docker buildx inspect --bootstrap

# 4. Imagen 1: fastreport-gateway (Nginx + Frontend SPA unificado)
$gatewayImg = "${DockerUser}/fastreport-gateway:${Tag}"
Write-Host "`n----------------------------------------------------------------------" -ForegroundColor Magenta
Write-Host "📦 [1/3] Compilando y subiendo GATEWAY + FRONTEND ($gatewayImg)..." -ForegroundColor Magenta
Write-Host "   Plataformas: linux/amd64, linux/arm64" -ForegroundColor DarkGray
Write-Host "----------------------------------------------------------------------" -ForegroundColor Magenta

docker buildx build --platform linux/amd64,linux/arm64 `
    -t $gatewayImg `
    -f ./nginx/Dockerfile . --push

if ($LASTEXITCODE -ne 0) {
    Write-Error "Error compilando o subiendo fastreport-gateway."
    exit 1
}

# 5. Imagen 2: fastreport-backend (.NET 9 Minimal API + Orquestador)
$backendImg = "${DockerUser}/fastreport-backend:${Tag}"
Write-Host "`n----------------------------------------------------------------------" -ForegroundColor Magenta
Write-Host "📦 [2/3] Compilando y subiendo BACKEND API ($backendImg)..." -ForegroundColor Magenta
Write-Host "   Plataformas: linux/amd64, linux/arm64" -ForegroundColor DarkGray
Write-Host "----------------------------------------------------------------------" -ForegroundColor Magenta

docker buildx build --platform linux/amd64,linux/arm64 `
    -t $backendImg `
    ./backend-dotnet --push

if ($LASTEXITCODE -ne 0) {
    Write-Error "Error compilando o subiendo fastreport-backend."
    exit 1
}

# 6. Imagen 3: fastreport-stream (Wine Windows Designer Streaming Container)
$streamImg = "${DockerUser}/fastreport-stream:${Tag}"
Write-Host "`n----------------------------------------------------------------------" -ForegroundColor Magenta
Write-Host "📦 [3/3] Etiquetando y subiendo FASTREPORT STREAM ($streamImg)..." -ForegroundColor Magenta
Write-Host "----------------------------------------------------------------------" -ForegroundColor Magenta

$localStream = docker images -q fastreport-stream:latest
if (-not $localStream) {
    Write-Warning "No se encontró fastreport-stream:latest localmente. Verificando si existe buildable..."
    if (Test-Path "docker/Dockerfile") {
        Write-Host "Compilando fastreport-stream localmente primero..." -ForegroundColor Yellow
        docker build -t fastreport-stream:latest -f docker/Dockerfile docker/
    } else {
        Write-Error "No se encontró la imagen ni el Dockerfile de fastreport-stream."
        exit 1
    }
}

docker tag fastreport-stream:latest $streamImg
docker push $streamImg

if ($LASTEXITCODE -ne 0) {
    Write-Error "Error subiendo fastreport-stream."
    exit 1
}

# 7. Actualizar o generar .env localmente para conveniencia
if (Test-Path ".env") {
    $envContent = Get-Content ".env" -Raw
    $envContent = $envContent -replace "DOCKER_USER=.*", "DOCKER_USER=$DockerUser"
    $envContent = $envContent -replace "TAG=.*", "TAG=$Tag"
    Set-Content -Path ".env" -Value $envContent
}

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "  ✅ ¡Las 3 imágenes fueron subidas exitosamente a Docker Hub!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  1. $gatewayImg" -ForegroundColor White
Write-Host "  2. $backendImg" -ForegroundColor White
Write-Host "  3. $streamImg" -ForegroundColor White
Write-Host "`n📋 Para desplegar en tu servidor Linux ARM:" -ForegroundColor Cyan
Write-Host "   1. Copia docker-compose.prod.yml, .env.example y deploy-server.sh al servidor." -ForegroundColor Gray
Write-Host "   2. En el servidor crea .env con: DOCKER_USER=$DockerUser y TAG=$Tag" -ForegroundColor Gray
Write-Host "   3. Ejecuta: ./deploy-server.sh`n" -ForegroundColor Gray
