import type { Transaction } from "shared";
import { useSortableTable } from "../hooks/useSortableTable";
import { formatDate, formatMoney } from "../lib/format";
import { SortableTh } from "./SortableTh";

// Plain Date/Description/Amount table, sortable — used by the small
// drilldown panels (click a category slice, see the transactions behind it).
export function SortableTransactionTable(props: { transactions: Transaction[] }) {
  const { sorted, sortKey, direction, toggleSort } = useSortableTable<Transaction>(
    props.transactions,
    (t, key) => (key === "date" ? t.date : key === "description" ? t.description : t.amount),
    "date",
    "desc"
  );

  return (
    <table>
      <thead>
        <tr>
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Description" sortKey="description" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Amount" sortKey="amount" activeKey={sortKey} direction={direction} onSort={toggleSort} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((t) => (
          <tr key={t.id}>
            <td>{formatDate(t.date)}</td>
            <td>{t.description}</td>
            <td className="money">{formatMoney(t.amount, t.currency_code)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
