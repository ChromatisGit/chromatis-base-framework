# The image of a Chromatis Bun application. The build context is the
# instance's `.chromatis/image` after `chromatis build` (server.js, migrate.js,
# build/client and the product's migrations). A mounted image
# (`instance = "mounted"`) reads its configuration from /instance at startup.
FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 CHROMATIS_INSTANCE=/instance
USER bun
ARG APP_PORT=3000
EXPOSE ${APP_PORT}
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://localhost:${process.env.PORT}/_chromatis/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.js"]
