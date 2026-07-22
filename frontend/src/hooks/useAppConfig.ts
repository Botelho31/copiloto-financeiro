import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppConfig } from "shared";
import { apiFetch } from "../lib/api";

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiFetch<AppConfig>("/api/app-config"),
  });
}

// Blank secret fields mean "leave unchanged" (see services/appConfig.ts) —
// the caller can pass a partial update with only the fields that changed.
export interface AppConfigUpdateInput {
  cronSchedule?: string;
  minBuffer?: number;
  pushoverAppToken?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
}

export function useUpdateAppConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AppConfigUpdateInput) =>
      apiFetch<AppConfig>("/api/app-config", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (data) => qc.setQueryData(["app-config"], data),
  });
}
