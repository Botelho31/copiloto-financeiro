import type { SortDirection } from "../hooks/useSortableTable";

export function SortableTh(props: {
  label: string;
  sortKey: string;
  activeKey?: string;
  direction: SortDirection;
  onSort: (key: string) => void;
}) {
  const isActive = props.activeKey === props.sortKey;
  return (
    <th
      onClick={() => props.onSort(props.sortKey)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {props.label}
      <span className="muted" style={{ marginLeft: 4, fontSize: "0.75em" }}>
        {isActive ? (props.direction === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}
