---
name: get-started
description: >-
  First-run setup, end to end — explains what the app does in plain language,
  gets the server running, and collects everything an initial user needs
  (your name, household members, Pluggy connections, card-spend goals) via
  MCP tools, asking one thing at a time. Use when the user is setting this
  up for the first time, says they just cloned the repo, asks "how do I get
  started" / "how do I set this up", or runs /get-started. Resumable — safe
  to run again to finish anything left half-done.
---

# Get Started

This is the easy, guided path. `README.md` still exists for anyone who wants
the from-scratch technical version — don't make the user read it first.

## Explain it simply, first

Before doing anything, say this in your own words (keep it short, no
jargon — no "cash-flow projection engine" or "MCP tool server"):

> This app connects to your bank (read-only) and keeps track of your money
> for you: what you're spending, bills coming up, debts you're paying off,
> and whether you'll have enough money in the months ahead. You (and anyone
> else in your household) each get your own view, plus a combined one. You
> talk to it either through the website or through me, right here in chat.
> There's no login/account system — instead the database itself is locked
> behind a password you choose, so it's meant to stay on your own
> machine/network.

## Steps

1. **Tell the user to run `bun run setup` in a terminal — you can't do this
   part for them.** One command does everything that used to be three
   separate steps: installs dependencies if `node_modules` is missing,
   copies `.env.example` to `.env` if needed, asks for a password right in
   the terminal (this encrypts the database — tell them plainly that this
   is on them, and to **save the recovery code it prints** before
   continuing past that prompt, it's the only way back in if they forget
   the password and it's never shown again), generates the first MCP API
   key and saves it to `data/mcp-api-key` itself, then starts the app. You
   have no MCP tools until this finishes — none exist until the vault is
   unlocked and that key file exists. If the project's already been set up
   before (a vault already exists), the same command just starts the app
   again, no prompts.
   - If they'd rather do it the old way (the browser's own "Set a
     password" screen, then generating a key from `/config` → "API Keys"
     by hand), that still works — don't insist on the script if they
     already started down that path.
   - Once your MCP tools start working, if a call fails with "no valid API
     key," `data/mcp-api-key` is still missing or has the wrong content —
     don't guess further, ask the user to check it.

2. **Find out who you're talking to.** Call `list_users`. A fresh install
   always has exactly one person, named "Me" with no Pluggy credentials —
   if that's still the case, ask the user's name and `update_user` that
   same person (rename "Me") rather than creating a second profile. If
   `list_users` already shows real names or credentials, skip straight to
   step 4 — this install is already further along than "fresh."

3. **Ask about the rest of the household**, one at a time: "Anyone else
   sharing this with you?" For each additional person, `create_user` with
   just their name (color is optional, a sensible default is fine).

4. **Pluggy, per person.** Ask: "Have you already connected a bank via
   meu-pluggy, or do you need to do that first?" If they need to, explain
   in one line: [meu-pluggy](https://github.com/pluggyai/meu-pluggy) is a
   separate tool that actually links a bank account and hands back a client
   id/secret and an Item ID — this app only reads what Pluggy already has.
   Once they have those, `update_user` (or pass them inline on
   `create_user`). This step is fully skippable — say so — they can come
   back and run this skill again, or add it later from `/config`.

5. **Card-spend goal, per person — optional, say so up front.** Ask if they
   want a standing monthly target for credit card spending, or would rather
   the app just use their real 3-month average (the default, no action
   needed). If they want one, `update_settings` for that person.

6. **First sync.** Once at least one person has Pluggy credentials, run
   `trigger_sync` so they see real data immediately instead of an empty app.
   Call `get_sync_status` after a few seconds to confirm it finished, and
   report the transaction count.

7. **Wrap up.** Mention categories already come with sensible defaults
   (`list_categories` if they're curious) — nothing to set up there yet.
   Point to the other skills for later, once there's real transaction
   history: `add-category-rules`, `confirm-recurring-bills`,
   `reconcile-debts`. Bills/debts/goals can be added anytime from their own
   pages or by just asking in chat — not part of initial setup. Mention,
   once, that locking the vault (the icon in the top-right of the app) cuts
   off your MCP access too, instantly — that's by design, not a bug if it
   happens mid-conversation.

## Rules

- One question at a time — don't dump a form's worth of questions in one
  message.
- Step 1 is the only truly required one (and the only one you cannot do
  yourself, at all — be upfront about that rather than attempting a
  workaround). Everything from step 2 onward is optional and resumable —
  say so as you go, don't make any of it feel mandatory.
- Never ask the user to tell you their password or recovery code. You have
  no use for either — only the API key step 1 generates is ever meant to
  reach you.
