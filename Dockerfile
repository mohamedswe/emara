FROM node:22-slim AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci \
    && npm prune --omit=dev \
    && npm cache clean --force

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY bin ./bin
COPY src ./src

RUN chmod +x /app/bin/auditor.mjs /app/bin/docker-entrypoint.sh \
    && ln -s /app/bin/auditor.mjs /usr/local/bin/auditor \
    && mkdir -p /output \
    && chown node:node /output

# Analyze untrusted repositories as the image's unprivileged user (UID 1000).
# /app stays root-owned, so the auditor process cannot modify its own code.
USER node
# Default output (./emara-output) lands in the mounted /output volume.
WORKDIR /output

ENTRYPOINT ["/app/bin/docker-entrypoint.sh"]
