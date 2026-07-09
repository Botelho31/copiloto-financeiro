import { useQuery } from "@tanstack/react-query";
import type { Investment } from "shared";
import { apiFetch } from "../lib/api";

export function useInvestments() {
  return useQuery({
    queryKey: ["investments"],
    queryFn: () => apiFetch<Investment[]>("/api/investments"),
  });
}
