import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transaction } from "shared";
import { z } from "zod";
import { db } from "./db";
import { listAccounts } from "./routes/accounts";
import { listBills } from "./routes/bills";
import { createCategory, getUncategorizedGroups, listCategories, listRules } from "./routes/categories";
import {
  getDebtTransactions,
  linkDebtToDebt,
  linkTransactionsToDebt,
  listDebts,
  unlinkDebtFromDebt,
} from "./routes/debts";
import { listGoals } from "./routes/goals";
import { listInvestments } from "./routes/investments";
import { getSettings } from "./routes/settings";
import { getLastSync } from "./routes/sync";
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
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  };
}

const server = new McpServer({ name: "budget-tracker", version: "1.0.0" });

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
    },
  },
  async ({ days }) => json(getUncategorizedGroups(days ?? 30))
);

server.registerTool(
  "categorize",
  {
    description:
      "Create or update a category rule and retroactively apply it to every currently-Uncategorized transaction whose normalized description contains the match text. Prefer specific match text over broad terms: a broad rule applied first can steal transactions a later, more specific rule should have caught.",
    inputSchema: {
      matchText: z
        .string()
        .describe("Text to match against transaction descriptions (case/accent-insensitive substring)"),
      categoryName: z.string().describe("Exact existing category name, e.g. 'Transport', 'Shopping'"),
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
    const existing = db.query("SELECT id FROM categories WHERE id = ?").get(id);
    if (!existing) return errorResult(`Category ${id} not found`);

    const fields: string[] = [];
    const values: unknown[] = [];
    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (color !== undefined) {
      fields.push("color = ?");
      values.push(color);
    }
    if (excludesFromCashflow !== undefined) {
      fields.push("excludes_from_cashflow = ?");
      values.push(excludesFromCashflow ? 1 : 0);
    }
    if (fields.length > 0) {
      values.push(id);
      db.query(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
    }
    return json(listCategories());
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
    description: "Apply a tag to a set of transactions (use list_transactions or search to find IDs first).",
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
        .describe("JS RegExp (case-insensitive) against the raw description — applied after the SQL filters"),
      limit: z.number().int().positive().max(5000).optional().describe("Default 200"),
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
  }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
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

server.registerTool(
  "list_accounts",
  { description: "List all synced BANK/CREDIT accounts with current balances." },
  async () => json(listAccounts())
);

server.registerTool(
  "list_investments",
  {
    description:
      "List synced investment holdings (Pluggy's separate Investments API, not Accounts). Only status='ACTIVE' rows are current holdings — 'TOTAL_WITHDRAWAL' means already redeemed.",
  },
  async () => json(listInvestments())
);

server.registerTool(
  "list_bills",
  { description: "List recurring bills (manual + auto-detected), including pending/unconfirmed ones." },
  async () => json(listBills())
);

server.registerTool(
  "create_bill",
  {
    description: "Create a new recurring bill (manual source, confirmed and active by default).",
    inputSchema: {
      name: z.string(),
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
    categoryName,
    expectedAmount,
    cadence,
    nextDueDate,
    recurrenceStartDate,
    recurrenceEndDate,
    isCardExpense,
    debtName,
  }) => {
    let categoryId: number | null = null;
    if (categoryName) {
      const row = db.query("SELECT id FROM categories WHERE name = ?").get(categoryName) as
        | { id: number }
        | null;
      if (!row) return errorResult(`Unknown category "${categoryName}"`);
      categoryId = row.id;
    }
    let debtId: number | null = null;
    if (debtName) {
      const row = db.query("SELECT id FROM debts WHERE name = ?").get(debtName) as
        | { id: number }
        | null;
      if (!row) return errorResult(`Unknown debt "${debtName}"`);
      debtId = row.id;
    }
    db.query(
      `INSERT INTO recurring_bills (name, category_id, expected_amount, cadence, next_due_date, recurrence_start_date, recurrence_end_date, is_card_expense, debt_id, source, confirmed, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, 1)`
    ).run(
      name,
      categoryId,
      expectedAmount,
      cadence,
      nextDueDate ?? null,
      recurrenceStartDate ?? null,
      recurrenceEndDate ?? null,
      isCardExpense ? 1 : 0,
      debtId
    );
    return json(listBills());
  }
);

server.registerTool(
  "update_bill",
  {
    description: "Update a bill — confirm/dismiss a detected candidate, change amount/cadence/category, etc.",
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
  }) => {
    const existing = db.query("SELECT id FROM recurring_bills WHERE id = ?").get(id);
    if (!existing) return errorResult(`Bill ${id} not found`);

    const fields: string[] = [];
    const values: unknown[] = [];
    if (debtName !== undefined) {
      if (debtName === null) {
        fields.push("debt_id = ?");
        values.push(null);
      } else {
        const row = db.query("SELECT id FROM debts WHERE name = ?").get(debtName) as
          | { id: number }
          | null;
        if (!row) return errorResult(`Unknown debt "${debtName}"`);
        fields.push("debt_id = ?");
        values.push(row.id);
      }
    }
    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (categoryName !== undefined) {
      const row = db.query("SELECT id FROM categories WHERE name = ?").get(categoryName) as
        | { id: number }
        | null;
      if (!row) return errorResult(`Unknown category "${categoryName}"`);
      fields.push("category_id = ?");
      values.push(row.id);
    }
    if (expectedAmount !== undefined) {
      fields.push("expected_amount = ?");
      values.push(expectedAmount);
    }
    if (cadence !== undefined) {
      fields.push("cadence = ?");
      values.push(cadence);
    }
    if (nextDueDate !== undefined) {
      fields.push("next_due_date = ?");
      values.push(nextDueDate);
    }
    if (recurrenceStartDate !== undefined) {
      fields.push("recurrence_start_date = ?");
      values.push(recurrenceStartDate);
    }
    if (recurrenceEndDate !== undefined) {
      fields.push("recurrence_end_date = ?");
      values.push(recurrenceEndDate);
    }
    if (isCardExpense !== undefined) {
      fields.push("is_card_expense = ?");
      values.push(isCardExpense ? 1 : 0);
    }
    if (confirmed !== undefined) {
      fields.push("confirmed = ?");
      values.push(confirmed ? 1 : 0);
    }
    if (active !== undefined) {
      fields.push("active = ?");
      values.push(active ? 1 : 0);
    }
    if (fields.length > 0) {
      values.push(id);
      db.query(`UPDATE recurring_bills SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
    }
    return json(listBills());
  }
);

server.registerTool(
  "delete_bill",
  {
    description: "Delete a bill and its recurring-match history.",
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => {
    db.query("DELETE FROM recurring_bill_matches WHERE recurring_bill_id = ?").run(id);
    db.query("DELETE FROM recurring_bills WHERE id = ?").run(id);
    return json(listBills());
  }
);

server.registerTool(
  "get_sync_status",
  { description: "Get the most recent Pluggy sync log entry." },
  async () => json(getLastSync())
);

server.registerTool(
  "trigger_sync",
  {
    description:
      "Manually trigger a Pluggy sync (pulls latest accounts/transactions/investments, then runs recurring-bill and self-transfer detection). No-ops if a sync is already running.",
  },
  async () => json(await triggerSync("mcp"))
);

server.registerTool(
  "detect_recurring_bills",
  { description: "Re-scan transaction history for recurring-bill candidates (normally runs automatically after each sync)." },
  async () => {
    const created = detectRecurringBills();
    return json({ created });
  }
);

server.registerTool(
  "detect_self_transfers",
  {
    description:
      "Re-scan for transfers between your own BANK accounts (normally runs automatically after each sync).",
  },
  async () => {
    const pairs = detectSelfTransfers();
    return json({ pairs });
  }
);

server.registerTool(
  "list_debts",
  {
    description:
      "List debts (money borrowed or lent) with computed totals: principal, total_paid, remaining, percent_complete, interest_paid_so_far, plus payment_plan (how each debt's expected payment is calculated: loan formula, linked payment bill, history-inferred, or none).",
  },
  async () => json(listDebts())
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
      direction: z
        .enum(["owed_by_me", "owed_to_me"])
        .describe("owed_by_me = you borrowed; owed_to_me = you lent"),
      counterparty: z.string().optional(),
      principalAmount: z.number().optional(),
      splitPercentage: z.number().min(0).max(100).optional(),
      expectedTotalAmount: z.number().optional().describe("Total incl. interest, if known"),
      interestRateMonthlyPercent: z
        .number()
        .optional()
        .describe("Real per-month rate the loan carries (e.g. from a bank statement), for reference only"),
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
            "> R$1,000 → pay_off; her allowance (≤R$1,000) is not part of this debt.\" Set this so " +
            "future debt-state updates can be applied exactly, without re-deriving the rule."
        ),
    },
  },
  async (input) => {
    if (input.principalAmount == null && input.splitPercentage == null) {
      return errorResult("either principalAmount or splitPercentage is required");
    }
    db.query(
      `INSERT INTO debts (name, direction, counterparty, principal_amount, split_percentage, expected_total_amount, interest_rate_monthly_percent, start_date, target_payoff_date, notes, matching_rule, loan_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.name,
      input.direction,
      input.counterparty ?? null,
      input.principalAmount ?? null,
      input.splitPercentage ?? null,
      input.expectedTotalAmount ?? null,
      input.interestRateMonthlyPercent ?? null,
      input.startDate,
      input.targetPayoffDate ?? null,
      input.notes ?? null,
      input.matchingRule ?? null,
      input.loanType ?? null
    );
    return json(listDebts());
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
  async ({
    id,
    status,
    startDate,
    targetPayoffDate,
    principalAmount,
    splitPercentage,
    expectedTotalAmount,
    interestRateMonthlyPercent,
    loanType,
    notes,
    matchingRule,
    overrideAutomaticSchedule,
  }) => {
    const existing = db.query("SELECT id FROM debts WHERE id = ?").get(id);
    if (!existing) return errorResult(`Debt ${id} not found`);
    const fields: string[] = [];
    const values: unknown[] = [];
    if (overrideAutomaticSchedule !== undefined) {
      fields.push("override_automatic_schedule = ?");
      values.push(overrideAutomaticSchedule ? 1 : 0);
    }
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }
    if (splitPercentage !== undefined) {
      fields.push("split_percentage = ?");
      values.push(splitPercentage);
    }
    if (startDate !== undefined) {
      fields.push("start_date = ?");
      values.push(startDate);
    }
    if (targetPayoffDate !== undefined) {
      fields.push("target_payoff_date = ?");
      values.push(targetPayoffDate);
    }
    if (principalAmount !== undefined) {
      fields.push("principal_amount = ?");
      values.push(principalAmount);
    }
    if (expectedTotalAmount !== undefined) {
      fields.push("expected_total_amount = ?");
      values.push(expectedTotalAmount);
    }
    if (matchingRule !== undefined) {
      fields.push("matching_rule = ?");
      values.push(matchingRule);
    }
    if (interestRateMonthlyPercent !== undefined) {
      fields.push("interest_rate_monthly_percent = ?");
      values.push(interestRateMonthlyPercent);
    }
    if (loanType !== undefined) {
      fields.push("loan_type = ?");
      values.push(loanType);
    }
    if (notes !== undefined) {
      fields.push("notes = ?");
      values.push(notes);
    }
    if (fields.length > 0) {
      values.push(id);
      db.query(`UPDATE debts SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
    }
    return json(listDebts());
  }
);

server.registerTool(
  "delete_debt",
  {
    description: "Delete a debt and its transaction links.",
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => {
    db.query("DELETE FROM debt_transactions WHERE debt_id = ?").run(id);
    db.query("DELETE FROM debts WHERE id = ?").run(id);
    return json(listDebts());
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
    },
  },
  async ({ debtId, transactionIds, role }) => {
    linkTransactionsToDebt(debtId, transactionIds, role);
    return json(listDebts());
  }
);

server.registerTool(
  "unlink_transactions_from_debt",
  {
    description: "Remove transactions from a debt.",
    inputSchema: { debtId: z.number().int(), transactionIds: z.array(z.string()) },
  },
  async ({ debtId, transactionIds }) => {
    const placeholders = transactionIds.map(() => "?").join(",");
    db.query(
      `DELETE FROM debt_transactions WHERE debt_id = ? AND transaction_id IN (${placeholders})`
    ).run(debtId, ...transactionIds);
    return json(listDebts());
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
    },
  },
  async ({ parentDebtId, childDebtId }) => {
    try {
      linkDebtToDebt(parentDebtId, childDebtId);
      return json(listDebts());
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
    },
  },
  async ({ parentDebtId, childDebtId }) => {
    unlinkDebtFromDebt(parentDebtId, childDebtId);
    return json(listDebts());
  }
);

server.registerTool(
  "list_goals",
  {
    description:
      "List savings goals with computed feasibility: required_monthly_savings (to hit the target by the date) vs projected_monthly_savings (from recent baseline + confirmed bills), and on_track.",
  },
  async () => json(listGoals())
);

server.registerTool(
  "create_goal",
  {
    description: "Create a savings goal — a target net-worth amount by a date.",
    inputSchema: {
      name: z.string(),
      targetAmount: z.number(),
      targetDate: z.string().describe("ISO date"),
    },
  },
  async ({ name, targetAmount, targetDate }) => {
    db.query("INSERT INTO goals (name, target_amount, target_date) VALUES (?, ?, ?)").run(
      name,
      targetAmount,
      targetDate
    );
    return json(listGoals());
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
    },
  },
  async ({ id, name, targetAmount, targetDate }) => {
    const existing = db.query("SELECT id FROM goals WHERE id = ?").get(id);
    if (!existing) return errorResult(`Goal ${id} not found`);

    const fields: string[] = [];
    const values: unknown[] = [];
    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (targetAmount !== undefined) {
      fields.push("target_amount = ?");
      values.push(targetAmount);
    }
    if (targetDate !== undefined) {
      fields.push("target_date = ?");
      values.push(targetDate);
    }
    if (fields.length > 0) {
      values.push(id);
      db.query(`UPDATE goals SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
    }
    return json(listGoals());
  }
);

server.registerTool(
  "delete_goal",
  { description: "Delete a savings goal.", inputSchema: { id: z.number().int() } },
  async ({ id }) => {
    db.query("DELETE FROM goals WHERE id = ?").run(id);
    return json(listGoals());
  }
);

server.registerTool(
  "get_settings",
  { description: "Get global app settings — currently just cardSpendGoal, the persisted monthly credit card spending target used by projections and shown on the Dashboard." },
  async () => json(getSettings())
);

server.registerTool(
  "update_settings",
  {
    description:
      "Update global app settings. Set cardSpendGoal to a number to persist a standing monthly card-spend target (replaces the 3-month actual average everywhere it's used); set it to null to clear the goal and fall back to the average.",
    inputSchema: {
      cardSpendGoal: z.number().nullable().optional(),
    },
  },
  async ({ cardSpendGoal }) => {
    if (cardSpendGoal !== undefined) {
      if (cardSpendGoal === null) {
        db.query("DELETE FROM app_settings WHERE key = 'cardSpendGoal'").run();
      } else {
        db.query(
          "INSERT INTO app_settings (key, value) VALUES ('cardSpendGoal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(String(cardSpendGoal));
      }
    }
    return json(getSettings());
  }
);

server.registerTool(
  "get_projections",
  {
    description:
      "Compute the cash-flow projection: starting balance, then month by month, built from confirmed bills (income + expense), each active debt's own repayment schedule, a 3-month average (or persisted goal) of card spend, and compounding interest on idle cash. Each month's bills[] line item is tagged kind: bill/debt/interest/cardSpend, and cardExpenseBills[] lists bills flagged is_card_expense (already folded into the cardSpend line, shown separately here for visibility, not double-counted in net).",
    inputSchema: {
      horizonMonths: z.number().int().optional().describe("How many months ahead to project (default 6)"),
      billOverrides: z
        .array(z.object({ billId: z.number().int(), amount: z.number() }))
        .optional()
        .describe("What-if: override a specific bill's amount for this computation only, not persisted"),
      discretionaryDeltaPercent: z
        .number()
        .optional()
        .describe("What-if: scale the card-spend average by this percent (e.g. -10 for 10% less discretionary spend). No effect if cardSpendGoal is set (a goal is explicit, not scaled)."),
      interestRateAnnualPercent: z
        .number()
        .optional()
        .describe("What-if: override the annual interest rate on idle cash (default: persisted Selic-based rate)"),
      cardSpendGoal: z
        .number()
        .optional()
        .describe("What-if: override the card-spend goal for this computation only, without persisting it"),
    },
  },
  async ({ horizonMonths, billOverrides, discretionaryDeltaPercent, interestRateAnnualPercent, cardSpendGoal }) =>
    json(
      computeProjection({
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
