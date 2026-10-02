import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface VaultStatus {
  hasVault: boolean;
  unlocked: boolean;
}

export interface ApiKey {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// Short poll, not just on-mount — this is the one piece of state that can
// change from *outside* React Query's normal mutation flow (another tab
// locking it, or the process restarting), and it gates the entire app.
export function useVaultStatus() {
  return useQuery({
    queryKey: ["vault-status"],
    queryFn: () => apiFetch<VaultStatus>("/api/vault/status"),
    refetchInterval: 10_000,
  });
}

export function useInvalidateVaultStatus() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["vault-status"] });
}

// Deliberately does NOT invalidate vault-status on success — the vault is
// technically unlocked server-side the instant this resolves, but the UI
// must not race ahead to the main app before the person has acknowledged
// saving the recovery code (see pages/VaultSetup.tsx). That screen calls
// useInvalidateVaultStatus itself, only once its own "I saved it" step is
// confirmed.
export function useSetupVault() {
  return useMutation({
    mutationFn: (password: string) =>
      apiFetch<{ recoveryCode: string }>("/api/vault/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  });
}

// Locking/unlocking themselves are NOT plain mutations — see
// lib/vaultTransition.tsx, which owns the API call, the vault-status cache
// update, and the full-page travelling-icon animation as one sequence (the
// cache update has to happen mid-animation, hidden behind the scrim, not
// the instant the request resolves).

export function useRegenerateRecoveryCode() {
  return useMutation({
    mutationFn: (password: string) =>
      apiFetch<{ recoveryCode: string }>("/api/vault/regenerate-recovery-code", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiFetch<{ ok: true }>("/api/vault/change-password", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiFetch<ApiKey[]>("/api/vault/api-keys"),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<ApiKey & { key: string }>("/api/vault/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/api/vault/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}
