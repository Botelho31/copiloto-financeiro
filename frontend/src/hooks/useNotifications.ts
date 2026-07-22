import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Notification,
  NotificationProviderConfig,
  NotificationRuleSettings,
  ProviderTestResult,
} from "shared";
import { apiFetch, appendUserId } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

export function useNotifications(unreadOnly?: boolean) {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["notifications", activeUserId, unreadOnly ?? false],
    queryFn: () => {
      const base = appendUserId("/api/notifications", activeUserId);
      if (!unreadOnly) return apiFetch<Notification[]>(base);
      return apiFetch<Notification[]>(`${base}${base.includes("?") ? "&" : "?"}unreadOnly=true`);
    },
    // The bell has no other way to learn about a notification created by
    // the daily cron sync (which runs with nobody's browser open) — polling
    // is the simplest way to eventually reflect that without a websocket.
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: true }>(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useNotificationProviders(userId: number | null) {
  return useQuery({
    queryKey: ["notification-providers", userId],
    queryFn: () =>
      apiFetch<NotificationProviderConfig[]>(`/api/notifications/providers?userId=${userId}`),
    enabled: userId != null,
  });
}

export type UpsertProviderInput =
  | { userId: number; provider: "pushover"; config: { userKey: string }; enabled?: boolean }
  | { userId: number; provider: "email"; config: { address: string }; enabled?: boolean }
  | {
      userId: number;
      provider: "callmebot";
      config: { phone: string; apikey: string };
      enabled?: boolean;
    };

export function useUpsertNotificationProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertProviderInput) =>
      apiFetch<NotificationProviderConfig[]>("/api/notifications/providers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-providers"] }),
  });
}

export function useDeleteNotificationProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: true }>(`/api/notifications/providers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-providers"] }),
  });
}

export type TestProviderInput =
  | { providerId: number }
  | { provider: "pushover"; config: { userKey: string } }
  | { provider: "email"; config: { address: string } }
  | { provider: "callmebot"; config: { phone: string; apikey: string } };

export function useTestNotificationProvider() {
  return useMutation({
    mutationFn: (input: TestProviderInput) =>
      apiFetch<ProviderTestResult>("/api/notifications/providers/test", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

// Every saved row at once — household defaults (userId: null) and any
// per-person overrides — so the settings UI can render both without a
// round-trip per person.
export function useNotificationRules() {
  return useQuery({
    queryKey: ["notification-rules"],
    queryFn: () => apiFetch<NotificationRuleSettings[]>("/api/notifications/rules"),
  });
}

export interface UpdateRuleInput {
  key: string;
  // null = the household default; a specific id = that person's own override.
  userId: number | null;
  input: { enabled?: boolean; metadata?: Record<string, unknown> };
}

export function useUpdateNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, userId, input }: UpdateRuleInput) =>
      apiFetch<NotificationRuleSettings>(appendUserId(`/api/notifications/rules/${key}`, userId), {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

export interface DeleteRuleOverrideInput {
  key: string;
  userId: number | null;
}

// Removes the row for one exact scope — a person's override falls back to
// the household default (or schema defaults); the household row itself
// falls back straight to schema defaults.
export function useDeleteRuleOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, userId }: DeleteRuleOverrideInput) =>
      apiFetch<{ ok: true }>(appendUserId(`/api/notifications/rules/${key}`, userId), {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}
