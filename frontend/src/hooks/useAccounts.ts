import { useQuery } from "@tanstack/react-query";
import type { Account } from "shared";
import { apiFetch } from "../lib/api";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/api/accounts"),
  });
}
