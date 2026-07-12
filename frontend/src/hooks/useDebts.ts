import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Debt, DebtLinkedTransaction } from "shared";
import { apiFetch } from "../lib/api";
import { usePersonScope } from "../lib/personScope";
import { invalidateKeys } from "../lib/queryInvalidation";
import { useUserScopedList } from "./useUserScopedList";

export function useDebts() {
  return useUserScopedList<Debt>("debts", "/api/debts");
}

export function useDebtTransactions(debtId: number | undefined) {
  return useQuery({
    queryKey: ["debts", debtId, "transactions"],
    queryFn: () => apiFetch<DebtLinkedTransaction[]>(`/api/debts/${debtId}/transactions`),
    enabled: debtId !== undefined,
  });
}

export interface NewDebtInput {
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  counterparty?: string;
  // Set instead of counterparty when the other party is a real household
  // member (see useUsers) — e.g. a debt split_percentage-shared with them.
  sharedWithUserId?: number;
  principalAmount?: number;
  splitPercentage?: number;
  expectedTotalAmount?: number;
  startDate: string;
  targetPayoffDate?: string;
  loanType?: "price" | "sac";
  notes?: string;
  matchingRule?: string;
}

export function useCreateDebt() {
  const qc = useQueryClient();
  const { activeUserId } = usePersonScope();
  return useMutation({
    mutationFn: (input: NewDebtInput) => {
      if (activeUserId == null) {
        return Promise.reject(new Error("Select a person from the nav before adding a debt."));
      }
      return apiFetch<Debt[]>("/api/debts", {
        method: "POST",
        body: JSON.stringify({ ...input, userId: activeUserId }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["debts"] }),
  });
}

export function useUpdateDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Partial<{
        name: string;
        status: string;
        counterparty: string | null;
        sharedWithUserId: number | null;
        startDate: string;
        targetPayoffDate: string | null;
        principalAmount: number | null;
        splitPercentage: number | null;
        expectedTotalAmount: number | null;
        interestRateMonthlyPercent: number | null;
        loanType: "price" | "sac" | null;
        notes: string | null;
        matchingRule: string | null;
        overrideAutomaticSchedule: boolean;
      }>;
    }) => apiFetch<Debt[]>(`/api/debts/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    // A payment-plan change (linked bill, loan terms, rate) reshapes the
    // projection's debt lines, not just the debt record itself.
    onSuccess: () => invalidateKeys(qc, [["debts"], ["projections"]]),
  });
}

export function useDeleteDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<Debt[]>(`/api/debts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["debts"] }),
  });
}

export function useLinkTransactionsToDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      debtId,
      transactionIds,
      role,
    }: {
      debtId: number;
      transactionIds: string[];
      role: "borrow" | "lend" | "pay_off";
    }) =>
      apiFetch<Debt[]>(`/api/debts/${debtId}/link`, {
        method: "POST",
        body: JSON.stringify({ transactionIds, role }),
      }),
    onSuccess: (_data, vars) =>
      invalidateKeys(qc, [["debts"], ["debts", vars.debtId, "transactions"]]),
  });
}

export function useUnlinkTransactionsFromDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ debtId, transactionIds }: { debtId: number; transactionIds: string[] }) =>
      apiFetch<Debt[]>(`/api/debts/${debtId}/unlink`, {
        method: "POST",
        body: JSON.stringify({ transactionIds }),
      }),
    onSuccess: (_data, vars) =>
      invalidateKeys(qc, [["debts"], ["debts", vars.debtId, "transactions"]]),
  });
}

export function useLinkDebtToDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentDebtId, childDebtId }: { parentDebtId: number; childDebtId: number }) =>
      apiFetch<Debt[]>(`/api/debts/${parentDebtId}/link-debt`, {
        method: "POST",
        body: JSON.stringify({ childDebtId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["debts"] }),
  });
}

export function useUnlinkDebtFromDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentDebtId, childDebtId }: { parentDebtId: number; childDebtId: number }) =>
      apiFetch<Debt[]>(`/api/debts/${parentDebtId}/unlink-debt`, {
        method: "POST",
        body: JSON.stringify({ childDebtId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["debts"] }),
  });
}
