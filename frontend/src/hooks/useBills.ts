import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bill } from "shared";
import { apiFetch } from "../lib/api";

export function useBills() {
  return useQuery({
    queryKey: ["bills"],
    queryFn: () => apiFetch<Bill[]>("/api/bills"),
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

export function useCreateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewBillInput) =>
      apiFetch<Bill[]>("/api/bills", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bills"] }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bills"] }),
  });
}

export function useDeleteBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<Bill[]>(`/api/bills/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bills"] }),
  });
}
