import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tag } from "shared";
import { apiFetch } from "../lib/api";

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<Tag[]>("/api/tags"),
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) =>
      apiFetch<Tag[]>("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name, color }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
}

export function useBulkTagTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionIds, tagId }: { transactionIds: string[]; tagId: number }) =>
      apiFetch<{ tagged: number }>("/api/tags/bulk-tag", {
        method: "POST",
        body: JSON.stringify({ transactionIds, tagId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });
}

export function useBulkUntagTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionIds, tagId }: { transactionIds: string[]; tagId: number }) =>
      apiFetch<{ untagged: number }>("/api/tags/bulk-untag", {
        method: "POST",
        body: JSON.stringify({ transactionIds, tagId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });
}
