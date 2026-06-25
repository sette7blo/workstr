FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    WORKSTR_BIND_HOST=0.0.0.0 \
    WORKSTR_BIND_PORT=3003 \
    WORKSTR_DB_STORE=/data/workstr.db

# su-exec lets the entrypoint fix bind-mount ownership as root, then drop to the
# unprivileged app user.
RUN apk add --no-cache su-exec

COPY package.json ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/app-entrypoint.sh

RUN addgroup -S workstr && adduser -S workstr -G workstr \
    && mkdir -p /data && chown -R workstr:workstr /app /data \
    && chmod +x /usr/local/bin/app-entrypoint.sh

EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3003/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Entrypoint runs as root only long enough to chown /data, then exec's as workstr.
ENTRYPOINT ["app-entrypoint.sh"]
CMD ["node", "src/server.js"]
