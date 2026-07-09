export type Granularity = "month" | "quarter" | "semester" | "year" | "custom";

// periodFor/shiftPeriod compute a period from a formula (anchor + unit size)
// — that doesn't apply to "custom" (arbitrary start/end), which is built
// directly via customPeriod() instead.
type ArithmeticGranularity = Exclude<Granularity, "custom">;

export interface Period {
  granularity: Granularity;
  start: Date; // inclusive
  end: Date; // exclusive
  label: string;
}

const MONTHS_PER_UNIT: Record<ArithmeticGranularity, number> = {
  month: 1,
  quarter: 3,
  semester: 6,
  year: 12,
};

function startOfUnit(anchor: Date, granularity: ArithmeticGranularity): Date {
  const unitMonths = MONTHS_PER_UNIT[granularity];
  const monthIndex = Math.floor(anchor.getMonth() / unitMonths) * unitMonths;
  return new Date(anchor.getFullYear(), monthIndex, 1);
}

function labelFor(granularity: ArithmeticGranularity, start: Date): string {
  const year = start.getFullYear();
  switch (granularity) {
    case "month":
      return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(start);
    case "quarter":
      return `Q${Math.floor(start.getMonth() / 3) + 1} ${year}`;
    case "semester":
      return `H${Math.floor(start.getMonth() / 6) + 1} ${year}`;
    case "year":
      return String(year);
  }
}

export function periodFor(granularity: ArithmeticGranularity, anchor: Date = new Date()): Period {
  const start = startOfUnit(anchor, granularity);
  const end = new Date(start.getFullYear(), start.getMonth() + MONTHS_PER_UNIT[granularity], 1);
  return { granularity, start, end, label: labelFor(granularity, start) };
}

export function shiftPeriod(period: Period, direction: 1 | -1): Period {
  if (period.granularity === "custom") {
    throw new Error("shiftPeriod: a custom period has no fixed unit size to navigate by");
  }
  const unitMonths = MONTHS_PER_UNIT[period.granularity];
  const anchor = new Date(
    period.start.getFullYear(),
    period.start.getMonth() + direction * unitMonths,
    1
  );
  return periodFor(period.granularity, anchor);
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Parses a "YYYY-MM-DD" string (e.g. from <input type="date">) as a local
// date — new Date(str) would parse it as UTC midnight, which can shift a day
// off in negative-offset timezones once read back with local getters.
// Also accepts a full ISO datetime ("2025-07-02T03:00:00.000Z", e.g. from a
// raw DB timestamp column) by taking just the date prefix.
export function parseIsoDate(s: string): Date {
  const [year, month, day] = s.slice(0, 10).split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

export function periodToRange(period: Period): { from: string; to: string } {
  return { from: toIsoDate(period.start), to: toIsoDate(period.end) };
}

// end is exclusive internally, but a date-range picker shows the last
// included day — so the label and the "to" input both show end minus 1 day.
export function customPeriod(start: Date, end: Date): Period {
  const inclusiveEnd = new Date(end.getTime() - 86_400_000);
  return {
    granularity: "custom",
    start,
    end,
    label: `${toIsoDate(start)} – ${toIsoDate(inclusiveEnd)}`,
  };
}

// Breaks a period into its constituent calendar months, for per-month charts.
export function monthsInPeriod(period: Period): { start: Date; end: Date; label: string }[] {
  const months: { start: Date; end: Date; label: string }[] = [];
  let cursor = period.start;
  while (cursor < period.end) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    months.push({
      start: cursor,
      end: next,
      label: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(cursor),
    });
    cursor = next;
  }
  return months;
}
