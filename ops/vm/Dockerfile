# The site, as one image for the bank's virtual machine (ADR 0098). The same code as the public
# site; only its configuration differs, and none of it is in the image: keys, the manifest and
# every setting come in at run time (ops/vm/compose.yaml).
#
#   docker build -f ops/vm/Dockerfile -t structured-note-site:0.2.0 .     (from the repository root)

FROM node:24-bookworm-slim AS build
WORKDIR /repo/site
COPY site/package.json site/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY site/ ./
COPY docs/solution-overview.html /repo/docs/solution-overview.html
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3020 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/site/.next/standalone ./
COPY --from=build --chown=node:node /repo/site/.next/static ./.next/static
COPY --from=build --chown=node:node /repo/site/public ./public
COPY --from=build --chown=node:node /repo/site/content ./content
USER node
EXPOSE 3020
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3020/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
