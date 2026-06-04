FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/config ./dist/config
COPY --from=builder /app/../config ../config
COPY --from=builder /app/../shared ../shared

EXPOSE 3001

CMD ["node", "dist/app.js"]
