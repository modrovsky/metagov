FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Default state directory — mount a volume here to persist across restarts
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
