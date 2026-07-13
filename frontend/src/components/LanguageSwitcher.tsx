import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    <div className="toggle-group" aria-label={t("language.en") + " / " + t("language.pt")}>
      <button
        type="button"
        className={i18n.resolvedLanguage === "pt" ? "active" : undefined}
        onClick={() => void i18n.changeLanguage("pt")}
      >
        PT
      </button>
      <button
        type="button"
        className={i18n.resolvedLanguage === "en" ? "active" : undefined}
        onClick={() => void i18n.changeLanguage("en")}
      >
        EN
      </button>
    </div>
  );
}
