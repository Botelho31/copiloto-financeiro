import { useQuery } from "@tanstack/react-query";
import type { Account } from "shared";
import { apiFetch, appendUserId } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

export function useAccounts() {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["accounts", activeUserId],
    queryFn: () => apiFetch<Account[]>(appendUserId("/api/accounts", activeUserId)),
  });
}
