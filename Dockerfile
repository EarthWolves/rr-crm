FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY client/package*.json client/
RUN npm ci --omit=dev && npm --prefix client ci
COPY . .
RUN npm --prefix client run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/client/dist client/dist
COPY package.json ./
COPY server server
EXPOSE 3000
CMD ["node", "server/index.js"]
