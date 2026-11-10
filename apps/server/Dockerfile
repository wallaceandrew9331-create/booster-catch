# Leaderboard server image. Build from the repo root so the shared sim
# package is in the build context:
#   docker build -f apps/server/Dockerfile -t booster-catch-server .

FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/sim packages/sim
COPY apps/server apps/server
# esbuild bundles the server, Fastify and the sim into one file.
RUN npm run build -w @booster/server

FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/booster-catch.db NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=build /repo/apps/server/dist/server.mjs ./server.mjs
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server.mjs"]
