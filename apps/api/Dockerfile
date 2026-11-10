# syntax=docker/dockerfile:1
#
# Payana API image.
#
# Build from the REPOSITORY ROOT (the API depends on packages/contracts):
#   docker build -f apps/api/Dockerfile -t payana-api .
# The ignore rules for this build are in apps/api/Dockerfile.dockerignore.
#
# The image contains:
#   /app/apps/api/dist/main.js              the API            (default command)
#   /app/apps/api/dist/database/migrate.js  migration runner   (node dist/database/migrate.js up)
#   /etc/ssl/certs/rds-global-bundle.pem    Amazon RDS CA bundle, trusted via NODE_EXTRA_CA_CERTS
# It runs as the unprivileged user 1000 and holds no secrets: all configuration
# comes from the environment (see apps/api/.env.example).

# ---------------------------------------------------------------------------- build
FROM --platform=linux/amd64 node:24-bookworm-slim AS build
WORKDIR /repo

# Shared contracts first: they change less often than the API, so this layer caches well.
COPY packages/contracts/package.json packages/contracts/package-lock.json packages/contracts/
RUN npm --prefix packages/contracts ci --no-audit --no-fund
COPY packages/contracts packages/contracts
RUN npm --prefix packages/contracts run build

COPY apps/api/package.json apps/api/package-lock.json apps/api/
RUN npm --prefix apps/api ci --no-audit --no-fund
COPY apps/api apps/api
RUN npm --prefix apps/api run build \
 && npm --prefix apps/api prune --omit=dev --no-audit --no-fund

# Amazon RDS certificate authority bundle, so DATABASE_SSL=true can verify the server.
ADD --chmod=0644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /tmp/rds-global-bundle.pem

# -------------------------------------------------------------------------- runtime
FROM --platform=linux/amd64 node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem

COPY --from=build /tmp/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

# Same relative layout as the repository, so the `file:` link to the contracts package resolves.
WORKDIR /app/apps/api
COPY --from=build --chown=1000:1000 /repo/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build --chown=1000:1000 /repo/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build --chown=1000:1000 /repo/apps/api/package.json ./package.json
COPY --from=build --chown=1000:1000 /repo/apps/api/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /repo/apps/api/dist ./dist

# The `node` user in the official image is UID/GID 1000.
USER 1000:1000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "dist/main.js"]
