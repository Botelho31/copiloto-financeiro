import { useMutation, useQuery } from "@tanstack/react-query";
import type { BillOverride, ProjectionResult } from "shared";
import { apiFetch } from "../lib/api";

export function useProjections(horizonMonths?: number) {
  return useQuery({
    queryKey: ["projections", horizonMonths],
    queryFn: () =>
      apiFetch<ProjectionResult>(
        `/api/projections${horizonMonths ? `?horizonMonths=${horizonMonths}` : ""}`
      ),
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
  return useMutation({
    mutationFn: (input: WhatIfInput) =>
      apiFetch<ProjectionResult>("/api/projections/what-if", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}
