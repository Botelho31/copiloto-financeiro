import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bill } from "shared";
import { apiFetch, appendUserId } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

export function useBills() {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["bills", activeUserId],
    queryFn: () => apiFetch<Bill[]>(appendUserId("/api/bills", activeUserId)),
  });
}

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

// A bill linked to a debt (debtId) reshapes that debt's payment plan, which
// in turn reshapes the projection's debt lines — invalidate all three
// unconditionally rather than only when debtId is actually touched, since
// amount/cadence/confirmed changes on an already-linked bill matter too.
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      queryClient.invalidateQueries({ queryKey: ["debts"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      queryClient.invalidateQueries({ queryKey: ["debts"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

export function useDeleteBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<Bill[]>(`/api/bills/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      queryClient.invalidateQueries({ queryKey: ["debts"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}
