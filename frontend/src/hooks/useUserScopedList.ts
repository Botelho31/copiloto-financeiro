import { useQuery } from "@tanstack/react-query";
import { apiFetch, appendUserId } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

// The list-fetch shape repeated across every person-scoped resource
// (accounts, investments, bills, goals, debts, ...): read the ambient
// nav-switcher scope, fetch the resource filtered to that person (or
// everyone, for Household), and cache per-person so switching people
// doesn't show a stale list while the new one loads.
export function useUserScopedList<T>(resource: string, path: string) {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: [resource, activeUserId],
    queryFn: () => apiFetch<T[]>(appendUserId(path, activeUserId)),
  });
}
