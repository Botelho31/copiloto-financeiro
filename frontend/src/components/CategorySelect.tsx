import { useEffect, useMemo, useRef, useState } from "react";
import type { Category } from "shared";
import { useCreateCategory } from "../hooks/useCategories";

function Swatch(props: { color: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: props.color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export function CategorySelect(props: {
  categories: Category[];
  value: number | null;
  onChange: (categoryId: number) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const createCategory = useCreateCategory();
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = props.categories.find((c) => c.id === props.value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return props.categories;
    return props.categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [props.categories, search]);

  const exactMatch = props.categories.some(
    (c) => c.name.toLowerCase() === search.trim().toLowerCase()
  );

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

  function selectCategory(id: number) {
    props.onChange(id);
    setOpen(false);
    setSearch("");
  }

  function handleCreate() {
    const name = search.trim();
    if (!name) return;
    createCategory.mutate(
      { name },
      {
        onSuccess: (categories) => {
          const created = categories.find((c) => c.name === name);
          if (created) selectCategory(created.id);
        },
      }
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 150 }}>
      <button
        type="button"
        className="link-button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 3,
          background: "var(--ink)",
          color: "var(--paper)",
          width: "100%",
          justifyContent: "flex-start",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <>
            <Swatch color={selected.color} />
            {selected.name}
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>{props.placeholder ?? "Set category…"}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 10,
            background: "var(--ink-raised)",
            border: "1px solid var(--rule)",
            borderRadius: 3,
            marginTop: 4,
            width: 220,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <input
            autoFocus
            type="text"
            placeholder="Search or create…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              border: "none",
              borderBottom: "1px solid var(--rule)",
              borderRadius: 0,
            }}
          />
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => selectCategory(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              <Swatch color={c.color} />
              {c.name}
            </div>
          ))}
          {filtered.length === 0 && !search.trim() && (
            <div className="muted" style={{ padding: "6px 10px" }}>
              No categories yet.
            </div>
          )}
          {search.trim() && !exactMatch && (
            <div
              onClick={handleCreate}
              style={{ padding: "6px 10px", cursor: "pointer", color: "var(--accent)" }}
            >
              + Create "{search.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
