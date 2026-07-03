# DiALERT

**DiALERT** manages FreePBX ring-group chains for one or more *phone systems* from a single web UI. For each system it periodically pulls an on-call schedule from a configurable API and rewrites a chain of FreePBX ring groups so that unanswered calls escalate from one tier to the next, finally landing on a configurable destination (terminate, another ring group, an extension, voicemail, or an external number).

Originally a headless cron job for [RPI Ambulance](https://rpiambulance.com), v2 is a single-user Next.js app with a page per system, manual controls, dry-run previews, an audit log, and push triggers.

## Stack

- **Next.js** (App Router, TypeScript) + **Tailwind CSS**
- **Prisma** + **PostgreSQL** (Postgres runs as a separate service; the app only needs `DATABASE_URL`)
- A standalone **worker** process (node-cron) that polls each system on its own schedule
- Single-user auth via a password in an env var and a signed session cookie

## How it works

Each **System** stores:

- a **scheduling API** URL, auth header name, and token (encrypted at rest);
- **ring-group** settings: numeric prefix (tiers become `PREFIX1`, `PREFIX2`, …), strategy, ring times, caller ID, description template;
- a **no-answer destination** for the final tier;
- a **cron** poll schedule + timezone.

On each poll (or manual apply / push), DiALERT fetches the schedule, and if the content changed (detected via a hash) it builds one FreePBX ring group per priority tier — each tier's no-answer destination points at the next tier, and the last tier goes to the configured final destination — then applies them over the FreePBX GraphQL API and reloads the PBX.

All systems currently share one FreePBX; its OAuth2/GraphQL credentials come from env vars. Per-system PBX overrides exist in the schema for future multi-PBX support.

## Local development

1. Start Postgres (or use your own) and copy env:

   ```bash
   docker compose -f docker-compose.local.yml up -d
   cp .env.example .env   # then edit values
   ```

   Generate secrets:

   ```bash
   openssl rand -base64 48   # SESSION_SECRET
   openssl rand -base64 32   # ENCRYPTION_KEY
   ```

2. Install, migrate, and run:

   ```bash
   npm install
   npm run migrate:dev      # applies prisma/migrations to your DATABASE_URL
   npm run dev              # web UI at http://localhost:3000
   npm run worker           # in a second terminal: the poller
   ```

3. Sign in with `APP_PASSWORD`, add a system, and use **Preview** to dry-run before enabling.

## Environment variables

All app config is read by **both** the web app and the worker.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (separate container/service) |
| `APP_PASSWORD` | yes | Single-user UI login password |
| `SESSION_SECRET` | yes | Signs session cookies (`openssl rand -base64 48`) |
| `ENCRYPTION_KEY` | yes | 32-byte hex/base64 key encrypting secrets in Postgres |
| `FREEPBX_API_URL` | yes | FreePBX API base (token host) |
| `FREEPBX_GQL_URL` | yes | FreePBX GraphQL endpoint |
| `FREEPBX_CLIENT_ID` / `FREEPBX_CLIENT_SECRET` | yes | FreePBX API client credentials |
| `FREEPBX_SCOPE` | no | Defaults to `gql:ringgroups gql:framework` |
| `ERROR_EMAIL_ADDRESS`, `SMTP_*` | no | Error notifications; if unset, errors are logged/stored only |
| `TZ` | no | Default display timezone |

See [.env.example](.env.example).

## Push trigger (optional)

Instead of waiting for the poll, a scheduling system can push changes instantly. Each system page shows a `curl` example:

```bash
curl -X POST https://your-app-host/api/systems/<id>/trigger \
  -H "Authorization: Bearer <per-system-token>"
```

## Deploying

The app is deployed as a Docker image on [Coolify](https://coolify.io), with Postgres as a separate service. Deploys are run **locally** from your machine — there is no CI.

- [docker-compose.yml](docker-compose.yml) defines the `web` and `worker` services from the GHCR image. `web` runs `prisma migrate deploy` on start.
- `scripts/deploy.sh` builds the image for `linux/amd64` (the Coolify host's architecture), pushes to GHCR, and triggers a Coolify redeploy. Its secrets live only in `scripts/deploy.env` (gitignored — never read by the running app):

  ```bash
  cp scripts/deploy.env.example scripts/deploy.env   # fill in GHCR + Coolify creds
  npm run deploy                                      # build + push + deploy
  ./scripts/deploy.sh --no-deploy                     # build + push only
  ```

  The build platform defaults to `linux/amd64`; override with `PLATFORM=… npm run deploy` if needed.

## License

MIT.
