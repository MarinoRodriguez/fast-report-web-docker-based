#!/usr/bin/env bash
# ==============================================================================
# FastReport Web Editor - Multi-Arch Build & Push to Docker Hub
# ==============================================================================
set -e

DOCKER_USER="${1}"
TAG="${2:-latest}"

echo "======================================================================"
echo "  🚀 FastReport Web Editor - Publicación a Docker Hub (Multi-Arch)"
echo "======================================================================"

if [ -z "$DOCKER_USER" ]; then
  read -rp "👉 Ingresa tu nombre de usuario de Docker Hub: " DOCKER_USER
  if [ -z "$DOCKER_USER" ]; then
    echo "❌ Error: El usuario de Docker Hub no puede estar vacío."
    exit 1
  fi
fi

echo -e "\nℹ️  Usuario Docker Hub: ${DOCKER_USER}"
echo -e "ℹ️  Tag de versión:    ${TAG}\n"

# 1. Login Docker Hub
echo "🔐 Verificando autenticación en Docker Hub..."
docker login

# 2. Configurar Buildx
echo -e "\n🔧 Configurando Docker Buildx (multiarch-builder)..."
if ! docker buildx ls | grep -q "multiarch-builder"; then
  docker buildx create --name multiarch-builder --driver docker-container --use
else
  docker buildx use multiarch-builder
fi
docker buildx inspect --bootstrap

# 3. Imagen 1: fastreport-gateway (Frontend + Nginx unificado)
GATEWAY_IMG="${DOCKER_USER}/fastreport-gateway:${TAG}"
echo -e "\n📦 [1/3] Compilando y subiendo GATEWAY + FRONTEND (${GATEWAY_IMG})..."
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "${GATEWAY_IMG}" \
  -f ./nginx/Dockerfile . --push

# 4. Imagen 2: fastreport-backend (.NET 9 Minimal API)
BACKEND_IMG="${DOCKER_USER}/fastreport-backend:${TAG}"
echo -e "\n📦 [2/3] Compilando y subiendo BACKEND API (${BACKEND_IMG})..."
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "${BACKEND_IMG}" \
  ./backend-dotnet --push

# 5. Imagen 3: fastreport-stream (Wine Windows Designer)
STREAM_IMG="${DOCKER_USER}/fastreport-stream:${TAG}"
echo -e "\n📦 [3/3] Etiquetando y subiendo FASTREPORT STREAM (${STREAM_IMG})..."
if ! docker image inspect fastreport-stream:latest >/dev/null 2>&1; then
  echo "Compilando fastreport-stream:latest localmente..."
  docker build -t fastreport-stream:latest -f docker/Dockerfile docker/
fi
docker tag fastreport-stream:latest "${STREAM_IMG}"
docker push "${STREAM_IMG}"

echo -e "\n======================================================================"
echo "  ✅ ¡Las 3 imágenes fueron subidas exitosamente a Docker Hub!"
echo "======================================================================"
echo "  1. ${GATEWAY_IMG}"
echo "  2. ${BACKEND_IMG}"
echo "  3. ${STREAM_IMG}"
echo -e "\n📋 Para desplegar en tu servidor Linux ARM:"
echo "   1. Copia docker-compose.prod.yml, .env.example y deploy-server.sh al servidor."
echo "   2. En el servidor crea .env con: DOCKER_USER=${DOCKER_USER} y TAG=${TAG}"
echo -e "   3. Ejecuta: ./deploy-server.sh\n"
