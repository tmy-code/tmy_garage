# --- Build the phone app ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

# --- Runtime: the Node server runs the TypeScript sources directly (Node 24 strips types) ---
FROM node:24-slim
WORKDIR /app
# TZ sets when "today" starts and the hour Reminders go out (REMINDER_HOUR, default 9).
ENV NODE_ENV=production \
    TZ=Europe/Paris \
    PORT=3000 \
    DATA_DIR=/data \
    CLIENT_DIR=/app/dist/client
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY --from=build /app/dist/client ./dist/client
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Runs as root so it can write to a Synology shared folder without changing its permissions;
# the app is only reachable over Tailscale.
CMD ["node", "src/server/main.ts"]
