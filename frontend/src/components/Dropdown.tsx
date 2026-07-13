import { useRef, useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import { useClickOutside } from "../hooks/useClickOutside";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

// A small custom dropdown for short, static option lists — used instead of
// a native <select> so every picker in the app shares one look. For a long
// or user-searchable list, use useSearchCreatePopover (see CategorySelect)
// instead; this one has no search box. Styles live under .dropdown in the
// global stylesheet.
export function Dropdown<T extends string>(props: {
  value: T | "";
  options: DropdownOption<T>[];
  placeholder: string;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setOpen(false), open);

  const selected = props.options.find((o) => o.value === props.value);

  return (
    <div ref={containerRef} className="dropdown">
      <button
        type="button"
        className="secondary"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%" }}
      >
        <span style={{ color: selected ? undefined : "var(--text-muted)" }}>
          {selected ? selected.label : props.placeholder}
        </span>
        <FiChevronDown size={13} />
      </button>

      {open && (
        <div className="dropdown-menu" role="listbox">
          {props.options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === props.value}
              className={o.value === props.value ? "selected" : undefined}
              onClick={() => {
                props.onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
