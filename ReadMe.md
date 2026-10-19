# Mr. Bridge

Mr. Bridge is a multi event networking and matchmaking app. Organizers create events, import attendee rosters, configure intents and venue zones, and open registration. Attendees claim an invited roster entry, complete a profile, discover ranked matches, and request introductions. Contact details appear only after the other attendee accepts.

The implementation follows the architecture described in [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md). The [end-to-end flow](docs/END_TO_END_FLOW.md) and [matching pipeline](docs/BRIDGE_ENGINE_PIPELINE.md) docs show the product journeys.

See the [production roadmap](docs/PRODUCTION_ROADMAP.md) for authentication findings, the invited-account signup policy, Google setup, and remaining work ordered by implementation effort.

## Architecture

| Area | Responsibility |
| --- | --- |
| `apps/web/app` | Next.js pages, route handlers, and server actions |
| `apps/web/src/domain` | Participant, intent, connection, and matching rules |
| `apps/web/src/application` | Use cases and ports |
| `apps/web/src/infrastructure` | PostgreSQL repositories, Gemini/BGE providers, notifications, and rate limiting |
| `apps/web/src/composition` | Binds ports to adapters |
| `packages/db` | PostgreSQL pool, migrations, repositories, demo seed, and async job queue |
| `packages/auth`, `packages/email` | Keycloak/OIDC and passwordless e-mail services |
| `infra/docker` | Web, migration, and queue-worker images |
| `infra/terraform` | AWS ECS, RDS, networking, and monitoring |

The Next.js app, shared packages, migrations, and worker run from one npm workspace. Docker builds use the repository root as their context so workspace packages are available to each image.

## Run the local stack

Requirements: Node.js 22 (see `.nvmrc`; CI and every image use 22), npm, and Docker Compose. All commands below work in PowerShell and in bash.

1. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
2. Set `SESSION_SECRET` to a random value of at least 32 characters. In PowerShell:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
   ```

3. Start the app and its dependencies:

   ```bash
   npm run docker:up
   ```

Compose starts the Next.js app, Keycloak, PostgreSQL with pgvector, a one-shot migration/demo-seed task, and the embedding/matching worker. The app is at `http://localhost:3000`; Keycloak is at `http://localhost:8080`.

The demo event is `http://localhost:3000/e/demo`. The organizer dashboard is `http://localhost:3000/orgs/ai-community-lucknow/events/demo`.

Demo attendee accounts are already on the seeded roster. Use a listed attendee's phone number, such as `+919876543210`, and enter the e-mail code. With no `RESEND_API_KEY`, local e-mail delivery is printed in the web logs:

```bash
docker compose logs -f web
```

The organizer account is `organizer@example.com` / `+919876543209`. Google sign-in requires Google OAuth credentials in `.env`; e-mail-code sign-in works without them. Gemini is optional for local use; without `GEMINI_API_KEY`, the app uses its built-in profile and intent scoring.

```bash
npm run docker:logs
npm run docker:down
```

`docker compose down` keeps the PostgreSQL volume. The schema and demo roster are re-applied safely when the stack starts again.

## Local development without Docker

Run the app and worker on the host while Compose provides only PostgreSQL and Keycloak. Every host command reads the root `.env`: `next.config.mjs` loads it for the web app, and the migration, seed, import, and worker scripts load it themselves. Values already set in the environment take precedence.

```powershell
npm install
docker compose up -d postgres keycloak
npm run db:migrate
npm run db:seed
npm run dev       # web app on http://localhost:3000 (set PORT to change it)
npm run worker    # embedding and matching queue, in a second terminal
```

The web app and worker validate their settings when they start. A missing or malformed value stops the process with a list of every problem, for example:

```text
Invalid web configuration:
  - SESSION_SECRET is required but not set.
  - KEYCLOAK_CLIENT_SECRET is required but not set.
```

## Organizer and roster setup

Organizers can create an event from `/orgs/<organization-slug>/events/new`, import `.xlsx` or `.xls` attendee rosters from the event's Roster page, configure profile intents and venue zones, and start matching from the Matching page.

For a new production database, first import the attendee identities, create the organization and its first event, then associate the roster with that event:

```bash
npm run db:import -- attendees.xlsx --no-event
npm run org:init -- "AI Community" ai-community organizer@example.com "Summer Meetup" summer-meetup
npm run db:import -- attendees.xlsx summer-meetup
```

The first command imports the global attendee directory so the organizer account exists. The bootstrap command grants that account organization and event owner access. The last command attaches imported attendees to the event. These commands use `DATABASE_URL` from `.env`.

## Workspace commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Next.js app in development |
| `npm run worker` | Run the embedding and matching queue worker on the host |
| `npm run build` | Build workspace packages and the app |
| `npm run typecheck` | Type-check all workspaces |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit and integration suites. Integration suites skip without Postgres/Keycloak; set `REQUIRE_SERVICES=db,keycloak` to fail instead (CI does, and `tools/check-test-report.ts` fails on any skipped test). Stop a locally running worker first, or it claims the pipeline test's jobs |
| `npm run test:e2e` | Browser acceptance suite (Playwright) against a running app and worker started with `EMAIL_DEV_FALLBACK=true`; set `E2E_BASE_URL` and `E2E_WEB_LOG` (the app's output, where login codes are read) |
| `npm run db:migrate` | Apply pending PostgreSQL migrations |
| `npm run db:seed` | Upsert demo roster, organization, event, and organizer |
| `npm run db:import -- <file> [event-slug]` | Import attendee rows and optionally attach them to an event |
| `npm run keycloak:wait` | Wait for the configured Keycloak realm to respond |
| `npm run keycloak:sync` | Bring an existing realm up to date: client secret, Google credentials, the account-linking flow (Google joins an account an e-mail code created), and the site login theme. Run after the first Keycloak start and after upgrades |
| `npm run account:disable -- <email>` | Block sign-in and end every session (database and Keycloak); `account:enable` undoes it |
| `npm run account:revoke-sessions -- <email>` | Sign the person out everywhere without disabling the account |
| `npm run jobs:failed` | List background matching jobs that failed after every retry, with their last error |
| `npm run jobs:retry -- <id\|all>` | Queue failed jobs again with fresh attempts |
| `npm run account:erase -- <email> --yes` | Deletion request: delete the person, their event profiles, matches, introductions, cached explanations and Keycloak user (recorded in the audit log) |
| `npm run docker:up` | Build images and start the local Compose stack |

`DATABASE_URL` should point at `localhost` for commands run on the host. Compose sets the service hostname `postgres` inside containers.

## Environment variables

See `.env.example` for the full list. The main settings are:

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Encrypts application session cookies; required |
| `DATABASE_URL` | PostgreSQL connection string |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | OIDC configuration |
| `RESEND_API_KEY` | Sends passwordless e-mail; local fallback logs codes when unset |
| `GEMINI_API_KEY` | Enables Gemini profile embeddings and LLM reranking |
| `DEFAULT_EVENT_SLUG` | Event used by the `/` redirect |
| `SEED_ON_MIGRATE` | Seeds demo data in the local stack; leave false in production |

## Activating real e-mail and Google sign-in

Locally, login codes are printed to the web log (`EMAIL_DEV_FALLBACK=true`) and the Google option is hidden. To switch on the real services:

1. **E-mail:** verify a sending domain in [Resend](https://resend.com), then set `RESEND_API_KEY` and `EMAIL_FROM` (for example `Mr. Bridge <login@your-domain>`). Set `EMAIL_DEV_FALLBACK=false` to prove delivery works.
2. **Google:** create an OAuth web client in Google Cloud Console with the authorised redirect URI `http://localhost:8080/realms/match-maker/broker/google/endpoint` (use your Keycloak host in other environments). Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Apply the credentials to the running realm and restart the web app:

   ```powershell
   npm run keycloak:sync
   ```

   Keycloak imports `realm-export.json` only on first boot, so editing `.env` alone does not update an existing realm.

In AWS, put the same values in the app's Secrets Manager secret (see `terraform output`). The web app refuses to start without `RESEND_API_KEY`, and the deploy workflow rejects a web task that enables `EMAIL_DEV_FALLBACK` or lacks the Resend secret.

## Docker and deployment

Build from the repository root:

```bash
docker build -f apps/web/Dockerfile .
docker build -f infra/docker/migrate.Dockerfile .
docker build -f infra/docker/worker.Dockerfile .
```

The GitHub workflows type-check the workspace, build the container images, apply database migrations, and deploy the web and worker services to ECS. Terraform configuration is under `infra/terraform`; deployment secrets are injected through AWS Secrets Manager.

## License

MIT. See [LICENSE](LICENSE).
