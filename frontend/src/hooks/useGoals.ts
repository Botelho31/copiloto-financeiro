import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Goal } from "shared";
import { apiFetch } from "../lib/api";
import { usePersonScope } from "../lib/personScope";
import { useUserScopedList } from "./useUserScopedList";

export function useGoals() {
  return useUserScopedList<Goal>("goals", "/api/goals");
}

export function useCreateGoal() {
  const qc = useQueryClient();
  const { activeUserId } = usePersonScope();
  return useMutation({
    mutationFn: (input: { name: string; targetAmount: number; targetDate: string }) => {
      if (activeUserId == null) {
        return Promise.reject(new Error("Select a person from the nav before adding a goal."));
      }
      return apiFetch<Goal[]>("/api/goals", {
        method: "POST",
        body: JSON.stringify({ ...input, userId: activeUserId }),
      });
    },
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
