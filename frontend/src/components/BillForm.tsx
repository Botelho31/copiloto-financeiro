import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiChevronDown, FiChevronRight, FiX } from "react-icons/fi";
import type { Bill, Category } from "shared";
import { CategorySelect } from "./CategorySelect";

const CADENCES = ["weekly", "monthly", "quarterly", "yearly", "once"] as const;
type Cadence = (typeof CADENCES)[number];

export interface BillFormValues {
  name: string;
  categoryId: number | null;
  expectedAmount: number;
  cadence: Cadence;
  nextDueDate: string | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
  isCardExpense: boolean;
}

export function BillForm(props: {
  categories: Category[];
  initial?: Bill;
  submitLabel: ReactNode;
  busy?: boolean;
  onSubmit: (values: BillFormValues) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation("bills");
  const b = props.initial;
  const [name, setName] = useState(b?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(b?.category_id ?? null);
  const [expectedAmount, setExpectedAmount] = useState(b ? String(b.expected_amount) : "");
  const [cadence, setCadence] = useState<Cadence>(b?.cadence ?? "monthly");
  const [nextDueDate, setNextDueDate] = useState(b?.next_due_date ?? "");
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(b?.recurrence_start_date ?? "");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(b?.recurrence_end_date ?? "");
  const [isCardExpense, setIsCardExpense] = useState(b?.is_card_expense ?? false);
  // Open by default when the bill already uses one of the tucked-away fields,
  // so editing never hides a value that's actually set.
  const [moreOpen, setMoreOpen] = useState(
    Boolean(b && (b.recurrence_start_date || b.recurrence_end_date || b.is_card_expense))
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name || !expectedAmount) return;
    props.onSubmit({
      name,
      categoryId,
      expectedAmount: Number(expectedAmount),
      cadence,
      nextDueDate: nextDueDate || null,
      recurrenceStartDate: cadence === "once" ? null : recurrenceStartDate || null,
      recurrenceEndDate: cadence === "once" ? null : recurrenceEndDate || null,
      isCardExpense,
    });
  }

  return (
    <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}
      >
        <label>
          {t("form.name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t("form.category")}
          <CategorySelect
            categories={props.categories}
            value={categoryId}
            placeholder={t("form.categoryPlaceholder")}
            onChange={setCategoryId}
          />
        </label>
        <label>
          {t("form.amount")}
          <input
            type="number"
            step="0.01"
            value={expectedAmount}
            onChange={(e) => setExpectedAmount(e.target.value)}
            required
          />
        </label>
        <label>
          {t("form.cadence")}
          <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {t(`cadences.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("form.nextDueDate")}
          <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
        </label>
      </div>

      <div>
        <button type="button" className="link-button" onClick={() => setMoreOpen((o) => !o)}>
          {moreOpen ? <FiChevronDown /> : <FiChevronRight />} {t("form.moreOptions")}
        </button>
      </div>

      {moreOpen && (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          {cadence !== "once" && (
            <>
              <label>
                {t("form.recurrenceStart")}
                <input
                  type="date"
                  value={recurrenceStartDate}
                  onChange={(e) => setRecurrenceStartDate(e.target.value)}
                />
              </label>
              <label>
                {t("form.recurrenceEnd")}
                <input
                  type="date"
                  value={recurrenceEndDate}
                  onChange={(e) => setRecurrenceEndDate(e.target.value)}
                />
              </label>
            </>
          )}
          <label
            style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
            title={t("form.cardExpenseHint")}
          >
            <input
              type="checkbox"
              checked={isCardExpense}
              onChange={(e) => setIsCardExpense(e.target.checked)}
            />
            {t("form.cardExpense")}
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={props.busy}>
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" className="secondary" onClick={props.onCancel}>
            <FiX /> {t("form.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
