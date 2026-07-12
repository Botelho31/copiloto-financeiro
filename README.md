# Budget Tracker

Self-hosted personal budget tracker. Pulls bank transaction history daily from
[Pluggy](https://docs.pluggy.ai/), stores it in SQLite, and answers: how much am I
spending, will I be able to meet upcoming costs, and if not, what do I need to adjust.
Supports a whole household — each person keeps their own bank connection and data, and
debts can be explicitly shared between people.

A Bun-workspace monorepo: `backend/` is the Elysia server (API + auth + cron sync +
migrations), `frontend/` is a Vite + React SPA, and `shared/` holds the TypeScript types
for the wire format between them. See `ARCHITECTURE.md` for how it fits together and
`backend/API-ARCHITECTURE.md` for what belongs on which backend route. Contributing?
Read `CONTRIBUTING.md` first.

## Philosophy

This is a personal tool built for one household, not a product — every decision below
follows from that.

- **The backend is the source of truth for every number.** Anything that looks like a
  calculation — a debt payoff date, a category breakdown, a net-worth figure — is
  computed once, on the server, and shipped to the frontend as a finished value. The
  frontend renders; it doesn't re-derive. This was violated a few times early on (see
  `backend/API-ARCHITECTURE.md`'s fix log) and every time it caused the UI to quietly
  disagree with itself across pages.
- **Real data over fixtures, when it matters.** Pluggy's pagination and balance-sign
  quirks only ever surfaced when testing against a real bank connection — a hand-rolled
  fixture would have happily hidden the same bug. Automated tests still run against a
  real (if throwaway) SQLite database rather than a mocked ORM, for the same reason.
- **Additive over rewritten.** New features (household member profiles, shared debts)
  were built as extensions of the existing single-person model rather than a redesign —
  a shared debt is still one row, now with an optional pointer to who it's shared with,
  not a new subsystem.
- **No more layers than the problem needs.** The backend is routes + services, not
  routes + services + repositories — a third layer was considered and dropped because
  nothing in this codebase needed the extra indirection. Add structure when duplication
  or a real bug demands it, not in advance of one.
- **One person's tool, sized like one.** No feature flags, no multi-tenant auth, no
  premature abstraction for hypothetical future users. It's meant to be small enough
  that one person can hold the whole thing in their head.

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` — from your Pluggy dashboard
   - `PLUGGY_ITEM_IDS` — comma-separated Item IDs for your already-connected bank(s)
   - `SESSION_SECRET` — any long random string, e.g. `openssl rand -hex 32`
2. Install dependencies (single lockfile, all three workspaces): `bun install`
3. Run the backend + frontend dev servers (in separate terminals):
   - `bun run dev` — backend on `:3000` with hot reload (also runs DB migrations on boot)
   - `bun run dev:frontend` — Vite dev server, proxies `/api` and `/public` to the backend
4. Visit the Vite dev server URL's `/setup` to create the admin account. Login is
   single-admin (one household, no signup), but once you're in you can add multiple
   household member profiles from `/config` — each with their own Pluggy connection,
   accounts, and transactions — and roll them up in the `/household` view.

## Development

- `bun run dev` / `bun run dev:frontend` — the two dev servers described above
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
under `/DATA/AppData/budget-tracker` per CasaOS convention (edit the `volumes:` path in
`docker-compose.yml` accordingly).

The container exposes port `3000` internally, mapped to `8080` on the host by default —
adjust in `docker-compose.yml` if that conflicts with something else on your CasaOS box.

### Exposing it to the internet (Caddy + WireGuard + Oracle Cloud)

This app does not need its own DDoS/exposure hardening — it's designed to sit behind a
reverse proxy you already run elsewhere (e.g. an Oracle Cloud box running Caddy,
reached from your home server over WireGuard). It only needs a login (built in) and to
bind to a port Caddy can reach. Example snippet for your existing Caddyfile:

```
budget.example.com {
    reverse_proxy <wireguard-ip-of-this-box>:8080
}
```

Caddy handles TLS termination and sits in front of the app; the home box is never
directly reachable from the internet. The app itself rate-limits the login endpoint as
defense-in-depth on top of that.
