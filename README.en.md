# Copiloto Financeiro

🇧🇷 [Leia em português](README.md)

Self-hosted personal finance copilot for Brazil. Pulls bank transactions via
[Pluggy](https://docs.pluggy.ai/) (Open Finance Brasil) and tracks spending, bills,
debts, goals, and cash-flow projections for a household — one view per person, plus a
combined one.

Bun workspace: `backend/` (Elysia API + Pluggy sync + MCP server), `frontend/` (Vite +
React), `shared/` (shared types). See `ARCHITECTURE.md` / `backend/API-ARCHITECTURE.md`
for internals, `CONTRIBUTING.md` before opening a PR.

## Philosophy

Built AI-agent-first: every operation is an MCP tool (`backend/src/mcp-server.ts`)
before it's a REST route — Claude drives it directly today, any MCP-capable agent
could. Ships with only the basics and stays unopinionated beyond that; fork it and
change the code if something doesn't fit how your money works.

## Setup

Simplest way: send this repo's link to Claude Code and ask it to set things up — it
handles everything (`/get-started`).

Prefer doing it by hand?

1. `bun run setup` — installs dependencies if needed, asks for your password right in
   the terminal (this encrypts the database; save the recovery code it shows you, it's
   the only way back in if you forget the password and it's never shown again),
   generates the first API key for Claude Code, and starts the app.
2. Add people and their Pluggy connections (an Item ID via
   [meu-pluggy](https://github.com/pluggyai/meu-pluggy)) from `/config`.

No accounts — just that one password. Sync runs when you unlock, if it's been a while
(or anytime with "Sync now"). Locking the app cuts off MCP access too. Meant to stay on
your machine or local network, not the open internet (see "Deploying").

## Development

- `bun run dev` / `bun run dev:backend` / `bun run dev:frontend`
- `bun run build` / `bun run start` — production build + serve
- `bun run typecheck` / `bun run test` / `bun run lint`

## Deploying

```bash
docker compose up -d --build
```

Builds the image, runs migrations on boot, serves on `127.0.0.1:8080`, and persists
`./data` (the encrypted database, the file needed to unlock it, and the MCP key — back
it up as a unit). Still no accounts, so don't port-forward this or put it on the open
internet — keep it on localhost/LAN, or reach it remotely via something like
Tailscale.
