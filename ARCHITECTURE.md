# Architecture

Self-hosted personal budget tracker for a household. Pulls transaction history from
[Pluggy](https://docs.pluggy.ai/) (Brazilian open-finance aggregator) once a day, stores
it in SQLite, and turns it into categorized spending, recurring bills, debt payoff
tracking, and a month-by-month cash-flow projection. Login is single-admin (no
multi-tenant auth), but the data model supports multiple household member profiles
under that one login — each with their own Pluggy connection and accounts, rolled up
in a combined Household view, with debts optionally shared between two people.

## Monorepo layout

A Bun workspace with three packages sharing a single lockfile.

```mermaid
flowchart LR
    subgraph repo["copiloto-financeiro (bun workspaces)"]
        shared["shared/<br>wire-format types +<br>amortization / bill-cadence math<br>(imported by both, zero deps)"]
        backend["backend/<br>Elysia server<br>API + auth + cron + migrations + MCP tool server"]
        frontend["frontend/<br>Vite + React SPA"]
    end

    frontend -- "import type { ... } from 'shared'" --> shared
    backend -- "import type { ... } from 'shared'" --> shared
    frontend -- "fetch /api/* (dev: Vite proxy)" --> backend
```

- `bun run dev` — backend + frontend dev servers together (via `concurrently`); or
  `bun run dev:backend` (`:3000`, hot reload, migrations run on boot) and
  `bun run dev:frontend` (Vite, proxies `/api` and `/public` to the backend) separately
- `bun run build` / `bun run start` — production: Vite build served as static files by
  the same Elysia process (single container, single port)

## Runtime components

```mermaid
flowchart TB
    Browser["Browser<br>React SPA (react-router)"]

    subgraph Server["Elysia server (backend/src/index.tsx)"]
        Guard["authGuard<br>session-cookie check on every request"]
        AuthRoutes["auth/routes.tsx<br>/setup /login /logout"]
        ApiRoutes["routes/*.ts<br>accounts · transactions · categories · tags<br>bills · debts · goals · investments<br>projections · settings · sync"]
        Static["static file serving<br>frontend/dist + /public"]
        Cron["croner job<br>(dailySync.ts)"]
    end

    subgraph Services["domain services"]
        Sync["pluggy/sync.ts<br>upsert accounts/investments/transactions"]
        Categorization["services/categorization.ts<br>rule-based auto-categorize"]
        Projection["services/projectionEngine.ts<br>month-by-month cash flow"]
        RecurDetect["jobs/recurringDetection.ts<br>bill candidate detection"]
        TransferDetect["jobs/transferDetection.ts<br>self-transfer pairing"]
    end

    DB[("SQLite<br>data/budget.sqlite (WAL)")]
    Pluggy["Pluggy API<br>api.pluggy.ai"]
    MCP["mcp-server.ts<br>stdio MCP tool server<br>(same domain logic, no HTTP)"]

    Browser <-->|"HTTP/JSON, cookie session"| Guard
    Guard --> AuthRoutes
    Guard --> ApiRoutes
    Guard --> Static
    ApiRoutes --> DB
    ApiRoutes --> Categorization
    ApiRoutes --> Projection
    Cron -->|"daily, or on stale startup"| Sync
    Sync -->|"OAuth-style API key + REST"| Pluggy
    Sync --> DB
    Cron --> RecurDetect --> DB
    Cron --> TransferDetect --> DB
    MCP --> DB
    MCP -.->|"reuses"| Categorization
    MCP -.->|"reuses"| Projection

    ClaudeCode["Claude Code<br>(.mcp.json, local dev tool)"] -->|"stdio"| MCP
```

Everything runs as **one Bun process**: HTTP API, cron scheduler, and static file
server. The MCP server (`mcp-server.ts`) is a separate entry point over stdio, launched
on demand by an MCP client (e.g. Claude Code, per `.mcp.json`) — it calls the same
route/service functions the HTTP API uses, so business logic isn't duplicated.

## Auth flow

Single-admin login: no signup, no multi-tenant auth concerns. Session is a random
32-byte token in an httpOnly cookie, checked on every request by a global
`onBeforeHandle` hook. "Household member profiles" (the `users` table — see Data model
below) are a separate concept from login: they're per-person data scopes selected via
a nav dropdown once already authenticated, not separate accounts with their own
credentials.

```mermaid
sequenceDiagram
    participant B as Browser
    participant G as authGuard
    participant A as auth/routes.tsx
    participant DB as SQLite

    Note over B,DB: First run
    B->>G: GET /
    G->>A: no admin row yet
    A-->>B: redirect /setup
    B->>A: POST /setup {username, password}
    A->>DB: INSERT admin (bcrypt hash)
    A-->>B: redirect /login

    Note over B,DB: Every subsequent visit
    B->>G: GET /api/... (cookie: session_id)
    alt no/expired session
        G-->>B: 401 (api) or redirect /login (page)
        B->>A: POST /login {username, password}
        A->>DB: verifyAdmin() + rateLimit check
        A->>DB: INSERT sessions (token, expires_at +30d)
        A-->>B: Set-Cookie session_id (httpOnly, secure, sameSite=lax)
    else valid session
        G->>DB: SELECT expires_at FROM sessions
        G-->>B: request proceeds
    end
```

Login attempts are rate-limited per IP (`auth/rateLimit.ts`). Redirects always go
through `lib/redirect.ts`'s `redirectTo()` — calling Elysia's `redirect()` directly is
broken whenever a cookie is touched in the same handler chain.

## Daily sync pipeline

```mermaid
sequenceDiagram
    participant Cron as croner (CRON_SCHEDULE, default 06:00)
    participant Sync as pluggy/sync.ts
    participant API as Pluggy API
    participant DB as SQLite
    participant Jobs as recurringDetection / transferDetection

    Cron->>Sync: triggerSync("cron")
    Note over Sync: also runs once at boot if last<br/>successful sync > 24h old
    Sync->>API: authenticate (client id/secret -> cached API key)
    loop per connected Item (PLUGGY_ITEM_IDS)
        Sync->>API: fetch accounts, investments, transactions (cursor-paginated)
        Sync->>DB: upsert accounts / investments
        Sync->>DB: upsert transactions<br/>(auto-categorize via category_rules,<br/>preserve existing manual category)
    end
    Sync->>DB: write sync_log row (status, count)
    Sync-->>Cron: {transactionsUpserted}
    Cron->>Jobs: detectRecurringBills()
    Jobs->>DB: insert unconfirmed bill candidates
    Cron->>Jobs: detectSelfTransfers()
    Jobs->>DB: pair up + flag transfer transactions
```

A single in-memory `isRunning` flag prevents overlapping syncs (cron tick + manual
`POST /api/sync/run` racing). Pluggy pagination is cursor-based, not offset-based —
important because credit-card balances can double-count if pagination assumptions are
wrong (this bit the project once — see Pluggy client for the fix).

## Data model (core tables)

SQLite, sequential migrations (`backend/src/db/migrations/*.sql`), applied
automatically on boot by `db/index.ts`. Simplified ER diagram of the main entities:

```mermaid
erDiagram
    USERS ||--o{ ITEMS : owns
    USERS ||--o{ ACCOUNTS : owns
    USERS ||--o{ INVESTMENTS : owns
    USERS ||--o{ TRANSACTIONS : owns
    USERS ||--o{ BILLS : owns
    USERS ||--o{ GOALS : owns
    USERS ||--o{ DEBTS : owns
    USERS ||--o{ DEBTS : "shared_with_user_id (optional)"
    ITEMS ||--o{ ACCOUNTS : has
    ITEMS ||--o{ INVESTMENTS : has
    ACCOUNTS ||--o{ TRANSACTIONS : has
    CATEGORIES ||--o{ TRANSACTIONS : categorizes
    CATEGORIES ||--o{ CATEGORY_RULES : "auto-applies to"
    CATEGORIES ||--o{ CATEGORIES : "parent_id (subcategories)"
    TRANSACTIONS }o--o{ TAGS : "tag_transactions (m:n)"
    BILLS }o--|| CATEGORIES : "categorized as"
    BILLS }o--o| DEBTS : "pays down (debt_id)"
    DEBTS ||--o{ DEBT_TRANSACTIONS : "borrow / lend / pay_off links"
    DEBT_TRANSACTIONS }o--|| TRANSACTIONS : references
    DEBTS ||--o{ DEBTS : "linked_debts (origin sum)"
    GOALS {
        int id
        string name
        real target_amount
        string target_date
    }
    SYNC_LOG {
        int id
        string status
        int transactions_upserted
    }

    USERS {
        int id PK
        string name
        string color
        string pluggy_client_id
        string pluggy_client_secret
    }
    ITEMS {
        string id PK
        string status
    }
    ACCOUNTS {
        string id PK
        string item_id FK
        int user_id FK
        string type
        real balance
    }
    TRANSACTIONS {
        string id PK
        string account_id FK
        string date
        real amount
        string type
        int category_id FK
    }
    CATEGORIES {
        int id PK
        string name
        string kind
        int parent_id FK
        bool excludes_from_cashflow
    }
    BILLS {
        int id PK
        int user_id FK
        string cadence
        real expected_amount
        int debt_id FK
        bool is_card_expense
    }
    DEBTS {
        int id PK
        int user_id FK
        int shared_with_user_id FK
        string direction
        real interest_rate_monthly_percent
        string loan_type
    }
```

Notable modeling decisions:

- **Categories and tags stay global** (one shared taxonomy across the household) —
  every other person-owned table (`accounts`, `transactions`, `bills`, `debts`,
  `goals`, `investments`, `sync_log`, `items`) carries a `user_id`, backfilled onto a
  seeded default user (id 1) so the migration that added it needed no data migration
  script. `GET` routes accept an optional `?userId=` — omitted means "Household"
  (every person combined), not "no filter for an unscoped table."
- **A shared debt is still exactly one row.** `debts.shared_with_user_id` is a nullable
  pointer to the other household member, additive on top of the pre-existing
  `split_percentage`/`debt_links`/`debt_transactions` math — a shared debt is summed
  once in the Household rollup, not once per party.
- **Categories** exclude "Transfers" / "Savings & Investments" from cash-flow totals via
  `excludes_from_cashflow`, while still counting real money movement in breakdowns.
- **Debts** support both informal IOUs (history-inferred payment schedule) and formal
  amortizing loans (PRICE/SAC formula from `shared/src/amortization.ts`), unified behind
  one `payment_plan` shape (`loan` | `combined` | `none`) so the Debts page and the
  projection engine can never disagree about a debt's schedule.
- **Bills** carry cadence (weekly/monthly/quarterly/yearly/once) and can optionally link
  to a debt they pay down (`debt_id`) — many bills can point at one debt.

## Cash-flow projection

`services/projectionEngine.ts` walks forward month by month from the current account
balances, netting baseline income/expense against confirmed bills, active debt payment
plans (loan formula or bill/history-derived), and an optional card-spend goal override —
producing the `ProjectedMonth[]` the frontend charts and the `shortfall` flags surface.

## Frontend

```mermaid
flowchart LR
    Main["main.tsx<br>ReactDOM root, i18next init"] --> App
    App["App.tsx<br>react-router routes"] --> Layout["Layout.tsx<br>nav shell + person-scope switcher"]
    Layout --> Dashboard["/  Dashboard"]
    Layout --> Transactions["/transactions"]
    Layout --> Bills["/bills"]
    Layout --> Debts["/debts"]
    Layout --> Projections["/projections"]
    Layout --> Household["/household  combined view"]
    Layout --> Config["/config  manage people"]

    subgraph DataLayer["hooks/* (one per resource)"]
        H["useAccounts · useTransactions · useCategories<br>useBills · useDebts · useGoals · useUsers<br>useInvestments · useProjections · useTags · useSettings"]
    end

    Dashboard & Transactions & Bills & Debts & Projections & Household & Config --> DataLayer
    DataLayer -->|"apiFetch() — lib/api.ts"| Backend["Elysia /api/*"]
    DataLayer -.->|"401 -> redirect"| Login["/login"]
```

- `lib/api.ts` centralizes fetch + error handling: a 401 response hard-redirects to
  `/login` (session expired), other non-2xx responses raise `ApiError`.
- `lib/personScope.tsx` holds the globally-selected person (or `null` for Household),
  persisted to `localStorage`; every resource hook reads it and appends `?userId=` to
  its request, so switching people in the nav re-scopes the whole app at once.
- i18next with `en`/`pt` namespaced JSON locale files per feature area
  (`i18n/locales/{en,pt}/*.json`).
- No global state library — each page composes the resource hooks it needs; hooks own
  their own fetch/cache lifecycle (React Query). **Pages never call `apiFetch`,
  `useQuery`, or `useMutation` directly** — that always goes through a named hook in
  `hooks/*.ts`; a page or component that needs a form always delegates to its own
  component in `components/*.tsx` rather than defining a `<form>` inline. See
  `CONTRIBUTING.md` for the full convention.

## MCP tool server

`backend/src/mcp-server.ts` exposes the same domain operations (list/create/update
transactions, categories, bills, debts, goals; trigger sync; run categorization/
recurring-bill/self-transfer detection) as MCP tools over stdio, so an MCP client (this
project uses Claude Code, wired via `.mcp.json`) can drive the app directly — e.g. the
`add-category-rules`, `confirm-recurring-bills`, and `reconcile-debts` skills in this
repo's `.claude/` setup call these tools rather than hitting HTTP.

## Deployment

```mermaid
flowchart LR
    subgraph Home["Home server (CasaOS)"]
        subgraph Container["Docker container :3000 -> host :8080"]
            App["bun run start<br>(Elysia + built SPA)"]
        end
        Volume[("./data bind mount<br>budget.sqlite")]
        App --- Volume
    end

    subgraph Cloud["Oracle Cloud box"]
        Caddy["Caddy<br>reverse_proxy + TLS termination"]
    end

    Internet(("Internet")) -->|"HTTPS"| Caddy
    Caddy -->|"WireGuard tunnel"| Home
    Home -->|"outbound only"| PluggyAPI["Pluggy API"]
```

Single `Dockerfile` builds the whole monorepo (`bun install --frozen-lockfile` →
`bun run build`) into one image; `docker-compose.yml` runs it with the SQLite file on a
bind-mounted volume so data survives container rebuilds. The app itself is never
directly internet-facing — it sits behind a Caddy reverse proxy reached over WireGuard,
and relies on its own login + rate limiting as defense-in-depth rather than DDoS/exposure
hardening.
