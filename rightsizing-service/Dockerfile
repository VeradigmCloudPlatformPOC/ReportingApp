# VM Right-Sizing Recommendation Service (App 4)
# Part of VMPerf microservices architecture

FROM node:20-alpine

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY src/ ./src/

# Security: Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Environment variables (no secrets - use Key Vault)
ENV PORT=3004
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3004/health || exit 1

# Expose port
EXPOSE 3004

# Start the service
CMD ["node", "src/index.js"]
