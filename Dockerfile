# BookmarkHub 2 - one container: Node serves the API and the built frontend.
# ---- build frontend ----
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig*.json tailwind.config.ts postcss.config.js components.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:24-alpine
RUN apk add --no-cache su-exec tzdata
ENV NODE_ENV=production \
    PORT=3131 \
    DATA_DIR=/app/data \
    TZ=Europe/Berlin
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/*.js ./server/
COPY --from=build /src/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/reset-admin-password /usr/local/bin/reset-admin-password
# Synology shares often hand out files with mode 000 + ACLs; make the app readable for the node user.
RUN chmod -R u=rwX,go=rX /app/server /app/dist \
 && chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/reset-admin-password \
 && mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3131
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3131/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/server/server.js"]
