import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Bill } from "shared";
import { apiFetch } from "../lib/api";
import { usePersonScope } from "../lib/personScope";
import { invalidateKeys } from "../lib/queryInvalidation";
import { useUserScopedList } from "./useUserScopedList";

export function useBills() {
  return useUserScopedList<Bill>("bills", "/api/bills");
}

// A bill linked to a debt reshapes that debt's payment plan, which in turn
// reshapes the projection's debt lines — every mutation below invalidates
// all three unconditionally rather than only when debtId is actually
// touched, since amount/cadence/confirmed changes on an already-linked
// bill matter too.
const BILL_MUTATION_INVALIDATES = [["bills"], ["debts"], ["projections"]];

export interface NewBillInput {
  name: string;
  categoryId?: number;
  expectedAmount: number;
  cadence: "weekly" | "monthly" | "quarterly" | "yearly" | "once";
  nextDueDate?: string;
  recurrenceStartDate?: string;
  recurrenceEndDate?: string;
  isCardExpense?: boolean;
  debtId?: number;
}

export function useCreateBill() {
  const queryClient = useQueryClient();
  const { activeUserId } = usePersonScope();
  return useMutation({
    mutationFn: (input: NewBillInput) => {
      if (activeUserId == null) {
        return Promise.reject(new Error("Select a person from the nav before adding a bill."));
      }
      return apiFetch<Bill[]>("/api/bills", {
        method: "POST",
        body: JSON.stringify({ ...input, userId: activeUserId }),
      });
    },
    onSuccess: () => invalidateKeys(queryClient, BILL_MUTATION_INVALIDATES),
  });
}

export type BillUpdateInput = Partial<{
  name: string;
  categoryId: number | null;
  expectedAmount: number;
  cadence: "weekly" | "monthly" | "quarterly" | "yearly" | "once";
  nextDueDate: string | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
  isCardExpense: boolean;
  confirmed: boolean;
  active: boolean;
  debtId: number | null;
}>;

export function useUpdateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: BillUpdateInput }) =>
      apiFetch<Bill[]>(`/api/bills/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => invalidateKeys(queryClient, BILL_MUTATION_INVALIDATES),
  });
}

export function useDeleteBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<Bill[]>(`/api/bills/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateKeys(queryClient, BILL_MUTATION_INVALIDATES),
  });
}
