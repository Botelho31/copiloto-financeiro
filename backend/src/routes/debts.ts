import { Elysia } from "elysia";
import { z } from "zod";
import { parseUserId } from "../lib/scope";
import {
  createDebt,
  deleteDebt,
  getDebtTransactions,
  linkDebtToDebt,
  linkTransactionsToDebt,
  listDebts,
  unlinkDebtFromDebt,
  unlinkTransactionsFromDebt,
  updateDebt,
} from "../services/debts";

const CreateDebtBody = z
  .object({
    name: z.string().min(1),
    direction: z.enum(["owed_by_me", "owed_to_me"]),
    counterparty: z.string().optional(),
    userId: z.number().int(),
    sharedWithUserId: z.number().int().optional(),
    principalAmount: z.number().optional(),
    splitPercentage: z.number().min(0).max(100).optional(),
    expectedTotalAmount: z.number().optional(),
    interestRateMonthlyPercent: z.number().optional(),
    startDate: z.string().min(1),
    targetPayoffDate: z.string().optional(),
    notes: z.string().optional(),
    matchingRule: z.string().optional(),
    loanType: z.enum(["price", "sac"]).optional(),
  })
  .refine((v) => v.principalAmount != null || v.splitPercentage != null, {
    message: "either principalAmount or splitPercentage is required",
  });

const UpdateDebtBody = z.object({
  name: z.string().optional(),
  status: z.enum(["active", "paid_off"]).optional(),
  counterparty: z.string().nullable().optional(),
  sharedWithUserId: z.number().int().nullable().optional(),
  startDate: z.string().optional(),
  targetPayoffDate: z.string().nullable().optional(),
  principalAmount: z.number().nullable().optional(),
  splitPercentage: z.number().min(0).max(100).nullable().optional(),
  expectedTotalAmount: z.number().nullable().optional(),
  interestRateMonthlyPercent: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  matchingRule: z.string().nullable().optional(),
  loanType: z.enum(["price", "sac"]).nullable().optional(),
  overrideAutomaticSchedule: z.boolean().optional(),
});

const LinkTransactionsBody = z.object({
  transactionIds: z.array(z.string()).min(1),
  role: z.enum(["borrow", "lend", "pay_off"]),
});

const UnlinkTransactionsBody = z.object({
  transactionIds: z.array(z.string()).min(1),
});

const LinkDebtBody = z.object({ childDebtId: z.number().int() });

export const debtsRoutes = new Elysia({ prefix: "/api/debts" })
  .get("/", ({ query }) => listDebts(parseUserId(query)))
  .get("/:id/transactions", ({ params }) => getDebtTransactions(Number(params.id)))
  .post(
    "/",
    ({ body, set, query }) => {
      try {
        createDebt(body);
        return listDebts(parseUserId(query));
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: CreateDebtBody }
  )
  .patch(
    "/:id",
    ({ params, body, set, query }) => {
      try {
        updateDebt(Number(params.id), body);
        return listDebts(parseUserId(query));
      } catch (error) {
        set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: UpdateDebtBody }
  )
  .delete("/:id", ({ params, query }) => {
    deleteDebt(Number(params.id));
    return listDebts(parseUserId(query));
  })
  .post(
    "/:id/link",
    ({ params, body, query }) => {
      linkTransactionsToDebt(Number(params.id), body.transactionIds, body.role);
      return listDebts(parseUserId(query));
    },
    { body: LinkTransactionsBody }
  )
  .post(
    "/:id/unlink",
    ({ params, body, query }) => {
      unlinkTransactionsFromDebt(Number(params.id), body.transactionIds);
      return listDebts(parseUserId(query));
    },
    { body: UnlinkTransactionsBody }
  )
  .post(
    "/:id/link-debt",
    ({ params, body, set, query }) => {
      try {
        linkDebtToDebt(Number(params.id), body.childDebtId);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
      return listDebts(parseUserId(query));
    },
    { body: LinkDebtBody }
  )
  .post(
    "/:id/unlink-debt",
    ({ params, body, query }) => {
      unlinkDebtFromDebt(Number(params.id), body.childDebtId);
      return listDebts(parseUserId(query));
    },
    { body: LinkDebtBody }
  );
