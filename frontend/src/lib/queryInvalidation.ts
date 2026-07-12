import type { QueryClient, QueryKey } from "@tanstack/react-query";

// Nearly every mutation hook in this app invalidates 2-3 related query keys
// on success (e.g. updating a bill also invalidates debts and projections,
// since a linked bill reshapes the debt's payment plan). This just
// collapses the repeated `qc.invalidateQueries({ queryKey: [...] })` block
// into one call per mutation.
export function invalidateKeys(qc: QueryClient, keys: QueryKey[]): void {
  for (const key of keys) qc.invalidateQueries({ queryKey: key });
}
