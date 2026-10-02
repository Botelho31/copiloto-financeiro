import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppConfig } from "shared";
import { apiFetch } from "../lib/api";

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiFetch<AppConfig>("/api/app-config"),
  });
}

export interface AppConfigUpdateInput {
  minBuffer?: number;
}

export function useUpdateAppConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AppConfigUpdateInput) =>
      apiFetch<AppConfig>("/api/app-config", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (data) => qc.setQueryData(["app-config"], data),
  });
}
