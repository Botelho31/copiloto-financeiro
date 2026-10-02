import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config";

// This app encrypts its SQLite database at rest, and only the main HTTP
// server process (backend/src/index.ts) ever holds the decryption key in
// memory, only while unlocked (see backend/src/db/index.ts). mcp-server.ts
// is a separate OS process Claude Code spawns independently — it cannot
// share that key, so it never touches the database or any service function
// directly (the only backend import here is ./config, pure env-var parsing
// with no business logic or DB access of its own). Every tool below is a
// plain HTTP client of the main server's own /api/* routes instead (the
// same ones the frontend calls), the same pattern frontend/src/lib/api.ts
// uses, authenticated via an API key (see routes/vault.ts) instead of a
// browser session cookie. Locking the vault makes every one of these
// requests fail with 423 — instantly, for this process too, with nothing
// cached here to go stale.

// Same directory vault/store.ts derives vault.json's path from — follows a
// custom DB_PATH (e.g. a Docker deployment), not hardcoded relative to this
// source file.
const API_KEY_PATH = join(dirname(config.dbPath), "mcp-api-key");
const BASE_URL = `http://127.0.0.1:${config.port}`;

class McpApiError extends Error {}

function readApiKey(): string {
  try {
    return readFileSync(API_KEY_PATH, "utf-8").trim();
  } catch {
    throw new McpApiError(
      "No API key found at data/mcp-api-key. Generate one from /config in the browser " +
        "(Developer / API Keys) and save the raw key to that file."
    );
  }
}

// Re-reads the key file on every call — it's stable (not rotated), so this
// is cheap insurance that a freshly-generated key is picked up without
// restarting this process, not a performance concern.
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = readApiKey();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-API-Key": key, ...init?.headers },
    });
  } catch {
    throw new McpApiError(
      "Could not reach the server — is it running? Start it with `bun run dev` or `bun run start`."
    );
  }
  if (res.status === 423) {
    throw new McpApiError("The vault is locked — unlock it in the browser first.");
  }
  if (res.status === 401) {
    throw new McpApiError(
      "No valid API key — generate one from /config in the browser and save it to data/mcp-api-key."
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new McpApiError(body.error ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Builds a query string from a plain object, skipping null/undefined/false
// values (and converting booleans to the "true" string literal the backend's
// query-parsing expects, e.g. unreadOnly/uncategorizedOnly).
function toQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === false) continue;
    usp.set(key, value === true ? "true" : String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
    ],
  };
}

const server = new McpServer({ name: "budget-tracker", version: "1.0.0" });

server.registerTool(
  "list_users",
  {
    description:
      "List household members (id, name, color, whether they have Pluggy credentials on file). " +
      "Most other tools take an optional userId to scope to one person (omit for the Household " +
      "view, everyone combined) — look up ids here first.",
  },
  async () => {
    try {
      return json(await apiFetch("/api/users"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "create_user",
  {
    description:
      "Add a new household member — their own profile with independent accounts, transactions, " +
      "bills, debts, and goals. Pluggy credentials (their own client id/secret/item ids, separate " +
      "from anyone else's) can be set now or later via update_user.",
    inputSchema: {
      name: z.string(),
      color: z
        .string()
        .optional()
        .describe("Hex color, e.g. '#5f7fbf' — used as their badge color across the app"),
      pluggyClientId: z.string().optional(),
      pluggyClientSecret: z.string().optional(),
      pluggyItemIds: z
        .string()
        .optional()
        .describe("Comma-separated Pluggy Item IDs for this person's connected bank(s)"),
    },
  },
  async (input) => {
    try {
      return json(await apiFetch("/api/users", { method: "POST", body: JSON.stringify(input) }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "update_user",
  {
    description:
      "Update a household member's name, color, or Pluggy credentials. Omit pluggyClientSecret to " +
      "leave it unchanged (there's no way to read it back once set).",
    inputSchema: {
      id: z.number().int(),
      name: z.string().optional(),
      color: z.string().optional(),
      pluggyClientId: z.string().nullable().optional(),
      pluggyClientSecret: z.string().optional(),
      pluggyItemIds: z
        .string()
        .nullable()
        .optional()
        .describe("Comma-separated Pluggy Item IDs, or null to clear"),
    },
  },
  async ({ id, ...input }) => {
    try {
      return json(
        await apiFetch(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(input) })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "delete_user",
  {
    description:
      "Delete a household member and everything they own (accounts, transactions, bills, debts, " +
      "goals, settings, sync history). Refuses if they're the last remaining person, or if they're " +
      "still shared_with_user_id on an active debt (unlink that first).",
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => {
    try {
      return json(await apiFetch(`/api/users/${id}`, { method: "DELETE" }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_categories",
  {
    description:
      "List all categories, including which are excluded from cash-flow totals (Transfers, Savings & Investments).",
  },
  async () => {
    try {
      return json(await apiFetch("/api/categories"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_category_rules",
  {
    description:
      "List all category_rules (substring match against normalized descriptions -> category), applied automatically to new transactions during sync.",
  },
  async () => {
    try {
      return json(await apiFetch("/api/categories/rules"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "delete_category_rule",
  {
    description:
      "Delete a category_rule by id (see list_category_rules) — stops it from auto-categorizing future transactions. Doesn't change any transaction's existing category.",
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => {
    try {
      return json(await apiFetch(`/api/categories/rules/${id}`, { method: "DELETE" }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_uncategorized_groups",
  {
    description:
      "Group still-Uncategorized transactions by normalized description over a lookback window, to spot patterns worth categorizing.",
    inputSchema: {
      days: z.number().int().positive().optional().describe("Lookback window in days (default 30)"),
      userId: z
        .number()
        .int()
        .optional()
        .describe("Scope to one person (see list_users); omit for Household"),
    },
  },
  async ({ days, userId }) => {
    try {
      return json(
        await apiFetch(`/api/categories/uncategorized-groups${toQuery({ days, userId })}`)
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "categorize",
  {
    description:
      "Create or update a category rule and retroactively apply it to every currently-Uncategorized transaction whose normalized description contains the match text. Prefer specific match text over broad terms: a broad rule applied first can steal transactions a later, more specific rule should have caught.",
    inputSchema: {
      matchText: z
        .string()
        .describe(
          "Text to match against transaction descriptions (case/accent-insensitive substring)"
        ),
      categoryName: z
        .string()
        .describe("Exact existing category name, e.g. 'Transport', 'Shopping'"),
    },
  },
  async ({ matchText, categoryName }) => {
    try {
      return json(
        await apiFetch("/api/categories/apply-rule", {
          method: "POST",
          body: JSON.stringify({ matchText, categoryName }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "create_category",
  {
    description: "Create a new category. Auto-assigns a color from the palette if none is given.",
    inputSchema: {
      name: z.string(),
      kind: z.enum(["income", "expense"]).optional().describe("Default 'expense'"),
      color: z.string().optional().describe("Hex color, e.g. '#4c9a6a' — auto-assigned if omitted"),
    },
  },
  async (input) => {
    try {
      return json(
        await apiFetch("/api/categories", { method: "POST", body: JSON.stringify(input) })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "update_category",
  {
    description:
      "Rename a category, recolor it, or toggle excludesFromCashflow (true for transfers/investments — money that never left net worth, so it shouldn't count as spend or income anywhere).",
    inputSchema: {
      id: z.number().int(),
      name: z.string().optional(),
      color: z.string().optional().describe("Hex color, e.g. '#4c9a6a'"),
      excludesFromCashflow: z.boolean().optional(),
    },
  },
  async ({ id, ...input }) => {
    try {
      return json(
        await apiFetch(`/api/categories/${id}`, { method: "PATCH", body: JSON.stringify(input) })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_tags",
  {
    description:
      "List all tags — a cross-cutting label independent of category, e.g. 'House build' can span transactions in Shopping, Transport, Debt & Credit Card, etc.",
  },
  async () => {
    try {
      return json(await apiFetch("/api/tags"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "create_tag",
  {
    description: "Create a new tag. Auto-assigns a color from the palette if none is given.",
    inputSchema: {
      name: z.string(),
      color: z.string().optional().describe("Hex color — auto-assigned if omitted"),
    },
  },
  async (input) => {
    try {
      return json(await apiFetch("/api/tags", { method: "POST", body: JSON.stringify(input) }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "tag_transactions",
  {
    description:
      "Apply a tag to a set of transactions (use list_transactions or search to find IDs first).",
    inputSchema: {
      transactionIds: z.array(z.string()),
      tagId: z.number().int(),
    },
  },
  async (input) => {
    try {
      return json(
        await apiFetch("/api/tags/bulk-tag", { method: "POST", body: JSON.stringify(input) })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "untag_transactions",
  {
    description: "Remove a tag from a set of transactions.",
    inputSchema: {
      transactionIds: z.array(z.string()),
      tagId: z.number().int(),
    },
  },
  async (input) => {
    try {
      return json(
        await apiFetch("/api/tags/bulk-untag", { method: "POST", body: JSON.stringify(input) })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "set_transaction_category",
  {
    description: "Set a single transaction's category directly, without creating a rule.",
    inputSchema: {
      transactionId: z.string(),
      categoryName: z.string(),
    },
  },
  async ({ transactionId, categoryName }) => {
    try {
      // The route takes categoryId, not categoryName — resolve it first via
      // list_categories' own route, same lookup create_bill/update_bill do
      // below for categoryName/debtName.
      const categories = await apiFetch<{ id: number; name: string }[]>("/api/categories");
      const category = categories.find((c) => c.name === categoryName);
      if (!category) return errorResult(`Unknown category "${categoryName}"`);
      await apiFetch(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        body: JSON.stringify({ categoryId: category.id }),
      });
      return json({ ok: true });
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "bulk_set_category",
  {
    description:
      "Set the category for an explicit list of transaction ids, regardless of their current " +
      "category. Unlike categorize/reclassify_matching, this doesn't touch category_rules — it's " +
      "for a one-off batch you already picked out (e.g. via list_transactions/search), not a " +
      "pattern that should also apply automatically going forward.",
    inputSchema: {
      transactionIds: z.array(z.string()),
      categoryName: z.string(),
    },
  },
  async (input) => {
    try {
      return json(
        await apiFetch("/api/transactions/bulk-set-category", {
          method: "POST",
          body: JSON.stringify(input),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "reclassify_matching",
  {
    description:
      "Like categorize, but reclassifies EVERY transaction whose normalized description contains " +
      "matchText, regardless of its current category — not just 'Uncategorized' ones. Also upserts " +
      "the category_rule so future matching transactions get it automatically. Use this to correct " +
      "a whole pattern that was previously swept into the wrong category (e.g. an overly broad " +
      "earlier rule), rather than just categorizing newly-uncategorized ones.",
    inputSchema: {
      matchText: z.string(),
      categoryName: z.string(),
    },
  },
  async (input) => {
    try {
      return json(
        await apiFetch("/api/transactions/reclassify", {
          method: "POST",
          body: JSON.stringify(input),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_transactions",
  {
    description:
      "List transactions, optionally filtered by date range, category, account, tag, or a text/regex search against the description. Newest first. Use this (not the HTTP-only /search endpoint) for regex — e.g. descriptionRegex: '^UBER' or 'AZUL.*BARUERI'.",
    inputSchema: {
      from: z.string().optional().describe("ISO date, inclusive"),
      to: z.string().optional().describe("ISO date, exclusive"),
      categoryName: z.string().optional(),
      accountId: z.string().optional(),
      tagId: z.number().int().optional(),
      uncategorizedOnly: z.boolean().optional(),
      descriptionContains: z.string().optional().describe("Case-insensitive substring match"),
      descriptionRegex: z
        .string()
        .optional()
        .describe(
          "JS RegExp (case-insensitive) against the raw description — applied after the SQL filters"
        ),
      limit: z.number().int().positive().max(5000).optional().describe("Default 200"),
      userId: z
        .number()
        .int()
        .optional()
        .describe("Scope to one person (see list_users); omit for Household"),
    },
  },
  async (input) => {
    try {
      return json(await apiFetch(`/api/transactions${toQuery(input)}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

const userIdScopeParam = z
  .number()
  .int()
  .optional()
  .describe("Scope to one person (see list_users); omit for Household");

server.registerTool(
  "list_accounts",
  {
    description: "List all synced BANK/CREDIT accounts with current balances.",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => {
    try {
      return json(await apiFetch(`/api/accounts${toQuery({ userId })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_investments",
  {
    description:
      "List synced investment holdings (Pluggy's separate Investments API, not Accounts). Only status='ACTIVE' rows are current holdings — 'TOTAL_WITHDRAWAL' means already redeemed.",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => {
    try {
      return json(await apiFetch(`/api/investments${toQuery({ userId })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_bills",
  {
    description:
      "List recurring bills (manual + auto-detected), including pending/unconfirmed ones.",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => {
    try {
      return json(await apiFetch(`/api/bills${toQuery({ userId })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

async function resolveCategoryId(categoryName: string): Promise<number | null> {
  const categories = await apiFetch<{ id: number; name: string }[]>("/api/categories");
  return categories.find((c) => c.name === categoryName)?.id ?? null;
}

async function resolveDebtId(debtName: string): Promise<number | null> {
  const debts = await apiFetch<{ id: number; name: string }[]>("/api/debts");
  return debts.find((d) => d.name === debtName)?.id ?? null;
}

server.registerTool(
  "create_bill",
  {
    description: "Create a new recurring bill (manual source, confirmed and active by default).",
    inputSchema: {
      name: z.string(),
      userId: z.number().int().describe("Which person this bill belongs to (see list_users)"),
      categoryName: z.string().optional(),
      expectedAmount: z.number(),
      cadence: z.enum(["weekly", "monthly", "quarterly", "yearly", "once"]),
      nextDueDate: z.string().optional().describe("ISO date"),
      recurrenceStartDate: z.string().optional().describe("ISO date; omit for no start bound"),
      recurrenceEndDate: z.string().optional().describe("ISO date; omit for no end bound"),
      isCardExpense: z
        .boolean()
        .optional()
        .describe(
          "True if this gets charged to a credit card — excludes it from the projection entirely, since it's already absorbed into the card-spend goal/average rather than being additional spend on top of it. Still shows up as a trackable bill."
        ),
      debtName: z
        .string()
        .optional()
        .describe(
          "Exact existing debt name — links this bill as (one of possibly several) payments that pay " +
            "that debt down, feeding its amount/cadence into the debt's payment plan (bounded by the " +
            "debt's remaining balance) instead of this being an unrelated generic expense."
        ),
    },
  },
  async ({ name, userId, categoryName, debtName, ...rest }) => {
    try {
      let categoryId: number | undefined;
      if (categoryName) {
        const id = await resolveCategoryId(categoryName);
        if (id == null) return errorResult(`Unknown category "${categoryName}"`);
        categoryId = id;
      }
      let debtId: number | undefined;
      if (debtName) {
        const id = await resolveDebtId(debtName);
        if (id == null) return errorResult(`Unknown debt "${debtName}"`);
        debtId = id;
      }
      return json(
        await apiFetch(`/api/bills${toQuery({ userId })}`, {
          method: "POST",
          body: JSON.stringify({ name, userId, categoryId, debtId, ...rest }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "update_bill",
  {
    description:
      "Update a bill — confirm/dismiss a detected candidate, change amount/cadence/category, etc.",
    inputSchema: {
      id: z.number().int(),
      name: z.string().optional(),
      categoryName: z.string().optional(),
      expectedAmount: z.number().optional(),
      cadence: z.enum(["weekly", "monthly", "quarterly", "yearly", "once"]).optional(),
      nextDueDate: z.string().optional(),
      recurrenceStartDate: z.string().nullable().optional().describe("ISO date, or null to clear"),
      recurrenceEndDate: z.string().nullable().optional().describe("ISO date, or null to clear"),
      isCardExpense: z
        .boolean()
        .optional()
        .describe(
          "True if this gets charged to a credit card — excludes it from the projection entirely, since it's already absorbed into the card-spend goal/average."
        ),
      debtName: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Exact existing debt name to link as a debt this bill pays down, or null to unlink."
        ),
      confirmed: z.boolean().optional(),
      active: z.boolean().optional(),
      userId: userIdScopeParam.describe(
        "Scope the returned list (see list_users); omit for Household"
      ),
    },
  },
  async ({ id, categoryName, debtName, userId, ...rest }) => {
    try {
      let categoryId: number | undefined;
      if (categoryName !== undefined) {
        const resolved = await resolveCategoryId(categoryName);
        if (resolved == null) return errorResult(`Unknown category "${categoryName}"`);
        categoryId = resolved;
      }
      let debtId: number | null | undefined;
      if (debtName !== undefined) {
        if (debtName === null) {
          debtId = null;
        } else {
          const resolved = await resolveDebtId(debtName);
          if (resolved == null) return errorResult(`Unknown debt "${debtName}"`);
          debtId = resolved;
        }
      }
      return json(
        await apiFetch(`/api/bills/${id}${toQuery({ userId })}`, {
          method: "PATCH",
          body: JSON.stringify({ categoryId, debtId, ...rest }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "delete_bill",
  {
    description: "Delete a bill and its recurring-match history.",
    inputSchema: {
      id: z.number().int(),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ id, userId }) => {
    try {
      return json(await apiFetch(`/api/bills/${id}${toQuery({ userId })}`, { method: "DELETE" }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_sync_status",
  {
    description: "Get the most recent Pluggy sync log entry.",
    inputSchema: {
      userId: userIdScopeParam.describe(
        "One person's last sync; omit for the Household's most recent across everyone"
      ),
    },
  },
  async ({ userId }) => {
    try {
      return json(await apiFetch(`/api/sync/status${toQuery({ userId })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "trigger_sync",
  {
    description:
      "Manually trigger a Pluggy sync (pulls latest accounts/transactions/investments, then runs recurring-bill and self-transfer detection) for one person, or everyone with Pluggy credentials on file if userId is omitted. No-ops if a sync is already running.",
    inputSchema: {
      userId: z
        .number()
        .int()
        .optional()
        .describe("Sync just this person (see list_users); omit to sync everyone"),
    },
  },
  async ({ userId }) => {
    try {
      return json(
        await apiFetch("/api/sync/run", { method: "POST", body: JSON.stringify({ userId }) })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_app_config",
  {
    description:
      "Get app-wide settings: the minimum balance buffer below which a projected month is flagged as a shortfall.",
  },
  async () => {
    try {
      return json(await apiFetch("/api/app-config"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "update_app_config",
  {
    description: "Update app-wide settings — currently just the minimum balance buffer.",
    inputSchema: {
      minBuffer: z.number().optional(),
    },
  },
  async (input) => {
    try {
      return json(
        await apiFetch("/api/app-config", { method: "PATCH", body: JSON.stringify(input) })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "detect_recurring_bills",
  {
    description:
      "Re-scan one person's transaction history for recurring-bill candidates (normally runs automatically after each sync).",
    inputSchema: { userId: z.number().int().describe("Which person to scan (see list_users)") },
  },
  async ({ userId }) => {
    try {
      return json(
        await apiFetch("/api/sync/detect-recurring-bills", {
          method: "POST",
          body: JSON.stringify({ userId }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "detect_self_transfers",
  {
    description:
      "Re-scan one person's own BANK accounts for transfers between them (normally runs automatically after each sync).",
    inputSchema: { userId: z.number().int().describe("Which person to scan (see list_users)") },
  },
  async ({ userId }) => {
    try {
      return json(
        await apiFetch("/api/sync/detect-self-transfers", {
          method: "POST",
          body: JSON.stringify({ userId }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_debts",
  {
    description:
      "List debts (money borrowed or lent) with computed totals: principal, total_paid, remaining, percent_complete, interest_paid_so_far, plus payment_plan (how each debt's expected payment is calculated: loan formula, linked payment bill, history-inferred, or none). Scoped to one person, a debt shows whether they own it or are the sharedWithUserId party (isOwner distinguishes the two).",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => {
    try {
      return json(await apiFetch(`/api/debts${toQuery({ userId })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_debt_transactions",
  {
    description: "List the transactions linked to a debt, with their role (borrow/lend/pay_off).",
    inputSchema: { debtId: z.number().int() },
  },
  async ({ debtId }) => {
    try {
      return json(await apiFetch(`/api/debts/${debtId}/transactions`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "create_debt",
  {
    description:
      "Create a debt. Either principalAmount (a simple fixed loan) or splitPercentage (a shared expense you fronted — principal is computed as that % of whatever borrow/lend transactions get linked) must be given, not both.",
    inputSchema: {
      name: z.string(),
      userId: z.number().int().describe("Which person owns/tracks this debt (see list_users)"),
      direction: z
        .enum(["owed_by_me", "owed_to_me"])
        .describe("owed_by_me = you borrowed; owed_to_me = you lent"),
      counterparty: z
        .string()
        .optional()
        .describe(
          "Free-text label for an outside party — use sharedWithUserId instead when the other party is a household member"
        ),
      sharedWithUserId: z
        .number()
        .int()
        .optional()
        .describe(
          "Set when the other party is a real household member (see list_users) rather than an " +
            "outside person — e.g. a debt split_percentage-shared with Juliana. Purely a typed label; " +
            "split_percentage/link_debt_to_debt still drive all the principal/remaining math."
        ),
      principalAmount: z.number().optional(),
      splitPercentage: z.number().min(0).max(100).optional(),
      expectedTotalAmount: z.number().optional().describe("Total incl. interest, if known"),
      interestRateMonthlyPercent: z
        .number()
        .optional()
        .describe(
          "Real per-month rate the loan carries (e.g. from a bank statement), for reference only"
        ),
      startDate: z.string().describe("ISO date"),
      targetPayoffDate: z.string().optional(),
      loanType: z
        .enum(["price", "sac"])
        .optional()
        .describe(
          "Brazil's two standard mortgage amortization systems (e.g. a CAIXA loan) — only set for a " +
            "formal amortizing loan, not an informal IOU or a split expense. price = constant payment, " +
            "growing amortization; sac = constant amortization, declining payment. When set alongside " +
            "interestRateMonthlyPercent and targetPayoffDate, the projection engine computes this debt's " +
            "expected monthly payment directly from the loan formula — no payment history needed, so it " +
            "works even for a loan that hasn't started yet."
        ),
      notes: z.string().optional().describe("Background/context"),
      matchingRule: z
        .string()
        .optional()
        .describe(
          "Precise, explicit rule for classifying future transactions against this debt " +
            "(counterparty pattern, amount threshold, role) — e.g. \"DEBIT to 'Ana Cristina...' " +
            '> R$1,000 → pay_off; her allowance (≤R$1,000) is not part of this debt." Set this so ' +
            "future debt-state updates can be applied exactly, without re-deriving the rule."
        ),
    },
  },
  async ({ userId, ...rest }) => {
    try {
      return json(
        await apiFetch(`/api/debts${toQuery({ userId })}`, {
          method: "POST",
          body: JSON.stringify({ userId, ...rest }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "update_debt",
  {
    description:
      "Update a debt's status, notes, matching rule, target date, principal, split percentage, or expected total.",
    inputSchema: {
      id: z.number().int(),
      status: z.enum(["active", "paid_off"]).optional(),
      counterparty: z.string().nullable().optional(),
      sharedWithUserId: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe(
          "Set when the other party is a real household member (see list_users), or null to clear"
        ),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
      startDate: z.string().optional().describe("ISO date"),
      targetPayoffDate: z.string().nullable().optional(),
      principalAmount: z.number().nullable().optional(),
      splitPercentage: z
        .number()
        .min(0)
        .max(100)
        .nullable()
        .optional()
        .describe(
          "For a shared-expense debt (principal computed as this % of whatever borrow/lend " +
            "transactions get linked) — set null to switch the debt to a fixed principalAmount instead."
        ),
      expectedTotalAmount: z.number().nullable().optional(),
      interestRateMonthlyPercent: z
        .number()
        .nullable()
        .optional()
        .describe(
          "The loan's real per-month rate. Drives real amortization math (interest/principal split of " +
            "past payments), and, alongside loanType + targetPayoffDate, the projection engine's " +
            "expected-monthly-payment schedule — not just for reference."
        ),
      loanType: z
        .enum(["price", "sac"])
        .nullable()
        .optional()
        .describe(
          "Brazil's two standard mortgage amortization systems — price (constant payment) or sac " +
            "(constant amortization), or null to clear (an informal IOU or split expense isn't a loan)."
        ),
      notes: z.string().nullable().optional().describe("Background/context"),
      matchingRule: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Precise, explicit rule for classifying future transactions against this debt " +
            "(counterparty pattern, amount threshold, role). Always read and follow this before " +
            "linking/unlinking transactions on a debt-state update request."
        ),
      overrideAutomaticSchedule: z
        .boolean()
        .optional()
        .describe(
          "When true, skips the payment-history heuristic in this debt's payment plan even if the " +
            "history would otherwise pass the regularity check — for a debt with one or more linked " +
            "payment bills (see create_bill/update_bill's debtName) already accounting for it, where " +
            "the raw history would double up against them rather than add real information."
        ),
    },
  },
  async ({ id, userId, ...input }) => {
    try {
      return json(
        await apiFetch(`/api/debts/${id}${toQuery({ userId })}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "delete_debt",
  {
    description: "Delete a debt and its transaction links.",
    inputSchema: {
      id: z.number().int(),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ id, userId }) => {
    try {
      return json(await apiFetch(`/api/debts/${id}${toQuery({ userId })}`, { method: "DELETE" }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "link_transactions_to_debt",
  {
    description:
      "Link transactions to a debt with a role: 'borrow'/'lend' for the originating transaction(s) (what set up the debt), 'pay_off' for a repayment.",
    inputSchema: {
      debtId: z.number().int(),
      transactionIds: z.array(z.string()),
      role: z.enum(["borrow", "lend", "pay_off"]),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ debtId, transactionIds, role, userId }) => {
    try {
      return json(
        await apiFetch(`/api/debts/${debtId}/link${toQuery({ userId })}`, {
          method: "POST",
          body: JSON.stringify({ transactionIds, role }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "unlink_transactions_from_debt",
  {
    description: "Remove transactions from a debt.",
    inputSchema: {
      debtId: z.number().int(),
      transactionIds: z.array(z.string()),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ debtId, transactionIds, userId }) => {
    try {
      return json(
        await apiFetch(`/api/debts/${debtId}/unlink${toQuery({ userId })}`, {
          method: "POST",
          body: JSON.stringify({ transactionIds }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "link_debt_to_debt",
  {
    description:
      "Feed a whole other debt's full computed principal into this (parent) debt's origin sum — " +
      "e.g. the entire Estudio Foz architect debt (present AND future installments, not just the " +
      "ones already paid) counts toward Juliana's 20% house-cost share. Use this instead of " +
      "link_transactions_to_debt when the relationship is 'debt X entirely counts toward debt Y', " +
      "not just specific transactions.",
    inputSchema: {
      parentDebtId: z.number().int().describe("The debt whose origin sum grows"),
      childDebtId: z.number().int().describe("The debt whose principal feeds into the parent"),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ parentDebtId, childDebtId, userId }) => {
    try {
      return json(
        await apiFetch(`/api/debts/${parentDebtId}/link-debt${toQuery({ userId })}`, {
          method: "POST",
          body: JSON.stringify({ childDebtId }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "unlink_debt_from_debt",
  {
    description: "Remove a debt-to-debt link (see link_debt_to_debt).",
    inputSchema: {
      parentDebtId: z.number().int(),
      childDebtId: z.number().int(),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ parentDebtId, childDebtId, userId }) => {
    try {
      return json(
        await apiFetch(`/api/debts/${parentDebtId}/unlink-debt${toQuery({ userId })}`, {
          method: "POST",
          body: JSON.stringify({ childDebtId }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_goals",
  {
    description:
      "List savings goals with computed feasibility: required_monthly_savings (to hit the target by the date) vs projected_monthly_savings (from recent baseline + confirmed bills), and on_track.",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => {
    try {
      return json(await apiFetch(`/api/goals${toQuery({ userId })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "create_goal",
  {
    description: "Create a savings goal — a target net-worth amount by a date.",
    inputSchema: {
      name: z.string(),
      userId: z.number().int().describe("Which person this goal belongs to (see list_users)"),
      targetAmount: z.number(),
      targetDate: z.string().describe("ISO date"),
    },
  },
  async ({ userId, ...rest }) => {
    try {
      return json(
        await apiFetch(`/api/goals${toQuery({ userId })}`, {
          method: "POST",
          body: JSON.stringify({ userId, ...rest }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "update_goal",
  {
    description: "Update a savings goal's name, target amount, or target date.",
    inputSchema: {
      id: z.number().int(),
      name: z.string().optional(),
      targetAmount: z.number().optional(),
      targetDate: z.string().optional().describe("ISO date"),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ id, userId, ...input }) => {
    try {
      return json(
        await apiFetch(`/api/goals/${id}${toQuery({ userId })}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "delete_goal",
  {
    description: "Delete a savings goal.",
    inputSchema: {
      id: z.number().int(),
      userId: userIdScopeParam.describe("Scope the returned list; omit for Household"),
    },
  },
  async ({ id, userId }) => {
    try {
      return json(await apiFetch(`/api/goals/${id}${toQuery({ userId })}`, { method: "DELETE" }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_settings",
  {
    description:
      "Get one person's app settings — currently just cardSpendGoal, the persisted monthly credit card spending target used by projections and shown on the Dashboard.",
    inputSchema: {
      userId: z
        .number()
        .int()
        .describe("Which person (see list_users) — settings are per-person, not global"),
    },
  },
  async ({ userId }) => {
    try {
      return json(await apiFetch(`/api/settings${toQuery({ userId })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "update_settings",
  {
    description:
      "Update one person's app settings. Set cardSpendGoal to a number to persist a standing monthly card-spend target (replaces the 3-month actual average everywhere it's used); set it to null to clear the goal and fall back to the average.",
    inputSchema: {
      userId: z
        .number()
        .int()
        .describe("Which person (see list_users) — settings are per-person, not global"),
      cardSpendGoal: z.number().nullable().optional(),
    },
  },
  async ({ userId, cardSpendGoal }) => {
    try {
      return json(
        await apiFetch(`/api/settings${toQuery({ userId })}`, {
          method: "PATCH",
          body: JSON.stringify({ cardSpendGoal }),
        })
      );
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_projections",
  {
    description:
      "Compute the cash-flow projection: starting balance, then month by month, built from confirmed bills (income + expense), each active debt's own repayment schedule, a 3-month average (or persisted goal) of card spend, and compounding interest on idle cash. Each month's bills[] line item is tagged kind: bill/debt/interest/cardSpend, and cardExpenseBills[] lists bills flagged is_card_expense (already folded into the cardSpend line, shown separately here for visibility, not double-counted in net).",
    inputSchema: {
      userId: userIdScopeParam.describe(
        "One person's own projection (only debts they own feed it); omit for the combined Household projection"
      ),
      horizonMonths: z
        .number()
        .int()
        .optional()
        .describe("How many months ahead to project (default 6)"),
      billOverrides: z
        .array(z.object({ billId: z.number().int(), amount: z.number() }))
        .optional()
        .describe(
          "What-if: override a specific bill's amount for this computation only, not persisted"
        ),
      discretionaryDeltaPercent: z
        .number()
        .optional()
        .describe(
          "What-if: scale the card-spend average by this percent (e.g. -10 for 10% less discretionary spend). No effect if cardSpendGoal is set (a goal is explicit, not scaled)."
        ),
      interestRateAnnualPercent: z
        .number()
        .optional()
        .describe(
          "What-if: override the annual interest rate on idle cash (default: persisted Selic-based rate)"
        ),
      cardSpendGoal: z
        .number()
        .optional()
        .describe(
          "What-if: override the card-spend goal for this computation only, without persisting it"
        ),
    },
  },
  async ({
    userId,
    horizonMonths,
    billOverrides,
    discretionaryDeltaPercent,
    interestRateAnnualPercent,
    cardSpendGoal,
  }) => {
    try {
      // Any what-if-only field present routes to POST /what-if instead of
      // the plain GET — same split routes/projections.ts itself makes.
      const isWhatIf =
        billOverrides != null ||
        discretionaryDeltaPercent != null ||
        interestRateAnnualPercent != null ||
        cardSpendGoal != null;
      if (isWhatIf) {
        return json(
          await apiFetch(`/api/projections/what-if${toQuery({ userId })}`, {
            method: "POST",
            body: JSON.stringify({
              horizonMonths,
              billOverrides,
              discretionaryDeltaPercent,
              interestRateAnnualPercent,
              cardSpendGoal,
            }),
          })
        );
      }
      return json(await apiFetch(`/api/projections${toQuery({ userId, horizonMonths })}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
