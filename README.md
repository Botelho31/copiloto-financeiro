# Copiloto Financeiro

🇧🇷 [Leia em português](README.pt-BR.md)

Self-hosted personal finance copilot, built for Brazil. Pulls bank transaction history
daily from [Pluggy](https://docs.pluggy.ai/) (Open Finance Brasil), stores it in SQLite,
and answers: how much am I spending, will I be able to meet upcoming costs, and if not,
what do I need to adjust. Supports a whole household — each person keeps their own bank
connection and data, and debts can be explicitly shared between people.

A Bun-workspace monorepo: `backend/` is the Elysia server (API + auth + cron sync +
migrations), `frontend/` is a Vite + React SPA, and `shared/` holds the TypeScript types
for the wire format between them. See `ARCHITECTURE.md` for how it fits together and
`backend/API-ARCHITECTURE.md` for what belongs on which backend route. Contributing?
Read `CONTRIBUTING.md` first.

## Philosophy

Built for a specific person: a Brazilian developer who already works with AI agents
every day and wants to run their own (or their family's) finances the same way —
spreadsheets stopped scaling, and a SaaS budgeting app you can't change to fit how your
own money actually works isn't the answer either.

**Built AI-agent-first, for Brazilians.** Every domain operation this app has —
categorizing a transaction, reconciling a debt, checking next month's projection, adding
a category rule — exists as an MCP tool (`backend/src/mcp-server.ts`) before it exists as
a REST route with a form on top. Claude is the primary client this is built and tested
against today, but the tools speak plain MCP, so any agent that can hold an MCP
connection can drive the app the same way. The web UI isn't a second-class citizen —
it's the same operations, the same backend functions, just reached by clicking instead
of asking. And it's built on [Open Finance Brasil](https://www.bcb.gov.br/estabilidadefinanceira/openfinance)
via Pluggy from day one, not a generic budgeting tool with a Brazilian bank integration
bolted on — that's the whole foundation, not a feature.

A few concrete principles that follow from that:

- **Don't like what it's showing? Change it.** This ships with only the basics of
  personal finance — accounts, categories, bills, debts, a cash-flow projection — and
  deliberately isn't opinionated beyond that. It's not trying to anticipate every
  household's workflow with a settings screen for each one (see the notification rules
  above: env var + a function you edit, not a rules-builder UI). If something doesn't
  match how your own money works, the expectation is you fork it and change the code,
  not file a feature request and wait.
- **The backend is the source of truth for every number.** Anything that looks like a
  calculation — a debt payoff date, a category breakdown, a net-worth figure — is
  computed once, on the server, and shipped to the frontend (and to an agent, via MCP)
  as a finished value. Neither one re-derives it. This was violated a few times early on
  (see `backend/API-ARCHITECTURE.md`'s fix log) and every time it caused the UI to
  quietly disagree with itself across pages — and it's exactly what keeps the MCP tools
  and the REST API from ever disagreeing about what a number means, since they call the
  exact same functions.
- **Real data over fixtures, when it matters.** Pluggy's pagination and balance-sign
  quirks only ever surfaced when testing against a real bank connection — a hand-rolled
  fixture would have happily hidden the same bug. Automated tests still run against a
  real (if throwaway) SQLite database rather than a mocked ORM, for the same reason.
- **Additive over rewritten.** New features (household member profiles, shared debts,
  notification rules) were built as extensions of the existing model rather than a
  redesign — a shared debt is still one row, now with an optional pointer to who it's
  shared with, not a new subsystem.
- **No more layers than the problem needs.** The backend is routes + services, not
  routes + services + repositories — a third layer was considered and dropped because
  nothing in this codebase needed the extra indirection. Add structure when duplication
  or a real bug demands it, not in advance of one.
- **Sized to be forked, not just used.** No feature flags, no multi-tenant auth, no
  premature abstraction for hypothetical future users of _this_ deployment — but the
  domain logic stays behind clean route/service boundaries specifically so someone
  running their own fork can change categorization rules, add a new resource, wire up a
  new MCP tool, or add a new notification provider without fighting the architecture to
  do it.

## Setup

This app only _reads_ from Pluggy — it doesn't handle connecting your bank accounts
itself. Use [meu-pluggy](https://github.com/pluggyai/meu-pluggy) (Pluggy's own reference
app, built on their Connect widget) to link each bank account and get the Item ID(s) you
then paste in here per person.

1. Copy `.env.example` to `.env`. The only value you actually need to set is
   `SESSION_SECRET` (any long random string, e.g. `openssl rand -hex 32`) — everything
   else in there is optional:
   - `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` / `PLUGGY_ITEM_IDS` are a one-time
     bootstrap only, for carrying over credentials from before household member
     profiles existed. Pluggy credentials normally live in the database now, entered
     per-person from `/config` after setup — leave these blank for a fresh install.
   - `CRON_SCHEDULE` (default `0 6 * * *`) — when the daily sync runs.
   - `MIN_BUFFER` (default `0`) — balance floor below which a projected month is
     flagged as a shortfall.
   - `LARGE_TRANSACTION_THRESHOLD` (default `500`) — notification rule: flag any newly
     synced transaction at or above this amount (BRL).
   - `PUSHOVER_APP_TOKEN` / `SMTP_HOST` + friends — only needed if you want push
     notifications; see "Notifications" below.
   - `PORT` (default `3000`) / `DB_PATH` (default `./data/budget.sqlite`).
2. Install dependencies (single lockfile, all three workspaces): `bun install`
3. Run the dev servers: `bun run dev` runs backend + frontend together in one terminal
   (via `concurrently`). To run them separately in two terminals instead:
   - `bun run dev:backend` — backend on `:3000` with hot reload (also runs DB migrations
     on boot)
   - `bun run dev:frontend` — Vite dev server, proxies `/api` and `/public` to the backend
4. Visit the Vite dev server URL's `/setup` to create the admin account. Login is
   single-admin (one household, no signup). Once you're in, add each household member
   from `/config` — name, color, and their own Pluggy Client ID/Secret/Item IDs — and
   roll everyone up in the `/household` view.

## Notifications

After every sync, a small set of rules (`backend/src/services/notifications/rules.ts`)
checks what changed — a transaction over `LARGE_TRANSACTION_THRESHOLD`, a projected
shortfall next month — and, the first time each one fires, creates a notification and
delivers it through whichever channels you've enabled for that person from `/config`:

- **Pushover** — set `PUSHOVER_APP_TOKEN` (one app-level token for the whole
  deployment, from [pushover.net](https://pushover.net)), then each person adds their
  own Pushover user key from `/config`.
- **Email** — set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (one relay
  for the whole deployment), then each person adds their own destination address.

Both are tested from the same `/config` panel before you rely on them. Adding a new
provider or rule is a code change (see the doc comments in
`backend/src/services/notifications/`), not a UI-configurable system — this is meant to
be forked and adjusted, not built as a general-purpose rules engine nobody needed yet.

## Development

- `bun run dev` — both dev servers together in one terminal; `bun run dev:backend` /
  `bun run dev:frontend` — the same two, separately
- `bun run build` — build the frontend (Vite → `frontend/dist`), served by the backend
  in production
- `bun run start` — run the backend from the repo root, serving the built frontend
- `bun run typecheck` — type-check both `backend/` and `frontend/`

The daily sync runs on `CRON_SCHEDULE` (default `0 6 * * *`) and also once at startup if
the last successful sync is more than 24h old. You can also trigger it manually:
`POST /api/sync/run` (requires an authenticated session).

## Deploying with Docker Compose (CasaOS)

```bash
docker compose up -d --build
```

This builds the image, runs migrations automatically on boot, and persists the SQLite
database at `./data/budget.sqlite` via a bind-mounted volume. On CasaOS, point the
compose app / custom-install feature at this `docker-compose.yml`, and mount the volume
under `/DATA/AppData/copiloto-financeiro` per CasaOS convention (edit the `volumes:`
path in `docker-compose.yml` accordingly).

The container exposes port `3000` internally, mapped to `8080` on the host by default —
adjust in `docker-compose.yml` if that conflicts with something else on your CasaOS box.

### Exposing it to the internet (Caddy + WireGuard + Oracle Cloud)

This app does not need its own DDoS/exposure hardening — it's designed to sit behind a
reverse proxy you already run elsewhere (e.g. an Oracle Cloud box running Caddy,
reached from your home server over WireGuard). It only needs a login (built in) and to
bind to a port Caddy can reach. Example snippet for your existing Caddyfile:

```
copiloto.example.com {
    reverse_proxy <wireguard-ip-of-this-box>:8080
}
```

Caddy handles TLS termination and sits in front of the app; the home box is never
directly reachable from the internet. The app itself rate-limits the login endpoint as
defense-in-depth on top of that.
