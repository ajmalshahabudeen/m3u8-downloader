# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app

# Must be set BEFORE `playwright install` so browsers land in this path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# System deps: ffmpeg + python + Playwright Chromium OS libraries
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    openssl \
    build-essential \
    python3-dev \
    wget \
    gnupg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libwayland-client0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxshmfence1 \
    fonts-liberation \
    fonts-unifont \
  && rm -rf /var/lib/apt/lists/*

# Python tooling + Chromium into PLAYWRIGHT_BROWSERS_PATH
COPY python/requirements.txt /tmp/requirements.txt
RUN mkdir -p /ms-playwright \
  && pip3 install --break-system-packages --no-cache-dir \
      -r /tmp/requirements.txt \
      m3u8downloader \
  && ln -sf /usr/local/bin/downloadm3u8 /usr/bin/downloadm3u8 2>/dev/null || true \
  && python3 -m playwright install chromium \
  && python3 -m playwright install-deps chromium || true \
  && chmod -R a+rx /ms-playwright \
  && rm -f /tmp/requirements.txt \
  && python3 -c "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(headless=True, args=['--no-sandbox','--disable-dev-shm-usage']); b.close(); p.stop(); print('playwright-chromium-ok')"

ENV NEXT_TELEMETRY_DISABLED=1 \
    DOWNLOADS_DIR=/app/downloads \
    DATABASE_URL=file:/app/data/prod.db \
    DOWNLOADM3U8_BIN=/usr/local/bin/downloadm3u8 \
    PYTHON_BIN=python3 \
    PYTHON_SCRIPTS_DIR=/app/python \
    MAX_CONCURRENT_DOWNLOADS=2 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

RUN mkdir -p /app/data /app/downloads \
  && npm rebuild better-sqlite3 \
  && npx prisma generate \
  && npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=38478 \
    HOSTNAME=0.0.0.0 \
    PYTHON_BIN=python3 \
    PYTHON_SCRIPTS_DIR=/app/python \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN mkdir -p /app/data /app/downloads \
  && chmod 777 /app/data /app/downloads

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/python ./python
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh \
  && chmod +x /app/python/*.py || true

EXPOSE 38478
VOLUME ["/app/data", "/app/downloads"]

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
