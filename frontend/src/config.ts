import type { Granularity } from "./lib/period";

// Central home for tunable app-level constants — thresholds, default rates,
// horizons, and shared color tokens — so changing one of these doesn't
// require hunting across page files, and so the same value (e.g. the
// fallback category color) can't quietly drift out of sync between the
// several places it's used.

// --- Colors -----------------------------------------------------------

// Used wherever a category has no assigned color yet (a newly-created
// category, or data from before colors existed).
export const FALLBACK_CATEGORY_COLOR = "#6b6b6b";

// One color per credit card in the Dashboard's per-card spend chart, cycled
// via index if there are more cards than colors.
export const CARD_CHART_COLORS = ["#b5542d", "#5f7fbf", "#8c6a9c", "#4a9c8f", "#c9a227"];

// Projections page balance chart: --danger red ("red symbolizing debt" per
// explicit product direction) for the "debt pays off" marker, and a slate
// blue for goal targets chosen specifically so it can't be confused with
// the app's green/red pair under red-green colorblindness.
export const DEBT_MARKER_COLOR = "var(--danger)";
export const GOAL_MARKER_COLOR = "#5f7fbf";

// Offered as quick-pick swatches when creating a new household member.
export const DEFAULT_PERSON_COLORS = [
  "#5f7fbf",
  "#4c9a6a",
  "#c98a3e",
  "#9c5b4a",
  "#8c6a9c",
  "#5c8b99",
];

// --- Projection horizons (months) --------------------------------------

export const BILLS_PROJECTION_HORIZON_MONTHS = 4;
export const HOUSEHOLD_PROJECTION_HORIZON_MONTHS = 6;
// 12 months out so browsing to any reasonably-near future month on the
// Dashboard can still look up that month's expected bills.
export const DASHBOARD_PROJECTION_HORIZON_MONTHS = 12;

// Review mode's "vs usual pace" verdict needs a trailing baseline that
// predates the viewed period itself.
export const REVIEW_LOOKBACK_MONTHS = 3;

// Brazil's Selic rate as of the June 2026 Copom cut — a reasonable default
// for idle-cash interest, fully editable per-scenario on the Projections
// page since real-world rates move.
export const DEFAULT_INTEREST_RATE_ANNUAL_PERCENT = 14.25;

// Projections page: how far out each granularity's What-If horizon reaches.
export const GRANULARITY_TO_HORIZON_MONTHS: Record<Granularity, number> = {
  month: 1,
  quarter: 3,
  semester: 6,
  year: 12,
  custom: 6,
};
export const PROJECTION_GRANULARITIES: Granularity[] = ["month", "quarter", "semester", "year"];
// Every granularity the generic PeriodPicker can offer — Projections adds
// "custom" isn't included there since a custom-length what-if horizon
// isn't a supported scenario, but any other page's picker can offer it.
export const ALL_PERIOD_GRANULARITIES: Granularity[] = [...PROJECTION_GRANULARITIES, "custom"];

// --- Chart / display limits --------------------------------------------

// 30 years of monthly points is plenty for a debt balance plot.
export const MAX_DEBT_CHART_MONTHS = 360;
// 18 months so even a loan starting next year (e.g. a mortgage originating
// mid-next-year) still shows its upcoming payments; only the first few
// applicable months are displayed (DEBT_PLAN_PREVIEW_COUNT).
export const DEBT_PLAN_PREVIEW_HORIZON_MONTHS = 18;
export const DEBT_PLAN_PREVIEW_COUNT = 6;

// How many categories the Dashboard's trends-mode "top categories over
// time" line chart plots at once.
export const TOP_CATEGORY_COUNT = 6;

// Labeling every pie slice causes label collisions on small slices — only
// label slices at or above this share of the total.
export const PIE_LABEL_MIN_PERCENT = 0.04;

// The Transactions page's raw, ungrouped table is the one list in this app
// that grows unbounded over years — everywhere else either needs its whole
// result set to compute a correct total (cash-flow, grouped-by-description
// counts) or is naturally small (accounts, bills, debts, goals). Must match
// backend/src/routes/transactions.ts's DEFAULT_TRANSACTIONS_PAGE_SIZE.
export const TRANSACTIONS_PAGE_SIZE = 50;

// --- Review-mode anomaly detection --------------------------------------

// Filters out noise from categories with barely any trailing history.
export const ANOMALY_MIN_TRAILING_AVG = 10;
// A category counts as an anomaly once it's spending this much more than
// its own trailing average.
export const ANOMALY_THRESHOLD_PERCENT = 0.25;
