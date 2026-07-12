import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Transaction } from "shared";
import { apiFetch } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

export interface TransactionFilters {
  from?: string;
  to?: string;
  categoryId?: number;
  accountId?: string;
  tagId?: number;
}

function toQueryString(filters: TransactionFilters, userId: number | null): string {
  const params = new URLSearchParams();
  if (userId != null) params.set("userId", String(userId));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.categoryId) params.set("categoryId", String(filters.categoryId));
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.tagId) params.set("tagId", String(filters.tagId));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useTransactions(filters: TransactionFilters = {}) {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["transactions", activeUserId, filters],
    queryFn: () =>
      apiFetch<Transaction[]>(`/api/transactions${toQueryString(filters, activeUserId)}`),
  });
}

export function useEarliestTransactionDate() {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["transactions", activeUserId, "earliest-date"],
    queryFn: () =>
      apiFetch<{ date: string | null }>(
        `/api/transactions/earliest-date${toQueryString({}, activeUserId)}`
      ),
  });
}

// Searches across all history (not the currently-selected period) — for
// fast ad-hoc categorization: search a vendor fragment, label every match.
export function useSearchTransactions(query: string) {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["transactions", activeUserId, "search", query],
    queryFn: () =>
      apiFetch<Transaction[]>(
        `/api/transactions/search?q=${encodeURIComponent(query)}${
          activeUserId != null ? `&userId=${activeUserId}` : ""
        }`
      ),
    enabled: query.trim().length > 0,
  });
}

export function useUpdateTransactionCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      categoryId,
      createRule,
    }: {
      id: string;
      categoryId: number;
      createRule?: boolean;
    }) =>
      apiFetch<{ ok: true }>(`/api/transactions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ categoryId, createRule }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["categories", "uncategorized-groups"] });
      queryClient.invalidateQueries({ queryKey: ["categories", "rules"] });
    },
  });
}

export function useBulkCategorizeTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      transactionIds,
      categoryId,
    }: {
      transactionIds: string[];
      categoryId: number;
    }) =>
      apiFetch<{ updated: number }>("/api/transactions/bulk-categorize", {
        method: "POST",
        body: JSON.stringify({ transactionIds, categoryId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["categories", "uncategorized-groups"] });
    },
  });
}
