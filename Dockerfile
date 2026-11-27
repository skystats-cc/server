FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
# Same image runs both processes:
#   api:    node dist/apps/api.js     (default)
#   worker: node dist/apps/worker.js
#   migrate: node dist/db/migrate.js
CMD ["node", "dist/apps/api.js"]
