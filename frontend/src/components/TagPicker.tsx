import type { Tag } from "shared";
import { ColorSwatch } from "./ColorSwatch";
import { useCreateTag, useTags } from "../hooks/useTags";
import { useSearchCreatePopover } from "../hooks/useSearchCreatePopover";

// A "+ Tag" action button + popover — unlike CategorySelect, this doesn't
// display a persistent value (a group of transactions may already carry
// mixed tags), it's a one-shot "apply this tag to everything here" action.
export function TagPicker(props: { onPick: (tagId: number) => void }) {
  const { data: tags } = useTags();
  const createTag = useCreateTag();
  const { open, setOpen, search, setSearch, containerRef, filtered, exactMatch, close } =
    useSearchCreatePopover<Tag>(tags ?? []);

  function pick(id: number) {
    props.onPick(id);
    close();
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
            style={{
              width: "100%",
              border: "none",
              borderBottom: "1px solid var(--rule)",
              borderRadius: 0,
            }}
          />
          {filtered.map((t) => (
            <div
              key={t.id}
              onClick={() => pick(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              <ColorSwatch color={t.color} />
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
