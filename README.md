# Copiloto Financeiro

🇧🇷 [Leia em português](README.pt-BR.md)

Self-hosted personal finance copilot for Brazil. Pulls bank transactions daily via
[Pluggy](https://docs.pluggy.ai/) (Open Finance Brasil), and tracks spending, bills,
debts, and cash-flow projections across a household.

A Bun-workspace monorepo: `backend/` (Elysia API + cron sync), `frontend/` (Vite +
React), `shared/` (shared types). See `ARCHITECTURE.md` and
`backend/API-ARCHITECTURE.md` for how it's built, `CONTRIBUTING.md` before opening a PR.

## Philosophy

Built AI-agent-first for a Brazilian developer who already works with agents daily:
every operation exists as an MCP tool (`backend/src/mcp-server.ts`) before it exists as
a REST route with a form on top — Claude is the primary client today, but any
MCP-capable agent drives it the same way. It ships with only the basics of personal
finance and is deliberately unopinionated beyond that — if something doesn't fit how
your money works, fork it and change the code instead of waiting for a setting.

## Setup

This app only _reads_ from Pluggy — use [meu-pluggy](https://github.com/pluggyai/meu-pluggy)
to actually connect a bank account and get an Item ID.

1. Copy `.env.example` to `.env` and set `SESSION_SECRET` (see the file for how).
2. `bun install`
3. `bun run dev` (backend + frontend together) — open the printed URL's `/setup` to
   create the admin account, then add household members and everything else (Pluggy
   credentials, cron schedule, notification providers) from `/config`.

## Development

- `bun run dev` / `bun run dev:backend` / `bun run dev:frontend`
- `bun run build` / `bun run start` — production build + serve
- `bun run typecheck` / `bun run test` / `bun run lint`

## Notifications

After each sync, rules in `backend/src/services/notifications/rules.ts` (large
transaction, projected shortfall) can notify a person via Pushover and/or email —
configure the app-wide Pushover token / SMTP relay and enable each person's own
destination from `/config`.

## Deploying

```bash
docker compose up -d --build
```

Builds the image, runs migrations on boot, and persists SQLite at `./data` via a
bind-mounted volume. Put it behind whatever reverse proxy you already run — the app
itself just needs a port, and handles its own login and rate limiting.
