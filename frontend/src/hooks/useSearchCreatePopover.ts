import { useEffect, useMemo, useRef, useState } from "react";

// Shared state behind any "search or create" popover (CategorySelect,
// TagPicker): open/search state, a click-outside-to-close listener, and a
// case-insensitive substring filter over a named list. The trigger button
// and result-list JSX differ enough between call sites (persistent selected
// value vs. one-shot action button) that only this state layer is shared,
// not the rendering.
export function useSearchCreatePopover<T extends { name: string }>(items: T[]) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, search]);

  const exactMatch = items.some((i) => i.name.toLowerCase() === search.trim().toLowerCase());

  function close() {
    setOpen(false);
    setSearch("");
  }

  return { open, setOpen, search, setSearch, containerRef, filtered, exactMatch, close };
}
