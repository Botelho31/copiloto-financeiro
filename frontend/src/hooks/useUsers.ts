import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "shared";
import { apiFetch } from "../lib/api";

export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => apiFetch<User[]>("/api/users") });
}

export interface NewUserInput {
  name: string;
  color?: string;
  pluggyClientId?: string;
  pluggyClientSecret?: string;
  pluggyItemIds?: string;
}

// A person's existence/credentials affect sync and every scoped view, not
// just the people list — invalidate broadly.
function invalidatePersonScoped(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["users"] });
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["bills"] });
  qc.invalidateQueries({ queryKey: ["debts"] });
  qc.invalidateQueries({ queryKey: ["goals"] });
  qc.invalidateQueries({ queryKey: ["investments"] });
  qc.invalidateQueries({ queryKey: ["projections"] });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewUserInput) =>
      apiFetch<User[]>("/api/users", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidatePersonScoped(qc),
  });
}

export type UserUpdateInput = Partial<{
  name: string;
  color: string;
  pluggyClientId: string | null;
  pluggyClientSecret: string;
  pluggyItemIds: string | null;
}>;

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UserUpdateInput }) =>
      apiFetch<User[]>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => invalidatePersonScoped(qc),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<User[]>(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidatePersonScoped(qc),
  });
}
