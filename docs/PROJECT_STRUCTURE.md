# Mr. Bridge project structure

This repository is an npm-workspace monorepo. The application keeps the existing hexagonal architecture: the domain owns business rules, application use cases depend on ports, infrastructure implements those ports, and the Next.js app is the delivery layer. Docker and AWS deployment wrap this structure without moving those boundaries.

## Repository map

```text
.
├── apps/web/                         # Next.js delivery app and core layers
│   ├── app/                           # Pages, route handlers, server actions
│   └── src/
│       ├── domain/                    # Participant, connection, matching rules
│       ├── application/
│       │   ├── ports/                 # Repository/provider/cache interfaces
│       │   └── use-cases/             # Event, participant, matching, intro flows
│       ├── infrastructure/            # PostgreSQL, providers, cache, e-mail
│       ├── composition/               # Port-to-adapter dependency injection
│       └── lib/                       # Auth and spreadsheet import helpers
├── packages/
│   ├── auth/                          # Keycloak OIDC and login challenges
│   ├── db/                            # PostgreSQL client, migrations, seed, jobs
│   │   ├── migrations/                # Versioned SQL schema changes
│   │   ├── src/repositories/          # Shared event, attendee, job repositories
│   │   └── workers/                   # Embedding and matching queue consumers
│   └── email/                         # Login e-mail client and templates
├── infra/
│   ├── docker/                        # Migration, worker, and Keycloak images
│   ├── postgres/init/                 # Local Keycloak database initialization
│   └── terraform/                     # ECS, RDS, network, secrets, monitoring
├── keycloak/                          # Realm import configuration
├── tools/                             # Wait, bootstrap, and roster import CLIs
├── docs/                              # Product flows and architecture references
└── docker-compose.yml                 # Local end-to-end service topology
```

## Architecture boundaries

| Layer | Location | Responsibility |
|---|---|---|
| Delivery | `apps/web/app` | Next.js pages, route handlers, and server actions. Actions call use cases. |
| Domain | `apps/web/src/domain` | Framework-free entities, matching rules, specifications, and pipeline stages. |
| Application | `apps/web/src/application` | Use cases and ports for persistence, embeddings, language models, notifications, and cache. |
| Infrastructure | `apps/web/src/infrastructure` | PostgreSQL adapters, Gemini/local BGE providers, Redis/PostgreSQL cache adapters, and e-mail notifications. |
| Composition | `apps/web/src/composition` | Constructs adapters and injects them into use cases and the matching pipeline. |
| Shared packages | `packages/*` | Authentication, database migrations/repositories/workers, and e-mail services. |
| Operations | `infra`, `docker-compose.yml` | Container topology and AWS infrastructure; these do not own product rules. |

Dependency direction remains `app → application → domain`; infrastructure implements application ports and is connected through composition. The matching pipeline is `retrieve → intent filter → score → top K → LLM rerank → persist`. The participant search flow reuses the pipeline and returns ranked results directly.

## Runtime topology

Docker Compose starts PostgreSQL with pgvector, Keycloak, a one-shot migration/seed container, the Next.js web container, and an asynchronous worker. Profile changes enqueue embedding and matching jobs in PostgreSQL. The worker drains those jobs so model calls and match computation stay off the request path. In production, Terraform deploys the same web, migration, and worker images to ECS with RDS PostgreSQL.

Upstash Redis can provide the shared retrieval cache when configured. The PostgreSQL cache adapter keeps local Compose self-contained when Redis credentials are absent. Both choices sit behind the same candidate-cache port.

## Product routes

- Participants enter through `/e/[eventSlug]`, complete `/profile`, then use `/matches`, `/search`, and `/connections`.
- Organizers use `/orgs/[orgSlug]/events` to create events and open the event dashboard, roster import, matching, and analytics pages.
- Event membership is checked before a rostered participant can claim an account. Intro contact details are revealed after acceptance.

See [the end-to-end flow](END_TO_END_FLOW.md) and [the matching pipeline](BRIDGE_ENGINE_PIPELINE.md) for the full journeys.
