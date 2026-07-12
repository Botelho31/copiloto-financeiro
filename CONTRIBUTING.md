# Contributing

This is a personal, self-hosted project (see the "Philosophy" section in `README.md`
before making structural changes) — but the same conventions apply whether you're the
sole maintainer or a future contributor.

## Setup

Follow `README.md`'s Setup section first. In short: `bun install`, copy `.env.example`
to `.env`, `bun run dev` + `bun run dev:frontend` in separate terminals.

## Before opening a PR / committing

```bash
bun run typecheck   # backend + frontend
bun run test        # backend test suite (real throwaway SQLite DB, not mocked)
bun run lint        # eslint, whole repo
bun run build       # frontend production build
```

A pre-commit hook (husky + lint-staged, see `.husky/pre-commit`) runs `eslint --fix` and
`prettier --write` on staged files automatically — you don't need to run those by hand,
but the four commands above aren't part of the hook and should be run manually before
pushing.

There is no frontend test suite yet — frontend changes should be manually smoke-tested
in a running dev server (`bun run dev` + `bun run dev:frontend`) before considering the
change done, especially anything touching Dashboard.tsx's three modes or a mutation
hook's invalidation list.

## Where things go

### Backend: routes vs. services

Two layers, no more. See `backend/API-ARCHITECTURE.md`'s "File layout" section for the
full rationale.

- **`routes/*.ts`** — the HTTP boundary. Parse/validate the request body with a Zod
  schema passed as `{ body: MySchema }` (Elysia validates it natively), call a service
  function, shape the response. No business logic here beyond that.
- **`services/*.ts`** — business logic, but only split into its own file when there's
  real computation to isolate (debts, the projection engine, categorization). A trivial
  resource (tags, settings, users) can keep its logic inline in `routes/*.ts`.
- **Every mutation is a named, exported function**, never inline in the Elysia handler —
  `backend/src/mcp-server.ts` reuses these exact functions instead of duplicating SQL, so
  a route and an MCP tool can never quietly disagree about what a "create bill" does.

### Frontend: pages, components, hooks, config

- **`pages/*.tsx`** — one per route. Owns page-level state and layout, composes
  components and hooks. Should not contain `<form>` elements or `useQuery`/`useMutation`
  calls directly — both belong one level down.
- **`components/*.tsx`** — everything else, including every form. A form always owns its
  own local input state and calls a mutation hook itself (or takes an `onSubmit`
  callback if the parent needs to react to success) — see `components/NewDebtForm.tsx`
  or `components/BillForm.tsx` for the shape.
- **`hooks/*.ts`** — one file per backend resource, exporting a `useX()` query hook and
  `useCreateX`/`useUpdateX`/`useDeleteX` mutation hooks. All server data access goes
  through these — no page or component calls `apiFetch`, `useQuery`, or `useMutation`
  directly. If a new resource is simply a person-scoped list (`GET /api/x?userId=`),
  reach for `useUserScopedList<T>("x", "/api/x")` (see `hooks/useUserScopedList.ts`)
  instead of hand-writing the query. If a mutation invalidates more than one query key
  on success, use `invalidateKeys(qc, [[...], [...]])` (`lib/queryInvalidation.ts`)
  instead of repeating `qc.invalidateQueries(...)` per key.
- **`config.ts`** — tunable constants (thresholds, default rates, horizons, shared chart
  colors) live here, not hardcoded inline in a page. Purely structural, page-local
  details (a table's own column count, a form's own valid option list) are the
  exception — they stay next to the code that owns them.

## Commit messages

Focus on _why_, not _what_ — the diff already shows what changed. Prefer a few focused
commits over one giant one when a change spans genuinely distinct concerns (e.g. a
feature + a separate tooling change), but don't over-split a single cohesive refactor.
