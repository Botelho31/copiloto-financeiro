import type { Account } from "shared";
import { useUserScopedList } from "./useUserScopedList";

export function useAccounts() {
  return useUserScopedList<Account>("accounts", "/api/accounts");
}
