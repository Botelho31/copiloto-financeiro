import type { TFunction } from "i18next";

export const DIRECTION_VALUES = ["owed_by_me", "owed_to_me"] as const;
export function directionOptions(t: TFunction<"debts">) {
  return [
    { value: "owed_by_me" as const, label: t("directions.owedByMe") },
    { value: "owed_to_me" as const, label: t("directions.owedToMe") },
  ];
}

export const LOAN_TYPE_VALUES = ["", "price", "sac"] as const;
export function loanTypeOptions(t: TFunction<"debts">) {
  return [
    { value: "" as const, label: t("loanTypeOptions.none") },
    { value: "price" as const, label: t("loanTypeOptions.price") },
    { value: "sac" as const, label: t("loanTypeOptions.sac") },
  ];
}
