import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

// Generic click-to-sort for any table: pass the row array and a function
// that resolves a sortable value (string/number/Date) for a given column
// key, get back the sorted rows plus the state to wire up clickable headers.
export function useSortableTable<T>(
  data: T[],
  getValue: (item: T, key: string) => string | number | Date,
  defaultKey?: string,
  defaultDirection: SortDirection = "asc"
) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultKey);
  const [direction, setDirection] = useState<SortDirection>(defaultDirection);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const va = getValue(a, sortKey);
      const vb = getValue(b, sortKey);
      if (va < vb) return direction === "asc" ? -1 : 1;
      if (va > vb) return direction === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [data, sortKey, direction, getValue]);

  return { sorted, sortKey, direction, toggleSort };
}
