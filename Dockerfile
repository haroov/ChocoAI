FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY backend/dist ./dist
COPY backend/prisma ./prisma
COPY backend/package*.json ./

RUN npm install
RUN npx prisma generate

# Install wget for health checks
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
