import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import commonEn from "./locales/en/common.json";
import dashboardEn from "./locales/en/dashboard.json";
import billsEn from "./locales/en/bills.json";
import transactionsEn from "./locales/en/transactions.json";
import projectionsEn from "./locales/en/projections.json";
import debtsEn from "./locales/en/debts.json";
import configEn from "./locales/en/config.json";
import householdEn from "./locales/en/household.json";
import vaultEn from "./locales/en/vault.json";

import commonPt from "./locales/pt/common.json";
import dashboardPt from "./locales/pt/dashboard.json";
import billsPt from "./locales/pt/bills.json";
import transactionsPt from "./locales/pt/transactions.json";
import projectionsPt from "./locales/pt/projections.json";
import debtsPt from "./locales/pt/debts.json";
import configPt from "./locales/pt/config.json";
import householdPt from "./locales/pt/household.json";
import vaultPt from "./locales/pt/vault.json";

// One namespace per page (plus "common" for the shared shell/nav) rather
// than one giant file — keeps each page's strings independently editable
// without every change touching a single shared JSON file.
export const defaultNS = "common";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        dashboard: dashboardEn,
        bills: billsEn,
        transactions: transactionsEn,
        projections: projectionsEn,
        debts: debtsEn,
        config: configEn,
        household: householdEn,
        vault: vaultEn,
      },
      pt: {
        common: commonPt,
        dashboard: dashboardPt,
        bills: billsPt,
        transactions: transactionsPt,
        projections: projectionsPt,
        debts: debtsPt,
        config: configPt,
        household: householdPt,
        vault: vaultPt,
      },
    },
    // Portuguese by default regardless of browser locale — this app is
    // mostly used by Brazilians — not auto-detected; only the explicit nav
    // toggle changes it, remembered in localStorage from then on.
    fallbackLng: "pt",
    supportedLngs: ["en", "pt"],
    defaultNS,
    ns: [
      "common",
      "dashboard",
      "bills",
      "transactions",
      "projections",
      "debts",
      "config",
      "household",
      "vault",
    ],
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "language",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
