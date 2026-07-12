import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiPlus } from "react-icons/fi";
import { useCreateGoal } from "../hooks/useGoals";

export function NewGoalForm() {
  const { t } = useTranslation("projections");
  const createGoal = useCreateGoal();
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [goalDate, setGoalDate] = useState("");

  function submitGoal(e: FormEvent) {
    e.preventDefault();
    if (!goalName || !goalAmount || !goalDate) return;
    createGoal.mutate(
      { name: goalName, targetAmount: Number(goalAmount), targetDate: goalDate },
      {
        onSuccess: () => {
          setGoalName("");
          setGoalAmount("");
          setGoalDate("");
        },
      }
    );
  }

  return (
    <form
      onSubmit={submitGoal}
      className="grid"
      style={{ gridTemplateColumns: "repeat(4, auto)", alignItems: "end", marginTop: 16 }}
    >
      <label>
        {t("goals.form.name")}
        <input
          type="text"
          value={goalName}
          onChange={(e) => setGoalName(e.target.value)}
          required
        />
      </label>
      <label>
        {t("goals.form.targetAmount")}
        <input
          type="number"
          step="0.01"
          value={goalAmount}
          onChange={(e) => setGoalAmount(e.target.value)}
          required
        />
      </label>
      <label>
        {t("goals.form.targetDate")}
        <input
          type="date"
          value={goalDate}
          onChange={(e) => setGoalDate(e.target.value)}
          required
        />
      </label>
      <button type="submit">
        <FiPlus /> {t("goals.form.submit")}
      </button>
    </form>
  );
}
