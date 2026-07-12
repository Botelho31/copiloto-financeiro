import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings } from "shared";
import { apiFetch, appendUserId } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

// Household (no active person) has no single settings row — the backend
// just returns { cardSpendGoal: null } for that case.
export function useSettings() {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["settings", activeUserId],
    queryFn: () => apiFetch<AppSettings>(appendUserId("/api/settings", activeUserId)),
  });
}

// Explicit-userId variants for the Config page, where each person's row
// edits their own settings regardless of which person the global nav
// switcher currently has active.
export function useUserSettings(userId: number) {
  return useQuery({
    queryKey: ["settings", userId],
    queryFn: () => apiFetch<AppSettings>(appendUserId("/api/settings", userId)),
  });
}

export function useUpdateUserSettings(userId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AppSettings>) =>
      apiFetch<AppSettings>(appendUserId("/api/settings", userId), {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", userId] });
      qc.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  const { activeUserId } = usePersonScope();
  return useMutation({
    mutationFn: (input: Partial<AppSettings>) => {
      if (activeUserId == null) {
        return Promise.reject(new Error("Select a person from the nav before changing settings."));
      }
      return apiFetch<AppSettings>(appendUserId("/api/settings", activeUserId), {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}
