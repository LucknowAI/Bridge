# Operations runbook

How Mr. Bridge is released, watched and recovered in production. Every alarm
names a section of this file. Commands run from the repository root unless a
step says otherwise. AWS names follow the Terraform stack:
`match-maker-prod-*` for production, `match-maker-staging-*` for staging.

## Service targets

The launch target is one event of **300 attendees** with up to **15
concurrent searches** and two worker tasks.

| Measure | Budget | Checked by |
| --- | --- | --- |
| Search latency, p95 | ≤ 6 s (the search time budget; reranking is skipped when time runs short) | `SearchLatencyMs` alarm, capacity check |
| Every attendee has a match list after the profiles are saved | ≤ 10 min | capacity check |
| Queue quiet (all refreshes done) | ≤ 30 min | capacity check |
| A due matching job or notification waits | ≤ 10 min | `OldestDue*` alarms |
| Model calls per attendee (profile embedding plus reranks) | ≤ 6 | capacity check, `npm run models:usage` |
| Model calls per search (query embedding; cached for a day) | ≤ 2 | capacity check |
| Attendees left without matches | 0 | capacity check |

Measured on a developer machine (local Postgres, free hash embedding, no
rerank), these are the system's own costs, without model latency:

| Size | First match lists | Queue quiet | Search p50 / p95 |
| --- | --- | --- | --- |
| 300 attendees, 60 searches, 15 at a time | 6 s | 8 s | 42 ms / 83 ms |
| 1000 attendees, 200 searches, 40 at a time | 25 s | 36 s | 102 ms / 169 ms |

Repeat the check on staging with the real providers before launch and after
any change to matching (see *Release*). It costs model calls.

```sh
npm run capacity:check -- --attendees 300 --searches 60 --concurrency 15 --workers 0 --providers configured
```

`--workers 0` lets the deployed workers do the matching; the check only
watches. With `--workers N` it runs its own workers, so stop any other
worker on that database first. Without `--providers configured` it uses a
free deterministic embedding, which measures the system and not the models.
The check deletes its throwaway event and people when it finishes.

## Release

1. **CI** runs on every pull request and again inside every deploy:
   typecheck, lint, unit tests, the migration gate, integration tests
   against real Postgres and Keycloak (a skipped test fails the job), the
   browser journey against the built app and worker, the image builds and
   `terraform validate`.
2. **Staging.** Run the *Deploy to ECS* workflow with `environment:
   staging` on the commit to release. It builds, migrates staging, rolls
   out and smoke-tests. Then sign in on staging with a real e-mail and
   Google account, walk the journey once (create an event, import, two
   attendees, match, search, intro, accept, venue question), and run the
   capacity check above.
3. **Production.** Merge to `main`, which builds and deploys that commit;
   or, to ship exactly the images staging tested, run the workflow with
   `environment: production` and `promote_tag: <staging tag>`. Promotion
   copies the images unchanged, then migrates production and rolls out.
   It needs `image_promotion_source = "match-maker-staging"` in production's
   Terraform variables.
4. The deploy waits for the services to settle, checks the new version is
   serving and its dependencies are ready, and puts the previous revisions
   back by itself if that fails.

### Migrations and rollback

Migrations run before the new code and the previous image must keep
working on the migrated schema. CI enforces it (`tools/check-migrations.ts`):
released migrations never change, and a new migration may not drop or
rename a table or column, change a column type or truncate. To remove
something, stop using it in one release and drop it in a later one, with
the line marked `-- contract: <why nothing uses it any more>`.

### Roll back a release

Run *Deploy to ECS* with `rollback_tag: <previous tag>` (the 12-character
commit prefix shown in earlier runs and in `/api/health`). It skips checks,
build and migrations and redeploys those images. Because migrations only
expand, the old code runs on the current schema. Confirm `/api/health`
reports the old version and watch the alarms for ten minutes.

Rehearse it on staging before launch: deploy a commit, roll back to the
previous tag, confirm sign-in and search still work, deploy forward again.

## Alarms

Alarms go to the SNS topic `match-maker-prod-alarms` (`alarm_email` in the
Terraform variables subscribes an address). The dashboard
`match-maker-prod` shows search latency, queue waits and sizes, failures,
model call failures and web response time.

### Site down (`web-no-healthy-hosts`, `alb-5xx`, `alb-p95-latency`)

1. ECS console → `match-maker-prod-web` → *Events* and stopped tasks: a
   failing health check, an out-of-memory stop or a configuration error
   (the app refuses to start on bad configuration and logs every problem).
2. If it began with a release, roll back (above).
3. If the database is the cause (`/api/health/ready` reports it), see the
   database alarms.

### Keycloak down (`keycloak-no-healthy-hosts`)

Nobody can sign in (code sign-in also registers the person in Keycloak);
people already signed in carry on. Check the `match-maker-prod-keycloak`
service events and its logs in `/ecs/match-maker-prod/keycloak`; its
database login is in the `identity` secret.

### Worker down (`worker-down`)

No heartbeat means matching and notifications have stopped. Check the
`match-maker-prod-worker` service: a crash loop shows in its stopped tasks
and `/ecs/match-maker-prod/worker`. Queued work is durable; when the worker
returns it continues, and jobs held by a dead worker are reclaimed once
their lease ends (5 minutes).

### Matching backlog (`matching-backlog`)

Work is arriving faster than one worker handles it, or jobs are slow
because a model provider is slow. Check `ModelCallLatencyMs` and the model
failure alarm. To add capacity, raise `worker_desired_count` and apply, or
scale the service in the ECS console for the event day. Workers share the
queue safely.

### Failed jobs (`jobs-failed`)

A job failed five times. Run `npm run jobs:failed` against production (see
*Running tools against production*) to see each error. Fix the cause, then
`npm run jobs:retry -- all`.

### Notifications stuck (`notification-backlog`, `notifications-failed`)

Usually e-mail delivery. Check the worker log for `[worker:notify]` errors
and the Resend dashboard (key revoked, domain unverified, quota). Failed
notifications keep their last error in `notification_outbox`; once fixed,
set them back with
`update notification_outbox set status = 'pending', attempts = 0, available_at = now() where status = 'failed'`.
Each is sent at most once per subject, so retrying cannot duplicate.

### Slow search (`search-slow`, `search-failing`)

Search waits at most 2.5 s for the query embedding and skips reranking
when time runs short, so sustained slowness is usually the database. Check
RDS CPU and connections, then the model failure alarm, then errors in
`/ecs/match-maker-prod/web`.

### Model provider failing (`model-failures`)

Over 20% of Gemini calls fail. Matching keeps working on fallbacks: lexical
search, scored order with generated reasons. `npm run models:usage` shows
failures by operation. Common causes are an expired or revoked key (rotate
it, below) or an exhausted quota (raise it in Google AI Studio). The
gateway's circuit breaker stops calling a failing provider for 30 s at a
time.

### Database (`rds-cpu`, `rds-free-storage`, `rds-connections`)

CPU: look for a runaway query in Performance Insights; the worker can be
scaled down to shed load. Storage: raise `db_max_allocated_storage` (storage
grows by itself up to it) and apply. Connections: each task opens at most 10; a climb
without more tasks points at a leak in a recent release, so roll back.

### Login e-mail failures (`login-email-failures`)

People cannot sign in by code. Check the Resend dashboard and the
`RESEND_API_KEY` secret; rotate the key if needed (below).

### Web at maximum capacity (`web-at-max-capacity`)

Raise `web_max_capacity` and apply; check the database can take the extra
connections (10 per task).

## Restore the database

RDS keeps automated backups for `db_backup_retention_days` days and allows
point-in-time restore to any second in that window.

1. Restore to a **new** instance; never overwrite the live one:
   ```sh
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier match-maker-prod-postgres \
     --target-db-instance-identifier match-maker-prod-restore-$(date +%Y%m%d%H%M) \
     --restore-time 2026-10-19T09:30:00Z \
     --db-subnet-group-name match-maker-prod-db-subnet-group --vpc-security-group-ids <db security group> \
     --db-parameter-group-name match-maker-prod-pg16 \
     --no-publicly-accessible
   aws rds wait db-instance-available --db-instance-identifier <that name>
   ```
2. Verify it from a task or host inside the VPC (the database is private):
   ```sh
   npm run db:verify -- --url "postgres://<admin>:<password>@<restored endpoint>:5432/matchmaker" --compare "$DATABASE_URL"
   ```
   It checks pgvector, that every migration of this release is applied
   unchanged, the core tables, and lists row count differences against the
   live database.
3. To switch over, stop the worker (desired count 0), point the
   `DATABASE_URL` values in the `app` and `migrate` secrets at the restored
   endpoint, run the migrate task (it also sets the runtime login's
   password), force a new deployment of web and worker, and confirm
   `/api/health/ready`. Keep the old instance until the restored one has
   served a day.
4. For data recovery only (one deleted event, for example), copy the rows
   from the restored instance instead of switching over.

Rehearse before launch: restore staging to a time a few minutes ago and run
steps 1–2. Locally, `npm run db:restore-rehearsal` dumps the compose
database, restores it into a scratch database, verifies it and removes it,
timing each step.

Targets: data loss at most 5 minutes (RDS uploads transaction logs every 5
minutes); a restore and switch-over within 1 hour.

## Rotate secrets

All runtime secrets live in Secrets Manager (`match-maker-prod/app`,
`/identity`, `/migrate`). ECS reads them when a task starts, so every
rotation ends with a new deployment:

```sh
aws ecs update-service --cluster match-maker-prod-cluster --service match-maker-prod-web --force-new-deployment
aws ecs update-service --cluster match-maker-prod-cluster --service match-maker-prod-worker --force-new-deployment
```

| Secret | How | Effect |
| --- | --- | --- |
| Session secret | `terraform apply -replace=random_password.session_secret_b -var session_secret_active=b`, then redeploy web. Next time replace `random_password.session_secret` and set `a`. | Nobody is signed out: cookies sealed with the old secret are still read (`SESSION_SECRET_PREVIOUS`) until they expire (7 days). Do not rotate again within those 7 days. |
| OTP pepper | `terraform apply -replace=random_password.otp_pepper`, redeploy web. | Codes e-mailed in the last 10 minutes stop working; people request a new one. |
| Database runtime password | `terraform apply -replace=random_password.db_runtime`, run the migrate task (sets the new password), redeploy web and worker. | Old tasks keep their open connections until replaced. |
| Keycloak client secret | `terraform apply -replace=random_password.keycloak_client_secret`, then `npm run keycloak:sync` against production Keycloak from an address in `keycloak_admin_cidrs`, then redeploy web. | Google sign-in fails between the apply and the sync; do it in a quiet hour. |
| Gemini, Resend, Upstash, Google keys | Create the new key at the provider, update the value in `match-maker-prod/app` (and `/identity` for Google), redeploy, then revoke the old key. | None if the old key is revoked last. |

## Running tools against production

The database is private, so tools run as one-off ECS tasks in the private
subnets with the command overridden:

- `jobs:failed`, `jobs:retry`, `models:usage`, `db:verify`: the migrate task
  definition (it has the database secrets), e.g. command
  `npx tsx tools/manage-jobs.ts failed`.
- `account:*` and `keycloak:sync`: the worker task definition (it also has
  the auth package), adding `KEYCLOAK_INTERNAL_ISSUER`, `KEYCLOAK_ADMIN` and
  `KEYCLOAK_ADMIN_PASSWORD` (from the `identity` secret) to the overrides.

## Accounts and data requests

- Block a person everywhere: `npm run account:disable -- <email>`
  (`account:enable` undoes it); sign out everywhere only:
  `npm run account:revoke-sessions -- <email>`.
- Erase a person: `npm run account:erase -- <email> --yes`. This deletes
  their profiles, matches, introductions, cached explanations and Keycloak
  user, and records it in the audit log.

## Launch checklist

- [ ] Production Terraform applied with the domain, certificate, `alarm_email`,
      `keycloak_admin_cidrs` and `image_promotion_source`; SNS e-mail confirmed.
- [ ] Real secrets filled in: Gemini, Resend (sending domain verified), Google
      OAuth client (redirect URI on the Keycloak domain), Upstash if used.
- [ ] `npm run keycloak:sync` run once against production Keycloak.
- [ ] GitHub environments `production` and `staging` hold their AWS role,
      subnets, security group and `APP_BASE_URL`; `staging` has
      `STACK_NAME=match-maker-staging`.
- [ ] Staging journey walked with real e-mail and Google sign-in.
- [ ] Capacity check passed on staging with `--providers configured` at the
      launch size.
- [ ] Rollback rehearsed on staging.
- [ ] Database restore rehearsed on staging and `db:verify` passed.
- [ ] Every alarm in this file seen once in the console, and the dashboard opened.
- [ ] Organizer accounts created (`npm run org:init`) and the first event set up.
