import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SyncLogEntry } from "shared";
import { apiFetch, appendUserId } from "../lib/api";
import { usePersonScope } from "../lib/personScope";
import { invalidateKeys } from "../lib/queryInvalidation";

export function useSyncStatus() {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["sync", "status", activeUserId],
    queryFn: () =>
      apiFetch<{ lastSync: SyncLogEntry | null }>(appendUserId("/api/sync/status", activeUserId)),
  });
}

// Pass a userId to sync just that person (e.g. from /config); omit to sync
// everyone with Pluggy credentials on file.
export function useTriggerSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId?: number) =>
      apiFetch<{ started: boolean }>("/api/sync/run", {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () =>
      invalidateKeys(qc, [
        ["sync"],
        ["accounts"],
        ["transactions"],
        ["investments"],
        ["projections"],
      ]),
  });
}
