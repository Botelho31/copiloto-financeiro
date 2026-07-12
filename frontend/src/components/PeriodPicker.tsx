import { useTranslation } from "react-i18next";
import type { Granularity, Period } from "../lib/period";
import { customPeriod, parseIsoDate, periodFor, shiftPeriod, toIsoDate } from "../lib/period";
import { ALL_PERIOD_GRANULARITIES } from "../config";

export function PeriodPicker(props: {
  value: Period;
  onChange: (period: Period) => void;
  granularities?: Granularity[];
  showNavigation?: boolean;
  // Hides the granularity toggle-group, leaving just the prev/next
  // navigation — for callers that pick the granularity some other way
  // (e.g. the Dashboard's Review/Plan modes, which are always single months).
  showGranularityPicker?: boolean;
  // When provided, renders an "All time" button that spans from this date
  // to tomorrow — the parent page fetches this (e.g. earliest transaction
  // date) since PeriodPicker itself doesn't know about the data.
  allTimeStart?: Date;
}) {
  const { t } = useTranslation();
  const granularityLabels: Record<Granularity, string> = {
    month: t("period.month"),
    quarter: t("period.quarter"),
    semester: t("period.semester"),
    year: t("period.year"),
    custom: t("period.custom"),
  };
  const granularities = props.granularities ?? ALL_PERIOD_GRANULARITIES;
  const showNavigation = props.showNavigation ?? true;
  const showGranularityPicker = props.showGranularityPicker ?? true;
  const isCustom = props.value.granularity === "custom";

  function selectAllTime() {
    if (!props.allTimeStart) return;
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    props.onChange(customPeriod(props.allTimeStart, tomorrow));
  }

  const isAllTime =
    isCustom &&
    props.allTimeStart !== undefined &&
    props.value.start.getTime() === props.allTimeStart.getTime();

  function selectGranularity(g: Granularity) {
    if (g === "custom") {
      if (!isCustom) props.onChange(customPeriod(props.value.start, props.value.end));
      return;
    }
    // Always jump to the current period of that size — not wherever you
    // were previously browsing — so switching granularity never strands you
    // on a past period without realizing it.
    props.onChange(periodFor(g));
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      {showGranularityPicker && (
        <div className="toggle-group">
          {granularities.map((g) => (
            <button
              key={g}
              type="button"
              className={g === props.value.granularity && !isAllTime ? "active" : undefined}
              onClick={() => selectGranularity(g)}
            >
              {granularityLabels[g]}
            </button>
          ))}
          {props.allTimeStart && (
            <button
              type="button"
              className={isAllTime ? "active" : undefined}
              onClick={selectAllTime}
            >
              {t("period.allTime")}
            </button>
          )}
        </div>
      )}

      {isCustom ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="date"
            value={toIsoDate(props.value.start)}
            onChange={(e) => {
              if (!e.target.value) return;
              props.onChange(customPeriod(parseIsoDate(e.target.value), props.value.end));
            }}
          />
          <span>–</span>
          <input
            type="date"
            value={toIsoDate(new Date(props.value.end.getTime() - 86_400_000))}
            onChange={(e) => {
              if (!e.target.value) return;
              const inclusiveEnd = parseIsoDate(e.target.value);
              const exclusiveEnd = new Date(inclusiveEnd.getTime() + 86_400_000);
              props.onChange(customPeriod(props.value.start, exclusiveEnd));
            }}
          />
        </div>
      ) : (
        showNavigation && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="secondary icon"
              aria-label={t("period.previousPeriod")}
              onClick={() => props.onChange(shiftPeriod(props.value, -1))}
            >
              ‹
            </button>
            <span style={{ minWidth: 72, textAlign: "center" }}>{props.value.label}</span>
            <button
              type="button"
              className="secondary icon"
              aria-label={t("period.nextPeriod")}
              onClick={() => props.onChange(shiftPeriod(props.value, 1))}
            >
              ›
            </button>
          </div>
        )
      )}
    </div>
  );
}
