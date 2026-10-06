#!/usr/bin/env bash
# ==============================================================================
# FastReport Web Editor - Production Server Setup & Deployment Script
# ==============================================================================
set -e

echo "======================================================================"
echo " FastReport Web Editor - Despliegue en Servidor de Producción"
echo "======================================================================"

# 1. Verificar archivo .env
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "No se encontró .env. Creando .env a partir de .env.example..."
    cp .env.example .env
    echo "Por favor edita .env con tu usuario de Docker Hub antes de continuar."
    exit 1
  else
    echo "Error: Falta el archivo .env con las variables de entorno."
    exit 1
  fi
fi

# Cargar variables de entorno
set -a
source .env
set +a

# 2. Verificar arquitectura (Si es ARM64, verificar/instalar emulación binfmt para Wine x86)
ARCH=$(uname -m)
echo "ℹArquitectura del servidor detectada: ${ARCH}"

if [ "$TAG" != "box64" ] && { [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; }; then
  echo "Modo legacy detectado (Wine x86 en ARM): Verificando soporte para emulación QEMU..."
  if ! [ -f /proc/sys/fs/binfmt_misc/qemu-x86_64 ]; then
    echo "Instalando emuladores QEMU binfmt para soporte de binarios Windows x86 en ARM..."
    docker run --privileged --rm tonistiigi/binfmt --install all
  else
    echo "Emulador QEMU binfmt ya activo en el kernel."
  fi
elif [ "$TAG" = "box64" ]; then
  echo "Modo Box64 ARM64 nativo activo: Se omite la emulación QEMU del host."
fi

# 3. Crear red Docker interna si no existe
if ! docker network ls --format '{{.Name}}' | grep -q '^stream-net$'; then
  echo "Creando red interna de Docker 'stream-net'..."
  docker network create stream-net
else
  echo "Red 'stream-net' ya existe."
fi

# 4. Crear carpetas para persistencia de datos
echo "Preparando directorios de almacenamiento..."
mkdir -p storage reports history recovery

# Garantizar que blank.frx exista en reports/
if [ ! -s reports/blank.frx ]; then
  echo "Creando plantilla predeterminada reports/blank.frx..."
  cat <<'EOF' > reports/blank.frx
<?xml version="1.0" encoding="utf-8"?>
<Report ScriptLanguage="CSharp" ReportInfo.Created="10/05/2026 15:13:41" ReportInfo.Modified="10/05/2026 15:14:55" ReportInfo.CreatorVersion="2025.1.0.0">
  <Dictionary/>
  <ReportPage Name="Page1" Watermark.Font="Arial, 60pt">
    <ReportTitleBand Name="ReportTitle1" Width="718.2" Height="37.8">
      <TextObject Name="Text1" Width="245.7" Height="28.35" Text="Blank Report" Font="Arial, 18pt, style=Bold"/>
    </ReportTitleBand>
    <PageHeaderBand Name="PageHeader1" Top="41.8" Width="718.2" Height="28.35"/>
    <DataBand Name="Data1" Top="74.15" Width="718.2" Height="75.6"/>
    <PageFooterBand Name="PageFooter1" Top="153.75" Width="718.2" Height="18.9"/>
  </ReportPage>
</Report>
EOF
fi

# 5. Pre-descargar imagen del Diseñador Wine
TAG_STREAM="${STREAM_TAG:-${TAG:-box64}}"
echo "📥 Descargando imagen del diseñador gráfico (${DOCKER_USER}/fastreport-stream:${TAG_STREAM})..."
PLATFORM_PULL_FLAG=""
if [ -n "$STREAM_PLATFORM" ]; then
  PLATFORM_PULL_FLAG="--platform $STREAM_PLATFORM"
elif [ "$TAG_STREAM" != "box64" ] && { [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; }; then
  PLATFORM_PULL_FLAG="--platform linux/amd64"
fi

docker pull $PLATFORM_PULL_FLAG "${DOCKER_USER}/fastreport-stream:${TAG_STREAM}" && \
docker tag "${DOCKER_USER}/fastreport-stream:${TAG_STREAM}" fastreport-stream:latest || {
  echo "⚠️  Nota: No se pudo descargar ${DOCKER_USER}/fastreport-stream:${TAG_STREAM}. Verifica si la imagen ya existe localmente."
}

# 6. Descargar y desplegar Gateway y Backend
echo "Descargando y levantando contenedores de producción..."
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

echo "======================================================================"
echo "Despliegue completado con éxito."
echo "Gateway Nginx disponible en puerto :${HTTP_PORT:-80}"
echo "======================================================================"
