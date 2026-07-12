import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiPlus } from "react-icons/fi";
import { useCreateDebt } from "../hooks/useDebts";
import {
  DIRECTION_VALUES,
  LOAN_TYPE_VALUES,
  directionOptions,
  loanTypeOptions,
} from "../lib/debtOptions";

export function NewDebtForm() {
  const { t } = useTranslation("debts");
  const createDebt = useCreateDebt();

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<(typeof DIRECTION_VALUES)[number]>("owed_by_me");
  const [counterparty, setCounterparty] = useState("");
  const [mode, setMode] = useState<"fixed" | "split">("fixed");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [splitPercentage, setSplitPercentage] = useState("");
  const [expectedTotalAmount, setExpectedTotalAmount] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [targetPayoffDate, setTargetPayoffDate] = useState("");
  const [loanType, setLoanType] = useState<(typeof LOAN_TYPE_VALUES)[number]>("");
  const [matchingRule, setMatchingRule] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    if (mode === "fixed" && !principalAmount) return;
    if (mode === "split" && !splitPercentage) return;
    createDebt.mutate(
      {
        name,
        direction,
        counterparty: counterparty || undefined,
        principalAmount: mode === "fixed" ? Number(principalAmount) : undefined,
        splitPercentage: mode === "split" ? Number(splitPercentage) : undefined,
        expectedTotalAmount: expectedTotalAmount ? Number(expectedTotalAmount) : undefined,
        startDate,
        targetPayoffDate: targetPayoffDate || undefined,
        loanType: loanType || undefined,
        matchingRule: matchingRule || undefined,
      },
      {
        onSuccess: () => {
          setName("");
          setCounterparty("");
          setPrincipalAmount("");
          setSplitPercentage("");
          setExpectedTotalAmount("");
          setTargetPayoffDate("");
          setLoanType("");
          setMatchingRule("");
        },
      }
    );
  }

  return (
    <>
      <form
        onSubmit={submit}
        className="grid"
        style={{ gridTemplateColumns: "repeat(4, auto)", alignItems: "end", gap: 16 }}
      >
        <label>
          {t("page.name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t("page.direction")}
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            {directionOptions(t).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("page.counterparty")}
          <input
            type="text"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          />
        </label>
        <label>
          {t("page.principalMode")}
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="fixed">{t("page.modeFixed")}</option>
            <option value="split">{t("page.modeSplit")}</option>
          </select>
        </label>
        {mode === "fixed" ? (
          <label>
            {t("page.principalAmount")}
            <input
              type="number"
              step="0.01"
              value={principalAmount}
              onChange={(e) => setPrincipalAmount(e.target.value)}
            />
          </label>
        ) : (
          <label>
            {t("page.splitPercentage")}
            <input
              type="number"
              step="1"
              min="1"
              max="100"
              value={splitPercentage}
              onChange={(e) => setSplitPercentage(e.target.value)}
            />
          </label>
        )}
        <label>
          {t("page.expectedTotal")}
          <input
            type="number"
            step="0.01"
            placeholder={t("page.optional")}
            value={expectedTotalAmount}
            onChange={(e) => setExpectedTotalAmount(e.target.value)}
          />
        </label>
        <label>
          {t("page.startDate")}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </label>
        <label>
          {t("page.targetPayoffDate")}
          <input
            type="date"
            value={targetPayoffDate}
            onChange={(e) => setTargetPayoffDate(e.target.value)}
          />
        </label>
        <label>
          {t("page.loanType")}
          <select value={loanType} onChange={(e) => setLoanType(e.target.value as typeof loanType)}>
            {loanTypeOptions(t).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">
          <FiPlus /> {t("page.submit")}
        </button>
      </form>
      <label style={{ display: "block", marginTop: 16 }}>
        {t("page.matchingRuleLabel")}
        <textarea
          value={matchingRule}
          onChange={(e) => setMatchingRule(e.target.value)}
          placeholder={t("matchingRule.placeholder")}
          rows={2}
          style={{ width: "100%", resize: "vertical" }}
        />
      </label>
    </>
  );
}
