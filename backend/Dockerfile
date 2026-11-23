FROM node:22.14.0-alpine

WORKDIR /app/backend

ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PORT=3000 \
    DEMO_MODE=false

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY sql /app/sql
COPY frontend /app/frontend
COPY backend /app/backend

RUN mkdir -p /app/backend/database /app/backend/storage && \
    chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
