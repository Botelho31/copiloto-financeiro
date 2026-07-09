// Simulates a declining-balance loan: each payment is split into interest
// (accrued on the outstanding balance since the prior payment, at the given
// monthly rate) and principal (the rest). Used both server-side (to compute
// a debt's real interest_paid/remaining split) and client-side (to preview
// the effect of an edited rate before saving).
export interface AmortizationPayment {
  id: string;
  date: string;
  amount: number;
}

export interface AmortizationPaymentBreakdown extends AmortizationPayment {
  interest: number;
  principal: number;
  balanceAfter: number;
}

export interface AmortizationResult {
  totalInterestPaid: number;
  totalPrincipalPaid: number;
  principalRemaining: number;
  interestAccruedSinceLastPayment: number;
  // What it would take to fully settle today: outstanding principal plus
  // interest that has accrued but hasn't been paid yet.
  currentPayoffBalance: number;
  // Per-payment interest/principal split, keyed by payment id.
  breakdown: AmortizationPaymentBreakdown[];
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_MONTH = 30.44;

function monthsBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / MS_PER_DAY) / DAYS_PER_MONTH;
}

// Brazil's two standard mortgage amortization systems (SFH/SFI loans, e.g.
// CAIXA). Both start from the same principal and monthly rate; they differ
// in what's held constant. PRICE (Tabela Price / French system) holds the
// *payment* constant — interest shrinks and amortization grows every month.
// SAC (Sistema de Amortização Constante) holds the *amortization* constant
// instead — interest and payment both shrink every month, front-loaded and
// higher at first but paying down principal faster overall.
export interface LoanScheduleRow {
  month: number;
  payment: number;
  interest: number;
  amortization: number;
  balance: number;
}

// The level monthly payment for a PRICE loan — solving the annuity formula
// for a fixed payment given principal, rate and term.
export function pricePayment(principal: number, monthlyRatePercent: number, termMonths: number): number {
  const r = monthlyRatePercent / 100;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - (1 + r) ** -termMonths);
}

export function priceSchedule(
  principal: number,
  monthlyRatePercent: number,
  termMonths: number
): LoanScheduleRow[] {
  const r = monthlyRatePercent / 100;
  const payment = pricePayment(principal, monthlyRatePercent, termMonths);
  const rows: LoanScheduleRow[] = [];
  let balance = principal;
  for (let month = 1; month <= termMonths; month++) {
    const interest = balance * r;
    const amortization = payment - interest;
    balance = Math.max(0, balance - amortization);
    rows.push({ month, payment, interest, amortization, balance });
  }
  return rows;
}

// SAC's amortization portion is the same every month by definition — no
// need to walk the whole schedule just to find one month's payment.
export function sacPaymentForMonth(
  principal: number,
  monthlyRatePercent: number,
  termMonths: number,
  month: number
): number {
  const r = monthlyRatePercent / 100;
  const amortization = principal / termMonths;
  const balanceBefore = principal - amortization * (month - 1);
  return amortization + balanceBefore * r;
}

export function sacSchedule(
  principal: number,
  monthlyRatePercent: number,
  termMonths: number
): LoanScheduleRow[] {
  const r = monthlyRatePercent / 100;
  const amortization = principal / termMonths;
  const rows: LoanScheduleRow[] = [];
  let balance = principal;
  for (let month = 1; month <= termMonths; month++) {
    const interest = balance * r;
    const payment = amortization + interest;
    balance = Math.max(0, balance - amortization);
    rows.push({ month, payment, interest, amortization, balance });
  }
  return rows;
}

export function simulateAmortization(
  principal: number,
  monthlyRatePercent: number,
  startDate: string,
  payments: AmortizationPayment[],
  asOfDate: string = new Date().toISOString().slice(0, 10)
): AmortizationResult {
  const monthlyRate = monthlyRatePercent / 100;
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));

  let balance = principal;
  let prev = new Date(startDate).getTime();
  let totalInterestPaid = 0;
  let totalPrincipalPaid = 0;
  const breakdown: AmortizationPaymentBreakdown[] = [];

  for (const p of sorted) {
    const d = new Date(p.date).getTime();
    const growth = (1 + monthlyRate) ** monthsBetween(prev, d);
    const interest = balance * (growth - 1);
    const principalPortion = p.amount - interest;
    balance -= principalPortion;
    totalInterestPaid += interest;
    totalPrincipalPaid += principalPortion;
    breakdown.push({ ...p, interest, principal: principalPortion, balanceAfter: balance });
    prev = d;
  }

  const growthSince = (1 + monthlyRate) ** monthsBetween(prev, new Date(asOfDate).getTime());
  const interestAccruedSinceLastPayment = balance * (growthSince - 1);

  return {
    totalInterestPaid,
    totalPrincipalPaid,
    principalRemaining: balance,
    interestAccruedSinceLastPayment,
    currentPayoffBalance: balance + interestAccruedSinceLastPayment,
    breakdown,
  };
}
