// Whether/how much of a recurring bill applies to a given calendar month —
// shared by the backend's cash-flow projection and any frontend chart that
// needs to reproduce the exact same occurrence logic (a bill-driven line in a
// chart must agree with the same bill's line in the real projection, or the
// two would silently drift apart).
export interface BillCadenceInfo {
  cadence: "weekly" | "monthly" | "quarterly" | "yearly" | "once";
  nextDueDate: string | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
}

// Absolute month index (year*12 + zero-based month) read directly off the
// "YYYY-MM-DD" string, never through `new Date(iso)` — that parses as UTC
// midnight, and diffing it against a locally-constructed targetMonth silently
// shifts dates on the 1st into the previous month in any negative-UTC-offset
// timezone (e.g. a 2028-01-01 due date reads back as December 31st local).
function monthIndex(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + (m - 1);
}

function targetMonthIndex(targetMonth: Date): number {
  return targetMonth.getFullYear() * 12 + targetMonth.getMonth();
}

function withinRecurrenceBounds(bill: BillCadenceInfo, targetMonth: Date): boolean {
  // A month is "in bounds" if any part of it falls on/after the start date
  // and on/before the end date — so a bill starting mid-March still applies
  // to the March bucket, and one ending mid-October still applies to October.
  const targetIdx = targetMonthIndex(targetMonth);
  if (bill.recurrenceStartDate && targetIdx < monthIndex(bill.recurrenceStartDate)) return false;
  if (bill.recurrenceEndDate && targetIdx > monthIndex(bill.recurrenceEndDate)) return false;
  return true;
}

export function billAppliesToMonth(bill: BillCadenceInfo, targetMonth: Date): boolean {
  if (!withinRecurrenceBounds(bill, targetMonth)) return false;

  // A "once" bill whose date has already passed is done — it must never
  // project forward again, explicitly, regardless of month/year matching.
  if (bill.cadence === "once" && bill.nextDueDate && new Date(bill.nextDueDate) < new Date()) {
    return false;
  }

  if (bill.cadence === "monthly" || bill.cadence === "weekly") return true;
  if (!bill.nextDueDate) return false;

  const targetIdx = targetMonthIndex(targetMonth);
  const dueIdx = monthIndex(bill.nextDueDate);

  if (bill.cadence === "yearly") return (((targetIdx - dueIdx) % 12) + 12) % 12 === 0;

  if (bill.cadence === "quarterly") {
    const monthDiff = targetIdx - dueIdx;
    return monthDiff >= 0 && monthDiff % 3 === 0;
  }

  // "once": a single future occurrence, never repeats — must match the
  // exact year and month, not just the calendar month like "yearly" does.
  return targetIdx === dueIdx;
}

export function monthlyEquivalentAmount(
  bill: { cadence: BillCadenceInfo["cadence"]; expectedAmount: number },
  overrideAmount?: number
): number {
  const base = overrideAmount ?? bill.expectedAmount;
  return bill.cadence === "weekly" ? base * (52 / 12) : base;
}

// n months after startIso, as a "YYYY-MM-DD" string — day clamped to 28 so
// stepping month-by-month never skips a short month (Jan 31 + 1 month would
// otherwise land in March). Built entirely from the string's own year/month/
// day plus Date.UTC, so the result never depends on the runtime's local
// timezone.
export function addMonthsIso(startIso: string, n: number): string {
  const [y, m, day] = startIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, 28))).toISOString().slice(0, 10);
}

// A LOCAL-time Date n months after startIso, read directly off the string's
// own year/month (never through `new Date(iso)`, which parses as UTC) —
// needed anywhere a Date gets handed to billAppliesToMonth, since that reads
// year/month back off it with local getters. Round-tripping through
// addMonthsIso's UTC ISO string first (then `new Date()`-parsing it) would
// silently shift the month backward in any negative-UTC-offset timezone.
export function localMonthDate(startIso: string, n: number): Date {
  const [y, m] = startIso.split("-").map(Number);
  return new Date(y, m - 1 + n, 1);
}
