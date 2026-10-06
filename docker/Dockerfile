# ==============================================================================
# FastReport Docker Stream - Ephemeral Container Dockerfile
# ==============================================================================
# Linux Debian Slim container with Wine 64/32-bit, Xvfb headless display,
# Openbox window manager, x11vnc, websockify, and Python bridge server.
# Wine browser calls are redirected to our SSE bridge instead of running a local browser.
# ==============================================================================

FROM debian:bookworm-slim

LABEL maintainer="Antigravity Cloud Architecture"
LABEL description="Headless FastReport Windows Designer stream over WebSockets & SSE"

ENV DEBIAN_FRONTEND=noninteractive \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=:99 \
    RESOLUTION=1280x720x24 \
    BROWSER=/usr/local/bin/winebrowser \
    WORKSPACE_DIR=/workspace \
    BRIDGE_PORT=8080 \
    WS_PORT=6080 \
    VNC_PORT=5900

# 1. Enable 32-bit architecture & install Wine, Xvfb, Openbox, VNC, Websockify, Python, Curl, Fonts
RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        wine \
        wine64 \
        wine32:i386 \
        fonts-wine \
        xvfb \
        x11-utils \
        xdotool \
        openbox \
        x11vnc \
        websockify \
        novnc \
        python3 \
        curl \
        ca-certificates \
        procps \
        net-tools \
        fontconfig \
        zenity \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-freefont-ttf && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 2. Setup Wine-Mono directory and download Wine-Mono 7.4.0 MSI (matches Debian Wine 8.0/7.4)
RUN mkdir -p /usr/share/wine/mono && \
    curl -sSL -o /usr/share/wine/mono/wine-mono-7.4.0-x86.msi \
    https://dl.winehq.org/wine/wine-mono/7.4.0/wine-mono-7.4.0-x86.msi

WORKDIR /app

# 3. Install URL Redirector (Intercepts Wine browser calls)
COPY url-redirector.sh /usr/local/bin/winebrowser
RUN chmod +x /usr/local/bin/winebrowser && \
    ln -sf /usr/local/bin/winebrowser /usr/bin/winebrowser && \
    ln -sf /usr/local/bin/winebrowser /usr/bin/xdg-open && \
    ln -sf /usr/local/bin/winebrowser /usr/bin/sensible-browser && \
    ln -sf /usr/local/bin/winebrowser /usr/bin/x-www-browser

# 4. Copy templates, openbox config, and entrypoint
COPY default_report.frx /app/default_report.frx
COPY test_doc.rtf /app/test_doc.rtf
COPY openbox_rc.xml /etc/xdg/openbox/rc.xml
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 5. Copy FastReport Windows Designer binaries
COPY FastReport-WindowsDesigner/ /app/FastReport-WindowsDesigner/

# 6. Initialize Wine prefix and install Windows Core Fonts for System.Drawing GDI+
RUN wineboot --init && wineserver -w

# Copy Windows fonts into system and Wine prefix, then rebuild font cache
COPY fonts/ /root/.wine/drive_c/windows/Fonts/
COPY fonts/ /usr/share/fonts/truetype/msttcorefonts/
RUN fc-cache -fv

# 7. Compile DotNetBar-compatible dwmapi stubs (0-param DwmIsCompositionEnabled) to avoid QEMU/Wine stack corruption
COPY dwmapi_fix.c dwmapi.def /tmp/
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64 gcc-mingw-w64-i686 && \
    x86_64-w64-mingw32-gcc -shared -s -O2 -o /root/.wine/drive_c/windows/system32/dwmapi.dll /tmp/dwmapi_fix.c /tmp/dwmapi.def && \
    i686-w64-mingw32-gcc -shared -s -O2 -o /root/.wine/drive_c/windows/syswow64/dwmapi.dll /tmp/dwmapi_fix.c /tmp/dwmapi.def && \
    apt-get purge -y gcc-mingw-w64-x86-64 gcc-mingw-w64-i686 && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/dwmapi*

ENV WINEDLLOVERRIDES="dwmapi=n"

# 7. Create workspace mount point
RUN mkdir -p /workspace

EXPOSE 6080 8080

ENTRYPOINT ["/app/entrypoint.sh"]
