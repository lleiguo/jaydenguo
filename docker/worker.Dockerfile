# Worker image for Cloud Run jobs: Chromium (Playwright) and ffmpeg (plan M0.7).
FROM mirror.gcr.io/library/node:22-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:worker

# Production dependencies depend only on the lockfile, so an ordinary deploy
# reuses this layer and only dist/ is new (intent 0016).
FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Only Chromium's headless shell (what chromium.launch() runs headless), not
# the three browsers of the Playwright image. Keep the version equal to
# playwright-core in package.json.
FROM mirror.gcr.io/library/node:22-slim AS runtime
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && npx --yes playwright-core@1.63.0 install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/db/migrations
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/worker.mjs"]
CMD ["help"]
