# Single image used for both the web app and the worker (command is overridden
# per service in docker-compose). Includes full dependencies so the worker can
# run via tsx and `prisma migrate deploy` is available at container start.
FROM node:22-alpine

# Prisma needs OpenSSL at runtime on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Generate the Prisma client and build the Next.js app.
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Default command runs the web server; the worker service overrides this.
CMD ["npm", "run", "start"]
