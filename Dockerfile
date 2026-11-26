# MaM Portal container image.
#
# Used for the mail proxy and the web portal together: one process, one config.
# Mail ports are privileged, so the container either needs
# --cap-add=NET_BIND_SERVICE (with a non-root user) or --user root.
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/app/data

# Dependencies first so a code change does not rebuild this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY mail ./mail
COPY lib ./lib
COPY tools ./tools
COPY config.sample.ini ./
COPY docs ./docs
COPY public ./public

RUN mkdir -p /app/data /app/certs && chown -R node:node /app/data /app/certs

USER node
EXPOSE 8080 993 995 465

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
