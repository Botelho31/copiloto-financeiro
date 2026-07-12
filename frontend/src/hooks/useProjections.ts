import { useMutation, useQuery } from "@tanstack/react-query";
import type { BillOverride, ProjectionResult } from "shared";
import { apiFetch } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

export function useProjections(horizonMonths?: number) {
  const { activeUserId } = usePersonScope();
  const params = new URLSearchParams();
  if (horizonMonths) params.set("horizonMonths", String(horizonMonths));
  if (activeUserId != null) params.set("userId", String(activeUserId));
  const qs = params.toString();
  return useQuery({
    queryKey: ["projections", activeUserId, horizonMonths],
    queryFn: () => apiFetch<ProjectionResult>(`/api/projections${qs ? `?${qs}` : ""}`),
  });
}

export interface WhatIfInput {
  horizonMonths?: number;
  billOverrides?: BillOverride[];
  discretionaryDeltaPercent?: number;
  interestRateAnnualPercent?: number;
  cardSpendGoal?: number;
}

export function useWhatIfProjection() {
  const { activeUserId } = usePersonScope();
  return useMutation({
    mutationFn: (input: WhatIfInput) =>
      apiFetch<ProjectionResult>(
        `/api/projections/what-if${activeUserId != null ? `?userId=${activeUserId}` : ""}`,
        { method: "POST", body: JSON.stringify(input) }
      ),
  });
}
