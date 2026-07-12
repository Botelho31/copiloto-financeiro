import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transaction } from "shared";
import { z } from "zod";
import { db } from "./db";
import { listAccounts } from "./routes/accounts";
import { createBill, deleteBill, listBills, updateBill } from "./routes/bills";
import {
  createCategory,
  getUncategorizedGroups,
  listCategories,
  listRules,
  updateCategory,
} from "./routes/categories";
import {
  createDebt,
  deleteDebt,
  getDebtTransactions,
  linkDebtToDebt,
  linkTransactionsToDebt,
  listDebts,
  unlinkDebtFromDebt,
  updateDebt,
} from "./services/debts";
import { createGoal, deleteGoal, listGoals, updateGoal } from "./routes/goals";
import { listInvestments } from "./routes/investments";
import { getSettings, updateSettings } from "./routes/settings";
import { getLastSync } from "./routes/sync";
import { createUser, deleteUser, listUsers, updateUser } from "./routes/users";
import { computeProjection } from "./services/projectionEngine";
import { bulkTag, bulkUntag, createTag, listTags } from "./routes/tags";
import { detectRecurringBills } from "./jobs/recurringDetection";
import { detectSelfTransfers } from "./jobs/transferDetection";
import { triggerSync } from "./jobs/dailySync";
import {
  applyCategoryRule,
  bulkSetCategory,
  reclassifyMatching,
  setTransactionCategory,
} from "./services/categorization";

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
  async () => json(listUsers())
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
      return json(createUser(input));
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
      return json(updateUser(id, input));
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
      return json(deleteUser(id));
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
  async () => json(listCategories())
);

server.registerTool(
  "list_category_rules",
  {
    description:
      "List all category_rules (substring match against normalized descriptions -> category), applied automatically to new transactions during sync.",
  },
  async () => json(listRules())
);

server.registerTool(
  "delete_category_rule",
  {
    description:
      "Delete a category_rule by id (see list_category_rules) — stops it from auto-categorizing future transactions. Doesn't change any transaction's existing category.",
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => {
    db.query("DELETE FROM category_rules WHERE id = ?").run(id);
    return json(listRules());
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
  async ({ days, userId }) => json(getUncategorizedGroups(days ?? 30, userId ?? null))
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
      return json(applyCategoryRule(matchText, categoryName));
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
  async ({ name, kind, color }) => {
    try {
      return json(createCategory(name, kind, color));
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
  async ({ id, name, color, excludesFromCashflow }) => {
    try {
      return json(updateCategory(id, { name, color, excludesFromCashflow }));
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
  async () => json(listTags())
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
  async ({ name, color }) => {
    try {
      return json(createTag(name, color));
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
  async ({ transactionIds, tagId }) => json({ tagged: bulkTag(transactionIds, tagId) })
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
  async ({ transactionIds, tagId }) => json({ untagged: bulkUntag(transactionIds, tagId) })
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
      setTransactionCategory(transactionId, categoryName);
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
  async ({ transactionIds, categoryName }) => {
    try {
      const updated = bulkSetCategory(transactionIds, categoryName);
      return json({ updated });
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
  async ({ matchText, categoryName }) => {
    try {
      return json(reclassifyMatching(matchText, categoryName));
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
  async ({
    from,
    to,
    categoryName,
    accountId,
    tagId,
    uncategorizedOnly,
    descriptionContains,
    descriptionRegex,
    limit,
    userId,
  }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (userId != null) {
      conditions.push("t.user_id = ?");
      params.push(userId);
    }
    if (from) {
      conditions.push("t.date >= ?");
      params.push(from);
    }
    if (to) {
      conditions.push("t.date < ?");
      params.push(to);
    }
    if (accountId) {
      conditions.push("t.account_id = ?");
      params.push(accountId);
    }
    if (categoryName) {
      conditions.push("c.name = ?");
      params.push(categoryName);
    }
    if (tagId) {
      conditions.push("t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id = ?)");
      params.push(tagId);
    }
    if (uncategorizedOnly) {
      conditions.push("c.name = 'Uncategorized'");
    }
    if (descriptionContains) {
      conditions.push("t.description LIKE ?");
      params.push(`%${descriptionContains}%`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    // When regex-filtering, don't apply LIMIT in SQL — it would truncate
    // before the regex ever runs. Cap the regex-filtered result instead.
    const sqlLimit = descriptionRegex ? undefined : (limit ?? 200);
    const allParams: unknown[] = sqlLimit ? [...params, sqlLimit] : params;
    let rows = db
      .query(
        `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                t.category_id, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         ${where}
         ORDER BY t.date DESC
         ${sqlLimit ? "LIMIT ?" : ""}`
      )
      .all(...(allParams as [])) as Transaction[];
    if (descriptionRegex) {
      const re = new RegExp(descriptionRegex, "i");
      rows = rows.filter((t) => re.test(t.description)).slice(0, limit ?? 200);
    }
    return json(rows);
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
  async ({ userId }) => json(listAccounts(userId ?? null))
);

server.registerTool(
  "list_investments",
  {
    description:
      "List synced investment holdings (Pluggy's separate Investments API, not Accounts). Only status='ACTIVE' rows are current holdings — 'TOTAL_WITHDRAWAL' means already redeemed.",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => json(listInvestments(userId ?? null))
);

server.registerTool(
  "list_bills",
  {
    description:
      "List recurring bills (manual + auto-detected), including pending/unconfirmed ones.",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => json(listBills(userId ?? null))
);

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
  async ({
    name,
    userId,
    categoryName,
    expectedAmount,
    cadence,
    nextDueDate,
    recurrenceStartDate,
    recurrenceEndDate,
    isCardExpense,
    debtName,
  }) => {
    let categoryId: number | undefined;
    if (categoryName) {
      const row = db.query("SELECT id FROM categories WHERE name = ?").get(categoryName) as {
        id: number;
      } | null;
      if (!row) return errorResult(`Unknown category "${categoryName}"`);
      categoryId = row.id;
    }
    let debtId: number | undefined;
    if (debtName) {
      const row = db.query("SELECT id FROM debts WHERE name = ?").get(debtName) as {
        id: number;
      } | null;
      if (!row) return errorResult(`Unknown debt "${debtName}"`);
      debtId = row.id;
    }
    try {
      createBill({
        name,
        userId,
        categoryId,
        expectedAmount,
        cadence,
        nextDueDate,
        recurrenceStartDate,
        recurrenceEndDate,
        isCardExpense,
        debtId,
      });
      return json(listBills(userId));
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
  async ({
    id,
    name,
    categoryName,
    expectedAmount,
    cadence,
    nextDueDate,
    recurrenceStartDate,
    recurrenceEndDate,
    isCardExpense,
    debtName,
    confirmed,
    active,
    userId,
  }) => {
    let categoryId: number | undefined;
    if (categoryName !== undefined) {
      const row = db.query("SELECT id FROM categories WHERE name = ?").get(categoryName) as {
        id: number;
      } | null;
      if (!row) return errorResult(`Unknown category "${categoryName}"`);
      categoryId = row.id;
    }
    let debtId: number | null | undefined;
    if (debtName !== undefined) {
      if (debtName === null) {
        debtId = null;
      } else {
        const row = db.query("SELECT id FROM debts WHERE name = ?").get(debtName) as {
          id: number;
        } | null;
        if (!row) return errorResult(`Unknown debt "${debtName}"`);
        debtId = row.id;
      }
    }
    try {
      updateBill(id, {
        name,
        categoryId,
        expectedAmount,
        cadence,
        nextDueDate,
        recurrenceStartDate,
        recurrenceEndDate,
        isCardExpense,
        debtId,
        confirmed,
        active,
      });
      return json(listBills(userId ?? null));
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
    deleteBill(id);
    return json(listBills(userId ?? null));
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
  async ({ userId }) => json(getLastSync(userId ?? null))
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
  async ({ userId }) => json(await triggerSync("mcp", userId))
);

server.registerTool(
  "detect_recurring_bills",
  {
    description:
      "Re-scan one person's transaction history for recurring-bill candidates (normally runs automatically after each sync).",
    inputSchema: { userId: z.number().int().describe("Which person to scan (see list_users)") },
  },
  async ({ userId }) => {
    const created = detectRecurringBills(userId);
    return json({ created });
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
    const pairs = detectSelfTransfers(userId);
    return json({ pairs });
  }
);

server.registerTool(
  "list_debts",
  {
    description:
      "List debts (money borrowed or lent) with computed totals: principal, total_paid, remaining, percent_complete, interest_paid_so_far, plus payment_plan (how each debt's expected payment is calculated: loan formula, linked payment bill, history-inferred, or none). Scoped to one person, a debt shows whether they own it or are the sharedWithUserId party (isOwner distinguishes the two).",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => json(listDebts(userId ?? null))
);

server.registerTool(
  "get_debt_transactions",
  {
    description: "List the transactions linked to a debt, with their role (borrow/lend/pay_off).",
    inputSchema: { debtId: z.number().int() },
  },
  async ({ debtId }) => json(getDebtTransactions(debtId))
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
  async (input) => {
    try {
      createDebt(input);
      return json(listDebts(input.userId));
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
      updateDebt(id, input);
      return json(listDebts(userId ?? null));
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
    deleteDebt(id);
    return json(listDebts(userId ?? null));
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
    linkTransactionsToDebt(debtId, transactionIds, role);
    return json(listDebts(userId ?? null));
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
    const placeholders = transactionIds.map(() => "?").join(",");
    db.query(
      `DELETE FROM debt_transactions WHERE debt_id = ? AND transaction_id IN (${placeholders})`
    ).run(debtId, ...transactionIds);
    return json(listDebts(userId ?? null));
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
      linkDebtToDebt(parentDebtId, childDebtId);
      return json(listDebts(userId ?? null));
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
    unlinkDebtFromDebt(parentDebtId, childDebtId);
    return json(listDebts(userId ?? null));
  }
);

server.registerTool(
  "list_goals",
  {
    description:
      "List savings goals with computed feasibility: required_monthly_savings (to hit the target by the date) vs projected_monthly_savings (from recent baseline + confirmed bills), and on_track.",
    inputSchema: { userId: userIdScopeParam },
  },
  async ({ userId }) => json(listGoals(userId ?? null))
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
  async ({ name, userId, targetAmount, targetDate }) => {
    try {
      createGoal({ name, userId, targetAmount, targetDate });
      return json(listGoals(userId));
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
  async ({ id, name, targetAmount, targetDate, userId }) => {
    try {
      updateGoal(id, { name, targetAmount, targetDate });
      return json(listGoals(userId ?? null));
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
    deleteGoal(id);
    return json(listGoals(userId ?? null));
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
  async ({ userId }) => json(getSettings(userId))
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
  async ({ userId, cardSpendGoal }) => json(updateSettings(userId, { cardSpendGoal }))
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
  }) =>
    json(
      computeProjection({
        userId: userId ?? null,
        horizonMonths,
        billOverrides,
        discretionaryDeltaPercent,
        interestRateAnnualPercent,
        cardSpendGoal,
      })
    )
);

const transport = new StdioServerTransport();
await server.connect(transport);
