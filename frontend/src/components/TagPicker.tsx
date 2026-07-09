import { useEffect, useRef, useState } from "react";
import type { Tag } from "shared";
import { useCreateTag, useTags } from "../hooks/useTags";

// A "+ Tag" action button + popover — unlike CategorySelect, this doesn't
// display a persistent value (a group of transactions may already carry
// mixed tags), it's a one-shot "apply this tag to everything here" action.
export function TagPicker(props: { onPick: (tagId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: tags } = useTags();
  const createTag = useCreateTag();
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = (tags ?? []).filter((t: Tag) =>
    t.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const exactMatch = (tags ?? []).some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function pick(id: number) {
    props.onPick(id);
    setOpen(false);
    setSearch("");
  }

  function handleCreate() {
    const name = search.trim();
    if (!name) return;
    createTag.mutate(
      { name },
      {
        onSuccess: (allTags) => {
          const created = allTags.find((t) => t.name === name);
          if (created) pick(created.id);
        },
      }
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="link-button" onClick={() => setOpen((o) => !o)}>
        + Tag
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 10,
            background: "var(--ink-raised)",
            border: "1px solid var(--rule)",
            borderRadius: 3,
            marginTop: 4,
            width: 200,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          <input
            autoFocus
            type="text"
            placeholder="Search or create…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", border: "none", borderBottom: "1px solid var(--rule)", borderRadius: 0 }}
          />
          {filtered.map((t) => (
            <div
              key={t.id}
              onClick={() => pick(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer" }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: t.color,
                  display: "inline-block",
                }}
              />
              {t.name}
            </div>
          ))}
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
