# syntax=docker/dockerfile:1
# Multi-stage build: stage 1 installs and builds the whole workspace, stage 2 keeps only the server's production
# files and the built console. The result runs as the unprivileged node user.

FROM node:26.13.0-alpine AS build
WORKDIR /repo
RUN npm install --global pnpm@12.18.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/sdk/package.json packages/sdk/
COPY apps/server/package.json apps/server/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm --filter @flagken/shared --filter @flagken/api-client --filter @flagken/sdk --filter @flagken/server --filter @flagken/console run build
# A self-contained copy of the server with production dependencies only.
RUN pnpm --filter @flagken/server deploy --prod --legacy /out

FROM node:26.13.0-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    CONSOLE_DIR=/app/console
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --from=build --chown=node:node /repo/apps/console/dist ./console
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -q -O /dev/null http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]
