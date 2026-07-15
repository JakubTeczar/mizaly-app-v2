FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg chromium \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
    wget \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json yarn.lock ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/shared/package.json packages/shared/package.json

# yt-dlp-exec's own preinstall script (npx bin-version-check-cli) is broken
# in CI-like environments - install without scripts, then run just the one
# postinstall step this project actually needs (downloading the yt-dlp
# binary; puppeteer's own Chromium download is skipped, see
# PUPPETEER_EXECUTABLE_PATH above).
RUN yarn install --ignore-scripts --frozen-lockfile
RUN node node_modules/yt-dlp-exec/scripts/postinstall.js || true
# bcrypt is a native addon - its own install script (which --ignore-scripts
# also skipped) compiles/fetches the actual binding, without it `require`
# fails at runtime with MODULE_NOT_FOUND on bcrypt_lib.node.
RUN cd node_modules/bcrypt && node ../.bin/node-pre-gyp install --fallback-to-build

COPY packages/shared packages/shared
COPY apps/backend apps/backend
COPY apps/instagram-scraper apps/instagram-scraper

RUN pip3 install --no-cache-dir --break-system-packages -r apps/instagram-scraper/requirements.txt

# --ignore-scripts above also skipped @prisma/client's own postinstall
# (which normally generates the client) - do it explicitly.
RUN node node_modules/prisma/build/index.js generate --schema apps/backend/prisma/schema.prisma

RUN yarn workspace @mizaly/backend build

WORKDIR /app/apps/backend
ENV NODE_ENV=production

CMD ["sh", "-c", "node ../../node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && node dist/index.js"]
