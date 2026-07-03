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

RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

# The entrypoint runs `prisma migrate deploy` (unless RUN_MIGRATIONS=false),
# then execs the command below. This ensures the DB is initialized however the
# image is started. The worker service overrides the command.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
