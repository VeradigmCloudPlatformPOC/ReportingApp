# VM Performance Slack Bot - Dockerfile
# Multi-stage build for smaller image size

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Production stage
FROM node:20-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Set environment
ENV NODE_ENV=production
ENV PORT=3978

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3978/health || exit 1

# Expose port
EXPOSE 3978

# Start the bot
CMD ["node", "src/index.js"]
