import { useQuery } from "@tanstack/react-query";
import type { Investment } from "shared";
import { apiFetch, appendUserId } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

export function useInvestments() {
  const { activeUserId } = usePersonScope();
  return useQuery({
    queryKey: ["investments", activeUserId],
    queryFn: () => apiFetch<Investment[]>(appendUserId("/api/investments", activeUserId)),
  });
}
