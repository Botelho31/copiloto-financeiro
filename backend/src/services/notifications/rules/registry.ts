import { largeTransactionRule } from "./largeTransaction";
import { projectedShortfallRule } from "./projectedShortfall";
import type { NotificationRule } from "./types";

// Adding a rule is: write one more NotificationRule (see largeTransaction.ts/
// projectedShortfall.ts for the shape) and register it here — the dispatch
// loop, the rule-settings route, and rules/settings.ts all iterate this list
// generically. Kept in its own file (rather than index.ts) so
// rules/settings.ts can import it without a circular dependency on index.ts.
export const ALL_RULES: NotificationRule[] = [largeTransactionRule, projectedShortfallRule];
