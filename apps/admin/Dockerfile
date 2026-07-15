FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/shared/package.json packages/shared/package.json

# yt-dlp-exec's own preinstall script is broken in CI-like environments (see
# apps/backend/Dockerfile) - this app doesn't even use it, but it's a hoisted
# workspace dependency so any yarn install touches it regardless.
RUN yarn install --ignore-scripts --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/admin apps/admin

# Vite bakes VITE_* vars into the bundle at build time (not readable at
# container runtime), so this has to be a build ARG, passed in as a Railway
# service variable of the same name - see .railway/railway.ts.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN yarn workspace @mizaly/admin build

ENV NODE_ENV=production
CMD ["sh", "-c", "npx --yes serve -s apps/admin/dist -l $PORT"]
