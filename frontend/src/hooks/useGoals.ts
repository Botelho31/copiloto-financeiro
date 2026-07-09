import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Goal } from "shared";
import { apiFetch } from "../lib/api";

export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: () => apiFetch<Goal[]>("/api/goals") });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; targetAmount: number; targetDate: string }) =>
      apiFetch<Goal[]>("/api/goals", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Partial<{ name: string; targetAmount: number; targetDate: string }>;
    }) => apiFetch<Goal[]>(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<Goal[]>(`/api/goals/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
