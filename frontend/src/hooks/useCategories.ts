import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CategoryRule, UncategorizedGroup } from "shared";
import { apiFetch } from "../lib/api";
import { invalidateKeys } from "../lib/queryInvalidation";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("/api/categories"),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      kind,
      color,
    }: {
      name: string;
      kind?: "income" | "expense";
      color?: string;
    }) =>
      apiFetch<Category[]>("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name, kind, color }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useCategoryRules() {
  return useQuery({
    queryKey: ["categories", "rules"],
    queryFn: () => apiFetch<CategoryRule[]>("/api/categories/rules"),
  });
}

export function useUncategorizedGroups(days?: number) {
  return useQuery({
    queryKey: ["categories", "uncategorized-groups", days],
    queryFn: () =>
      apiFetch<UncategorizedGroup[]>(
        `/api/categories/uncategorized-groups${days ? `?days=${days}` : ""}`
      ),
  });
}

export function useBulkAssignCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, categoryId }: { key: string; categoryId: number }) =>
      apiFetch<{ updated: number }>("/api/categories/bulk-assign", {
        method: "POST",
        body: JSON.stringify({ key, categoryId }),
      }),
    onSuccess: () =>
      invalidateKeys(queryClient, [
        ["transactions"],
        ["categories", "uncategorized-groups"],
        ["categories", "rules"],
      ]),
  });
}

export function useCreateCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchText, categoryId }: { matchText: string; categoryId: number }) =>
      apiFetch<CategoryRule[]>("/api/categories/rules", {
        method: "POST",
        body: JSON.stringify({ matchText, categoryId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories", "rules"] }),
  });
}

export function useDeleteCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<CategoryRule[]>(`/api/categories/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories", "rules"] }),
  });
}
