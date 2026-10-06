FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy frontend static files (including novnc)
COPY . /usr/share/nginx/html/

# Copy nginx server configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Clean up configuration file from html root if copied
RUN rm -f /usr/share/nginx/html/nginx.conf /usr/share/nginx/html/Dockerfile

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
