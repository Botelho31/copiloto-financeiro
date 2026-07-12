import type { Investment } from "shared";
import { useUserScopedList } from "./useUserScopedList";

export function useInvestments() {
  return useUserScopedList<Investment>("investments", "/api/investments");
}
