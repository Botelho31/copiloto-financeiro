# Architecture

Self-hosted personal budget tracker for a household. Pulls transaction history from
[Pluggy](https://docs.pluggy.ai/) (Brazilian open-finance aggregator), stores it in a
SQLite database encrypted at rest, and turns it into categorized spending, recurring
bills, debt payoff tracking, and a month-by-month cash-flow projection. Meant to run
locally or on a trusted network — there's no login/account system; instead the
database itself is locked behind a password you choose (see "Encryption & unlock"
below). The data model supports multiple household member profiles (the `users`
table), each with their own Pluggy connection and accounts, rolled up in a combined
Household view, with debts optionally shared between two people.

## Monorepo layout

A Bun workspace with three packages sharing a single lockfile.

```mermaid
flowchart LR
    subgraph repo["copiloto-financeiro (bun workspaces)"]
        shared["shared/<br>wire-format types +<br>amortization / bill-cadence math<br>(imported by both, zero deps)"]
        backend["backend/<br>Elysia server<br>API + vault/encryption + migrations + MCP tool server"]
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
    ClaudeCode["Claude Code<br>(.mcp.json, local dev tool)"]

    subgraph Server["Elysia server (backend/src/index.ts)"]
        LockGate["lock-gate<br>onBeforeHandle: isUnlocked() +<br>session cookie / X-API-Key"]
        VaultRoutes["routes/vault.ts<br>setup · unlock · lock · api-keys"]
        ApiRoutes["routes/*.ts<br>accounts · transactions · categories · tags<br>bills · debts · goals · investments<br>projections · settings · sync"]
        Static["static file serving<br>frontend/dist + /public"]
    end

    subgraph Services["domain services"]
        Sync["pluggy/sync.ts<br>upsert accounts/investments/transactions"]
        Categorization["services/categorization.ts<br>rule-based auto-categorize"]
        Projection["services/projectionEngine.ts<br>month-by-month cash flow"]
        RecurDetect["jobs/recurringDetection.ts<br>bill candidate detection"]
        TransferDetect["jobs/transferDetection.ts<br>self-transfer pairing"]
    end

    DB[("Encrypted SQLite (libSQL)<br>data/budget.sqlite (WAL)<br>only open while unlocked")]
    VaultFile[("data/vault.json<br>wrapped master key, unencrypted —<br>needed to even open DB")]
    Pluggy["Pluggy API<br>api.pluggy.ai"]
    MCP["mcp-server.ts<br>stdio MCP tool server<br>(HTTP client of this same server)"]

    Browser <-->|"HTTP/JSON + session cookie"| LockGate
    Browser --> Static
    LockGate --> VaultRoutes
    LockGate --> ApiRoutes
    VaultRoutes -.->|"reads/writes"| VaultFile
    VaultRoutes --> DB
    ApiRoutes --> DB
    ApiRoutes --> Categorization
    ApiRoutes --> Projection
    Sync -->|"OAuth-style API key + REST"| Pluggy
    Sync --> DB
    RecurDetect --> DB
    TransferDetect --> DB

    MCP -->|"HTTP/JSON + X-API-Key"| LockGate
    ClaudeCode -->|"stdio"| MCP
```

Everything runs as **one Bun process**: HTTP API, the vault's encrypted database
connection, and static file server. There's no background scheduler — see "Sync" below
for why. The MCP server (`mcp-server.ts`) is a **separate OS process**, launched on
demand by an MCP client (e.g. Claude Code, per `.mcp.json`) — but unlike before this
app encrypted its data, it never touches the database or a service function directly.
It's a plain HTTP client of this same server's `/api/*` routes, authenticated with an
API key, for one reason: only the main server process ever holds the decryption key in
memory, so locking it instantly revokes access for the browser and MCP alike, with
nothing cached anywhere to go stale. See "Encryption & unlock" below.

## Sync

```mermaid
sequenceDiagram
    participant You as You (unlock)
    participant Vault as db/index.ts
    participant Sync as jobs/dailySync.ts
    participant API as Pluggy API
    participant DB as Encrypted SQLite
    participant Jobs as recurringDetection / transferDetection

    You->>Vault: POST /api/vault/unlock
    Vault->>DB: open with the now-unwrapped key
    Note over Vault,Sync: fire-and-forget — unlocking doesn't<br/>block on however long a sync takes
    Vault->>Sync: maybeSyncOnUnlock()
    Sync->>DB: last successful sync_log row, per person
    alt any person stale (> ~20h)
        Sync->>API: authenticate (client id/secret -> cached API key)
        loop per connected Item (each person's own pluggy_item_ids)
            Sync->>API: fetch accounts, investments, transactions (cursor-paginated)
            Sync->>DB: upsert accounts / investments
            Sync->>DB: upsert transactions<br/>(auto-categorize via category_rules,<br/>preserve existing manual category)
        end
        Sync->>DB: write sync_log row (status, count)
        Sync->>Jobs: detectRecurringBills() / detectSelfTransfers()
        Jobs->>DB: bill candidates + flagged transfer pairs
    end
```

No background scheduler — a locked-by-default app that may sit closed for days doesn't
suit a cron tick (it either fires while locked and fails, or never fires at all if
nothing's running at the scheduled hour). Sync instead runs right after unlock, only if
it's actually due, reusing the exact same `triggerSync()` the manual "sync now" button
and the `trigger_sync` MCP tool call. A single in-memory `isRunning` flag prevents
overlapping syncs (an unlock-triggered sync racing a manual one). Pluggy pagination is
cursor-based, not offset-based — important because credit-card balances can
double-count if pagination assumptions are wrong (this bit the project once — see
Pluggy client for the fix).

## Encryption & unlock

The database is encrypted at rest (libSQL's `encryptionKey`, not plain `bun:sqlite`) —
the real master key (MK) is random, generated once, and never derived live from a
human secret. Your password and a separately-generated, shown-once recovery code each
independently _wrap_ that same MK (`node:crypto` scrypt + AES-256-GCM, see
`vault/crypto.ts`) — either one unlocks it, and a wrong one fails loudly via the GCM
auth tag, not a silent garbage read. Both wrapped copies live in `data/vault.json`,
which has to stay unencrypted (you need it to even open the database) and is exactly
as sensitive as the password + recovery code combined — back up the whole `data/`
directory as one unit, not just this file or just the `.sqlite`.

```mermaid
sequenceDiagram
    participant B as Browser
    participant G as lock-gate
    participant V as routes/vault.ts
    participant D as db/index.ts
    participant M as mcp-server.ts

    Note over B,D: First run
    B->>V: POST /api/vault/setup {password}
    V->>D: setupVault(password)
    D-->>V: generates MK, wraps it under<br/>password + a fresh recovery code
    V-->>B: {recoveryCode} — shown exactly once
    V->>B: Set-Cookie (httpOnly, SameSite=Strict)

    Note over B,D: Every subsequent visit
    B->>G: GET /api/...
    G->>D: isUnlocked()?
    alt locked
        G-->>B: 423
        B->>V: POST /api/vault/unlock {password} or {recoveryCode}
        V->>D: unwrap MK, open the encrypted DB
        V->>B: Set-Cookie (session)
    else unlocked, valid session cookie
        G-->>B: request proceeds
    end

    Note over M,G: MCP (separate OS process)
    M->>G: GET /api/... (X-API-Key header)
    G->>D: isUnlocked()?
    alt locked
        G-->>M: 423 — "unlock it in the browser"
    else unlocked, key hash matches api_keys
        G-->>M: request proceeds
    end
```

Two independent gates sit on top of `isUnlocked()`, not one — a global "is the vault
cryptographically open" boolean alone doesn't distinguish _your_ browser tab from
another tab or a malicious page (a real class of attack: "localhost CSRF" / DNS
rebinding), and gives MCP no principled way in without a password it can't store
anywhere safe:

- **Browser**: a random session token, `httpOnly` + `SameSite=Strict` cookie, issued
  on setup/unlock. `SameSite=Strict` means a request _initiated by another site_ never
  carries it, even to the right origin — that's what actually blocks the
  localhost-CSRF class of attack.
- **MCP**: a real, user-managed API key (`routes/vault.ts`'s `api_keys` table,
  generated from `/config`, shown once, stored **hashed** — SHA-256, not scrypt, since
  the key is already 256 bits of uniform randomness with no guessing attack to defend
  against, unlike a human password). Stable across lock/unlock cycles by design — it
  isn't rotated or revoked by locking, `isUnlocked()` is what actually gates real
  access on top of it. `mcp-server.ts` reads the raw key from `data/mcp-api-key`
  (`chmod 600`), saved there once per machine after generating it in the browser.

Locking (`POST /api/vault/lock`) closes the database connection and clears the session
cookie — both the browser and every MCP tool call lose access in the same instant,
through the same `isUnlocked()` check, with nothing cached anywhere to go stale.

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
```

- `lib/api.ts` centralizes fetch + error handling: any non-2xx response raises
  `ApiError`.
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
repo's `.claude/` setup call these tools. Each tool is a thin wrapper around a real
`fetch()` call to this same server's own `/api/*` routes (see "Encryption & unlock"
above for why it's HTTP now, not an in-process function call) — authenticated with an
API key from `data/mcp-api-key`, generated once from `/config`. If the vault is
locked, or the server isn't running, or there's no valid key on file, a tool call fails
with a specific, actionable error instead of a generic exception.

## Deployment

```mermaid
flowchart LR
    subgraph Machine["Your machine (or home server)"]
        subgraph Container["Docker container :3000 -> host port"]
            App["bun run start<br>(Elysia + built SPA)"]
        end
        Volume[("./data bind mount<br>budget.sqlite")]
        App --- Volume
    end

    You(("You<br>(LAN / localhost)")) --> Machine
    App -->|"outbound only"| PluggyAPI["Pluggy API"]
```

Single `Dockerfile` builds the whole monorepo (`bun install --frozen-lockfile` →
`bun run build`) into one image; `docker-compose.yml` runs it with `./data` (the
encrypted `.sqlite` file, `vault.json`, and `mcp-api-key` together) on a bind-mounted
volume so data survives container rebuilds. `HOST=0.0.0.0` is set inside the container
(required for Docker's port-mapping to reach it at all — `127.0.0.1` inside a
container is its own loopback, unreachable from outside it), with the **host**-side
port mapping restricted to `127.0.0.1` instead, same effective result as the bare
(non-Docker) default. The database being encrypted doesn't change the advice: this is
still built to stay on your machine or local network, not port-forwarded onto the open
internet — once unlocked, the API itself has no further per-request login, same
reasoning as always. Reach it remotely via something like Tailscale instead of exposing
the port directly.
