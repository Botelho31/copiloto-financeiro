import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings } from "shared";
import { apiFetch } from "../lib/api";

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<AppSettings>("/api/settings") });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AppSettings>) =>
      apiFetch<AppSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}
