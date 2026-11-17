# syntax=docker/dockerfile:1
# Aeyhey: one image runs either the web app or the worker.
#   docker run ... aeyhey web
#   docker run ... aeyhey worker

# ---------- deps ----------
FROM node:22-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm -r build

# ---------- runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV DATA_DIR=/data
ENV DATABASE_URL=file:/data/aeyhey.db
ENV PORT=3000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# next build with output: standalone produces a self-contained server plus the minimal
# node_modules it needs. The source tree comes along too, because @aeyhey/core ships
# TypeScript and both the worker and the migration runner read it at runtime.
COPY --from=build /app/apps/web/.next/standalone/ ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/worker.ts ./apps/web/worker.ts
COPY --from=build /app/apps/web/migrate.ts ./apps/web/migrate.ts
COPY --from=build /app/apps/web/runtime.ts ./apps/web/runtime.ts
COPY --from=build /app/apps/web/aeyhey.plugins.ts ./apps/web/aeyhey.plugins.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY docker/entrypoint.sh /usr/local/bin/aeyhey-entrypoint
RUN chmod +x /usr/local/bin/aeyhey-entrypoint

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aeyhey-entrypoint"]
CMD ["web"]
