FROM oven/bun:1
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000
USER bun
ARG APP_PORT=3000
EXPOSE ${APP_PORT}
CMD ["bun", "server.js"]
