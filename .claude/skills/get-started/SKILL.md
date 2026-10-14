---
name: get-started
description: >-
  First-run setup, end to end — explains what the app does in plain language,
  gets the server running, and collects everything an initial user needs
  (your name, household members, Pluggy connections, card-spend goals,
  planned bills/income, debts, savings goals) via MCP tools, asking one
  thing at a time. Use when the user is setting this up for the first time,
  says they just cloned the repo, asks "how do I get started" / "how do I
  set this up", or runs /get-started. Resumable — safe to run again to
  finish anything left half-done.
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
   report the transaction count. If nobody has Pluggy credentials yet, skip
   straight to step 8 — there's nothing to sync or categorize without real
   transactions, but bills/income/debts/goals can still be added by hand.

7. **Categorize suggestions — right after that first sync, optional.** A
   fresh sync is almost entirely "Uncategorized." Ask: "Want me to go
   through and suggest categories for these now, so the Dashboard isn't
   just a wall of 'Uncategorized'?" If yes, run the `add-category-rules`
   skill right now — it finds the recurring patterns, picks a category for
   each from what already exists, and applies retroactively; don't repeat
   its steps here, just invoke it and report what it did. If no, say once
   that it's available anytime, by just asking or via that skill directly,
   and move on without pressing it.

8. **Planned bills and income — optional, say so up front.** Ask: "Any
   regular bills or income you want me to add now — rent, subscriptions,
   a salary — so the projections on the Dashboard start accurate right
   away?" If yes, one at a time: name, amount, how often (monthly/weekly/
   quarterly/yearly/once), and whether it's income or an expense. For
   income (e.g. salary), use `categoryName: "Income"` — it's one of the
   defaults, already there. For an expense, ask which category fits
   loosely, or leave it to `categorize` later. `create_bill` per item.
   Mention once, not per item: after a sync, the app also auto-detects
   likely recurring bills from the transaction history itself — those
   show up as pending candidates, reviewed later with the
   `confirm-recurring-bills` skill, not something to chase down now.

9. **Debts — optional, ask before collecting anything.** Ask first,
   plainly, before walking through any details: "Do you have any debts to
   track — money you owe, or money owed to you?" Only if they say yes, go
   one at a time: name, direction (they borrowed it, or they lent it),
   who it's with (another household member via `sharedWithUserId`, or
   free text for anyone else via `counterparty`), the amount, and roughly
   when it started. `create_debt` with just those — `direction`,
   `principalAmount`, `startDate` are all it needs. Don't ask about
   interest rate, formal loan type (PRICE/SAC), or a transaction-matching
   rule unless they bring it up themselves; mention once that those (and
   linking real transactions to this debt) can be refined anytime by just
   asking in chat, or with the `reconcile-debts` skill once there's
   transaction history to match against.

10. **Savings goals — optional, but worth asking clearly, not just
    mentioning in passing.** Ask: "Any savings goal you're working
    toward — an emergency fund, a trip, anything with a target amount and
    a rough date?" One at a time if yes: name, target amount, target date.
    `create_goal` per goal.

11. **Wrap up.** Point to `confirm-recurring-bills` for later, once the
    auto-detector has had a chance to find patterns from real history, and
    `reconcile-debts` if any debts got added in step 9. Mention, once, that
    locking the vault (the icon in the top-right of the app) cuts off your
    MCP access too, instantly — that's by design, not a bug if it happens
    mid-conversation.

## Rules

- One question at a time — don't dump a form's worth of questions in one
  message.
- Step 1 is the only truly required one (and the only one you cannot do
  yourself, at all — be upfront about that rather than attempting a
  workaround). Everything from step 2 onward is optional and resumable —
  say so as you go, don't make any of it feel mandatory.
- Steps 7–10 (categorize, bills, debts, goals) each start with their own
  plain yes/no question before doing or collecting anything — never jump
  straight into suggesting categories or asking for amounts/dates on the
  assumption they want it. A "no" or "not now" ends that step immediately,
  no follow-up pressure.
- Keep what you collect in steps 8–10 to the essentials listed there. These
  tools support a lot more (interest rates, formal loan amortization,
  card-expense flags, debt-linked bills) — that's for later, once it's
  relevant, not for a first pass where the goal is a working app in a few
  minutes.
- Never ask the user to tell you their password or recovery code. You have
  no use for either — only the API key step 1 generates is ever meant to
  reach you.
