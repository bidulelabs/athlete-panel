FROM node:22-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.28.8

FROM base AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/host/package.json packages/host/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
RUN pnpm install --frozen-lockfile
# Only declared source roots enter the image; local exports are never build inputs.
COPY apps ./apps
COPY packages ./packages
COPY plugins ./plugins
COPY personal-plugins ./personal-plugins
COPY instance ./instance
COPY scripts ./scripts
COPY tests ./tests
COPY docs ./docs
COPY .agents ./.agents
COPY .claude ./.claude
COPY .github ./.github
COPY .impeccable/design.json ./.impeccable/design.json
COPY tsconfig.json vitest.config.ts playwright.config.ts Dockerfile compose.yml compose.local.yml compose.test.yml Caddyfile .dockerignore .gitignore .env.example AGENTS.md README.md PRODUCT.md DESIGN.md LICENSE SECURITY.md CONTRIBUTING.md ./
RUN pnpm build && node --import tsx scripts/release-metadata.ts

# Operational commands use tsx at runtime; compilers/test runners stay in the build stage.
RUN CI=true pnpm install --prod --frozen-lockfile --offline

FROM base AS runtime
LABEL io.athlete-panel.hosted.protocol="1" org.opencontainers.image.title="Athlete Panel" org.opencontainers.image.licenses="MIT"
# Client tools only: no PostgreSQL server or gosu in application processes.
RUN apk upgrade --no-cache && apk add --no-cache postgresql17-client && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p apps/web/.next/standalone/apps/web/.next && cp -a apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static && if [ -d apps/web/public ]; then cp -a apps/web/public apps/web/.next/standalone/apps/web/public; fi
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
USER node
EXPOSE 3000
ENTRYPOINT []
CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]
