# DiALERT

**DiALERT** manages FreePBX ring-group chains for one or more *phone systems* from a single web UI. For each system it periodically pulls an on-call schedule from a configurable API and rewrites a chain of FreePBX ring groups so that unanswered calls escalate from one tier to the next, finally landing on a configurable destination.

Originally a headless cron job for [RPI Ambulance](https://rpiambulance.com), it is now a single-user Next.js app with a page per system, manual controls, dry-run previews, an audit log, and push triggers.

## Features

- **Multiple systems, one page each.** Manage many independent ring-group chains on a shared FreePBX from one dashboard.
- **Configurable scheduling source per system.** Each system pulls its on-call roster from its own API URL, with a configurable auth header name and token (encrypted at rest).
- **Escalation chain from the schedule.** Each priority tier becomes a ring group that, on no answer, rings the next tier; the last tier goes to the system's configured final destination.
- **Configurable no-answer destination.** Terminate (hangup / busy / congestion / ring), another ring group, an extension, a voicemail box, or an external number.
- **Stable tier numbering (optional).** "Maintain structure" numbers ring groups by tier priority (priority 2 → `<prefix>2`) and skips empty tiers instead of collapsing them, so numbering other FreePBX routes depend on stays consistent.
- **Per-tier ring time overrides (optional).** Override the ring time for specific tier numbers; others fall back to the single/chained defaults.
- **Automatic polling + manual control.** A background scheduler polls each enabled system on its own cron schedule; the UI adds **Apply now**, **Poll now**, and a **Preview** dry run that shows the resulting chain without touching the PBX.
- **Push trigger.** A per-system token-authenticated endpoint lets the scheduling system push changes instantly instead of waiting for the poll.
- **Change detection.** A schedule hash means unchanged rosters are skipped; manual **Apply now** forces a re-push.
- **Enable/disable per system.** Pause polling without deleting a system.
- **Audit log.** Every apply (cron / manual / push) is recorded with status and message and shown on the system page.
- **Error notifications.** Failures are stored, surfaced in the UI, and optionally emailed (with a cooldown).
- **Single-user auth.** One password in an env var, a signed session cookie, and reverse-proxy-aware redirects.

## Stack

- **Next.js** (App Router, TypeScript) + **Tailwind CSS**
- **Prisma** + **PostgreSQL** (Postgres runs as a separate service; the app only needs `DATABASE_URL`)
- **node-cron** scheduler that runs in-process alongside the web server
- Secrets (schedule tokens, push tokens) encrypted at rest with AES-256-GCM

## How it works

Each **System** stores:

- a **scheduling API** URL, auth header name, and token (encrypted);
- **ring-group** settings: numeric prefix, ring strategy, single/chained ring times, optional per-tier ring time overrides, caller ID, description template;
- a **numbering mode** (sequential, or by-priority when "maintain structure" is on);
- a **no-answer destination** for the final tier;
- a **cron** poll schedule + timezone; and an enabled/disabled flag.

On each poll (or manual apply / push), DiALERT fetches the schedule and normalizes it into priority-ordered tiers. If the content changed (detected via a hash — unless forced), it builds one FreePBX ring group per **populated** tier:

- **Tiers with no members are skipped** and left untouched on the PBX (a schedule must have at least one populated tier).
- **Numbering** is sequential by default (`<prefix>1`, `<prefix>2`, …, collapsing when tiers are empty), or by tier priority when *maintain structure* is on (`<prefix><priority>`, so priority 1 chains straight to priority 3 when 2 is empty).
- **Ring time** per tier comes from its override if set, otherwise the single-tier or chained default.
- Each tier's **no-answer** destination points at the next populated tier; the last tier goes to the configured final destination.

It then applies the ring groups over the FreePBX GraphQL API and reloads the PBX.

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
   npm run worker           # in a second terminal: the poller (see note below)
   ```

   > In production the poller runs automatically inside the container. Under
   > `next dev` it does not, so run `npm run worker` alongside it to test polling.

3. Sign in with `APP_PASSWORD`, add a system, and use **Preview** to dry-run before enabling.

## Environment variables

All app config is read by the web server (and the poller, which runs in the same container).

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (separate container/service) |
| `APP_PASSWORD` | yes | Single-user UI login password |
| `SESSION_SECRET` | yes | Signs session cookies (`openssl rand -base64 48`) |
| `ENCRYPTION_KEY` | yes | 32-byte hex/base64 key encrypting secrets in Postgres (`openssl rand -base64 32`) |
| `FREEPBX_API_URL` | yes | FreePBX API base (also the OAuth token host) |
| `FREEPBX_CLIENT_ID` / `FREEPBX_CLIENT_SECRET` | yes | FreePBX API client credentials |
| `FREEPBX_GQL_URL` | no | FreePBX GraphQL endpoint; defaults to `<FREEPBX_API_URL>/gql` |
| `FREEPBX_SCOPE` | no | Defaults to `gql:ringgroups gql:framework` |
| `ERROR_EMAIL_ADDRESS`, `SMTP_*` | no | Error notifications; if unset, errors are logged/stored only |
| `TZ` | no | Default display timezone |
| `RUN_SCHEDULER` | no | Set `false` to disable the in-container poller (e.g. running a dedicated worker) |
| `RUN_MIGRATIONS` | no | Set `false` to skip `prisma migrate deploy` on container start |

See [.env.example](.env.example).

## Push trigger

Instead of waiting for the poll, a scheduling system can push changes instantly. Each system page shows a ready-to-use `curl` example with the system's token:

```bash
curl -X POST https://your-app-host/api/systems/<id>/trigger \
  -H "Authorization: Bearer <per-system-token>"
```

The token can be regenerated from the system page.

## Deploying

The app is deployed as a single Docker image on [Coolify](https://coolify.io), with Postgres as a separate service. Deploys are run **locally** from your machine — there is no CI.

- **One container does everything.** The image [entrypoint](docker-entrypoint.sh) runs `prisma migrate deploy`, starts the polling scheduler in the background, then launches the web server. So a plain "Docker Image" deploy on Coolify migrates and polls on its own — no separate worker needed. ([docker-compose.yml](docker-compose.yml) is provided for compose-based deploys and includes a commented-out dedicated `worker` service.)
- **Postgres is external**, reached via `DATABASE_URL`. The database must already exist; migrations create the tables.
- **`scripts/deploy.sh`** builds the image for `linux/amd64` (the Coolify host's architecture), pushes to GHCR, and triggers a Coolify redeploy. Its secrets live only in `scripts/deploy.env` (gitignored — never read by the running app). Log in to GHCR once first:

  ```bash
  echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin
  cp scripts/deploy.env.example scripts/deploy.env   # fill in Coolify creds
  npm run deploy                                      # build + push + deploy
  ./scripts/deploy.sh --no-deploy                     # build + push only
  ```

  The build platform defaults to `linux/amd64`; override with `PLATFORM=… npm run deploy` if needed.

## License

MIT.
