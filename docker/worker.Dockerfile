# Worker image for Cloud Run jobs: Chromium (Playwright) and ffmpeg (plan M0.7).
FROM mirror.gcr.io/library/node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:worker && pnpm install --prod --frozen-lockfile --ignore-scripts

# The Playwright image pins Chromium to the Playwright version in the lockfile.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/db/migrations
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/package.json ./
USER pwuser
ENTRYPOINT ["node", "dist/worker.mjs"]
CMD ["help"]
