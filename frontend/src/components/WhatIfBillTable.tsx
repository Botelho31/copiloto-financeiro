import { FiCheck } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import type { Bill } from "shared";
import { SortableTh } from "./SortableTh";
import type { SortDirection } from "../hooks/useSortableTable";
import { formatMoney } from "../lib/format";

export function WhatIfBillTable(props: {
  title: string;
  bills: Bill[];
  sign: "+" | "-";
  sortKey: string | undefined;
  direction: SortDirection;
  onSort: (key: string) => void;
  billAmounts: Record<number, number>;
  onOverrideChange: (billId: number, value: number | undefined) => void;
}) {
  const { t } = useTranslation("projections");
  const isIncome = props.sign === "+";
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{props.title}</h3>
      <table>
        <thead>
          <tr>
            <SortableTh
              label={t("whatIf.table.bill")}
              sortKey="name"
              activeKey={props.sortKey}
              direction={props.direction}
              onSort={props.onSort}
            />
            <SortableTh
              label={t("whatIf.table.expected")}
              sortKey="expected"
              activeKey={props.sortKey}
              direction={props.direction}
              onSort={props.onSort}
            />
            <th title={t("whatIf.table.cardColumnTitle")}>{t("whatIf.table.card")}</th>
            <th>{t("whatIf.table.override")}</th>
          </tr>
        </thead>
        <tbody>
          {props.bills.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              {isIncome ? (
                <td className="money" style={{ color: "var(--accent)" }}>
                  +{formatMoney(b.expected_amount)}
                </td>
              ) : (
                <td className="money shortfall">-{formatMoney(b.expected_amount)}</td>
              )}
              <td>{b.is_card_expense ? <FiCheck /> : null}</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  placeholder={String(b.expected_amount)}
                  value={props.billAmounts[b.id] ?? ""}
                  style={{ width: 110 }}
                  disabled={b.is_card_expense}
                  title={b.is_card_expense ? t("whatIf.table.cardDisabledTitle") : undefined}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : undefined;
                    props.onOverrideChange(b.id, value);
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
