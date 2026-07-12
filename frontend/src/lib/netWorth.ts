import type { Account, Investment } from "shared";

export interface NetWorthBreakdown {
  bankBalance: number;
  cardBalance: number;
  investmentBalance: number;
  netWorth: number;
}

// The one place "bank + investment balance" is summed from raw accounts/
// investments — Dashboard.tsx and Household.tsx both used to compute this
// independently (same filter predicates, but two copies with no structural
// reason to stay in sync) — see backend/API-ARCHITECTURE.md's R6.
export function computeNetWorth(accounts: Account[], investments: Investment[]): NetWorthBreakdown {
  const bankBalance = accounts
    .filter((a) => a.type === "BANK")
    .reduce((sum, a) => sum + a.balance, 0);
  const cardBalance = accounts
    .filter((a) => a.type === "CREDIT")
    .reduce((sum, a) => sum + a.balance, 0);
  // fully-withdrawn positions aren't current holdings
  const investmentBalance = investments
    .filter((i) => i.status === "ACTIVE")
    .reduce((sum, i) => sum + i.balance, 0);
  return { bankBalance, cardBalance, investmentBalance, netWorth: bankBalance + investmentBalance };
}
