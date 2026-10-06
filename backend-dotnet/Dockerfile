# ==============================================================================
# FastReport Web Editor - .NET 9 Backend Container
# ==============================================================================
# Multi-stage build with .NET 9 SDK and ASP.NET 9 Runtime
# Includes Docker CLI for container orchestration and GDI+/fonts for FastReport PDF export
# ==============================================================================

# STAGE 1: Build & Publish
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS builder
WORKDIR /src

# Copy project definition and restore dependencies
COPY FastReport.WebEditor.Backend.csproj ./
RUN dotnet restore FastReport.WebEditor.Backend.csproj

# Copy all source files and publish release binary
COPY . ./
RUN dotnet publish FastReport.WebEditor.Backend.csproj -c Release -o /app/publish /p:UseAppHost=false

# STAGE 2: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runner
WORKDIR /app

# Install runtime dependencies:
# - curl & ca-certificates for downloading static Docker CLI binary
# - libgdiplus, fontconfig, and fonts for FastReport OpenSource PDF generation on Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        libgdiplus \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then DOCKER_ARCH="aarch64"; else DOCKER_ARCH="x86_64"; fi && \
    curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-27.3.1.tgz" | tar -xz -C /tmp && \
    mv /tmp/docker/docker /usr/local/bin/docker && \
    chmod +x /usr/local/bin/docker && \
    rm -rf /tmp/docker /var/lib/apt/lists/*

# Copy published binaries from builder stage
COPY --from=builder /app/publish .

# Prepare persistent folders for SQLite database and report storage
RUN mkdir -p /app/storage /app/wwwroot/reports /app/wwwroot/history /app/wwwroot/recovery
COPY wwwroot/ /app/wwwroot/

ENV ASPNETCORE_URLS=http://0.0.0.0:3000 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false

EXPOSE 3000

ENTRYPOINT ["dotnet", "FastReport.WebEditor.Backend.dll"]
