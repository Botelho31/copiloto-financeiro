# About this project

This file is the living description of what Copiloto Financeiro is and
where it's headed — read it first, before `ARCHITECTURE.md` or anything
else. Keep it short enough that reading it is never a chore.

## What it is, right now

A self-hosted personal finance copilot for Lucas's household, built for
Brazil. Pulls bank transactions via Pluggy (Open Finance Brasil) and tracks
spending, bills, debts, savings goals, and cash-flow projections — one view
per person, plus a combined household view. Sync happens automatically when
the vault is unlocked and due, not on a fixed daily timer, since the app is
locked by default and may sit closed for days.

No accounts/login — the database itself is encrypted at rest, unlocked by a
password. Built AI-agent-first: every real operation exists as an MCP tool
before (or instead of) a REST route, so Claude can drive the app directly
in chat, not just through the website.

## Keep this file current — don't wait to be asked

Whenever the project's actual purpose, scope, or priorities shift — a new
feature area lands, a direction changes, the user says something now
matters that didn't before — update "What it is" above and the "Current
direction" list below to reflect it. This file is what a future session
with no memory of this conversation reads first; if it's out of date, that
session starts from a wrong picture of what this app is actually for. Treat
keeping it accurate as part of finishing the work, not an optional extra
step.

This file is also Lucas's to edit directly, anytime — nothing here is
fixed. If something's written here, treat it as the current, intended
word on the project, not a historical note to second-guess.

## Current direction / what's actively being worked on

- Core tracking (accounts, transactions, bills, debts, goals, projections)
  is built and in daily use.
- Onboarding (the `get-started` skill) is meant to feel like a short,
  friendly conversation, not a form — one plain question at a time, every
  step past the password/API-key setup fully skippable.
- Categorization should feel increasingly automatic — rules and recurring-
  bill detection exist so the app gets smarter about a household's actual
  spending the more it's used, not something manually maintained forever.

## Where to go deeper

- `ARCHITECTURE.md` — how it's actually built (data flow, the encrypted
  vault, the MCP-as-HTTP-client design).
- `CONTRIBUTING.md` — conventions for where new code goes.
- `README.md` (Portuguese, primary) / `README.en.md` — the pitch and setup
  instructions, for a human rather than Claude.
- `.claude/skills/` — playbooks for specific recurring jobs
  (`get-started`, `add-category-rules`, `confirm-recurring-bills`,
  `reconcile-debts`). Add a new one here the same way if a task becomes
  something worth repeating exactly, rather than re-deriving each time.
