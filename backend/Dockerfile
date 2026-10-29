# Build context: ./backend (see docker-compose.yml).
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist dist
COPY --from=build /app/prisma prisma
# The generated Prisma client is not installed by --omit=dev; copy it from the build stage.
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
RUN mkdir -p /storage && chown node:node /storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
