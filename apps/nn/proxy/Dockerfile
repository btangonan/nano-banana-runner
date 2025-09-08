FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm build

# Create non-root user
RUN groupadd -r nn && \
    useradd -r -g nn -s /bin/false nn && \
    chown -R nn:nn /app

USER nn

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8787/healthz || exit 1

# Environment defaults
ENV NODE_ENV=production
ENV PORT=8787
ENV BIND_HOST=0.0.0.0

EXPOSE 8787

CMD ["node", "dist/server.js"]