import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiX } from "react-icons/fi";
import { useUpdateUserSettings, useUserSettings } from "../hooks/useSettings";
import { formatMoney } from "../lib/format";

export function CardSpendGoalField(props: { userId: number }) {
  const { t } = useTranslation("config");
  const { data: settings } = useUserSettings(props.userId);
  const updateSettings = useUpdateUserSettings(props.userId);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setValue(settings?.cardSpendGoal != null ? String(settings.cardSpendGoal) : "");
          setEditing(true);
        }}
      >
        {settings?.cardSpendGoal != null
          ? t("table.cardSpendGoalValue", { amount: formatMoney(settings.cardSpendGoal) })
          : t("table.cardSpendGoalUnset")}
      </button>
    );
  }

  return (
    <form
      style={{ display: "flex", gap: 6, alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        updateSettings.mutate(
          { cardSpendGoal: value === "" ? null : Number(value) },
          { onSuccess: () => setEditing(false) }
        );
      }}
    >
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 110 }}
        autoFocus
      />
      <button
        type="submit"
        className="icon"
        disabled={updateSettings.isPending}
        title={t("form.save")}
      >
        <FiCheck />
      </button>
      <button
        type="button"
        className="secondary icon"
        onClick={() => setEditing(false)}
        title={t("form.cancel")}
      >
        <FiX />
      </button>
    </form>
  );
}
