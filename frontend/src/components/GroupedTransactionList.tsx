import { useMemo } from "react";
import type { Category, Transaction } from "shared";
import { useSortableTable } from "../hooks/useSortableTable";
import { useBulkCategorizeTransactions } from "../hooks/useTransactions";
import { useBulkTagTransactions } from "../hooks/useTags";
import { formatMoney } from "../lib/format";
import { normalizeDescription } from "../lib/normalize";
import { CategorySelect } from "./CategorySelect";
import { SortableTh } from "./SortableTh";
import { TagPicker } from "./TagPicker";

interface Group {
  key: string;
  sampleDescription: string;
  count: number;
  totalAmount: number;
  categoryId: number | null;
  categoryName: string | null;
  transactionIds: string[];
}

export function GroupedTransactionList(props: { transactions: Transaction[]; categories: Category[] }) {
  const bulkCategorize = useBulkCategorizeTransactions();
  const bulkTag = useBulkTagTransactions();

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const t of props.transactions) {
      const key = normalizeDescription(t.description) || t.description;
      const group = map.get(key) ?? {
        key,
        sampleDescription: t.description,
        count: 0,
        totalAmount: 0,
        categoryId: t.category_id,
        categoryName: t.category_name,
        transactionIds: [],
      };
      group.count += 1;
      group.totalAmount += Math.abs(t.amount);
      group.transactionIds.push(t.id);
      map.set(key, group);
    }
    return [...map.values()];
  }, [props.transactions]);

  const { sorted, sortKey, direction, toggleSort } = useSortableTable<Group>(
    groups,
    (g, key) => {
      switch (key) {
        case "description":
          return g.sampleDescription;
        case "count":
          return g.count;
        case "category":
          return g.categoryName ?? "";
        default:
          return g.totalAmount;
      }
    },
    "total",
    "desc"
  );

  if (groups.length === 0) {
    return <p className="muted">No transactions to group for the selected filters.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <SortableTh label="Description" sortKey="description" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Count" sortKey="count" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Total" sortKey="total" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Category" sortKey="category" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <th>Tag</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((g) => (
          <tr key={g.key}>
            <td>{g.sampleDescription}</td>
            <td className="money">{g.count}</td>
            <td className="money">{formatMoney(g.totalAmount)}</td>
            <td>
              <CategorySelect
                categories={props.categories}
                value={g.categoryId}
                onChange={(categoryId) =>
                  bulkCategorize.mutate({ transactionIds: g.transactionIds, categoryId })
                }
              />
            </td>
            <td>
              <TagPicker onPick={(tagId) => bulkTag.mutate({ transactionIds: g.transactionIds, tagId })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
