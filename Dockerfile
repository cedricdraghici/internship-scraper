# Node 24+ is required: the project uses the built-in node:sqlite module.
FROM node:26-slim

WORKDIR /app

# Install deps first so this layer caches across code changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# The Fly volume mounts here — jobs.db and the response cache live on it, so your
# status tracking survives redeploys.
ENV JT_DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

# Runs the scheduler, which serves the dashboard and scrapes on an interval.
CMD ["npx", "tsx", "src/serve.ts"]
