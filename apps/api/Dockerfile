# syntax=docker/dockerfile:1
FROM node:24.22.3-bookworm-slim AS development
LABEL org.opencontainers.image.source="https://github.com/LiL-FlexeR/payment-processing-simulator"
WORKDIR /workspace
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install --no-install-recommends -y openssl
RUN npm install --global npm@11.13.0
RUN chown node:node /workspace
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
USER node
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci --workspace @simulator/api --include-workspace-root
COPY --chown=node:node apps/api ./apps/api
RUN npm run db:generate --workspace @simulator/api
EXPOSE 3001
CMD ["npm", "run", "dev", "--workspace", "@simulator/api"]
