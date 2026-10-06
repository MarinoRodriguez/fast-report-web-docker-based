# ==============================================================================
# FastReport Web Editor - Unified Gateway & Frontend Container
# ==============================================================================
# Multi-architecture compatible: linux/amd64, linux/arm64
# Combines Nginx reverse proxy with the embedded frontend SPA
# ==============================================================================

FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy custom Nginx gateway configuration
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copy all frontend assets (HTML, CSS, JS, ES modules, icons)
COPY public/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
