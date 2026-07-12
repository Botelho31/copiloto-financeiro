import { useTranslation } from "react-i18next";
import { ColorSwatch } from "../components/ColorSwatch";
import { SummaryCard } from "../components/SummaryCard";
import { SortableTh } from "../components/SortableTh";
import { useAccounts } from "../hooks/useAccounts";
import { useDebts } from "../hooks/useDebts";
import { useInvestments } from "../hooks/useInvestments";
import { useProjections } from "../hooks/useProjections";
import { useSortableTable } from "../hooks/useSortableTable";
import { useUsers } from "../hooks/useUsers";
import { formatMoney, formatMonthLabel } from "../lib/format";
import { computeNetWorth } from "../lib/netWorth";
import { HOUSEHOLD_PROJECTION_HORIZON_MONTHS } from "../config";
import type { Account, Investment, User } from "shared";

interface PersonBreakdown {
  user: User;
  bankBalance: number;
  cardBalance: number;
  investments: number;
  netWorth: number;
}

function buildBreakdown(
  users: User[],
  accounts: Account[],
  investments: Investment[]
): PersonBreakdown[] {
  return users.map((user) => {
    const ownAccounts = accounts.filter((a) => a.user_id === user.id);
    const ownInvestments = investments.filter((i) => i.user_id === user.id);
    const nw = computeNetWorth(ownAccounts, ownInvestments);
    return {
      user,
      bankBalance: nw.bankBalance,
      cardBalance: nw.cardBalance,
      investments: nw.investmentBalance,
      netWorth: nw.netWorth,
    };
  });
}

function PersonBreakdownTable(props: { rows: PersonBreakdown[] }) {
  const { t } = useTranslation("household");
  const { sorted, sortKey, direction, toggleSort } = useSortableTable<PersonBreakdown>(
    props.rows,
    (r, key) => {
      switch (key) {
        case "bank":
          return r.bankBalance;
        case "card":
          return r.cardBalance;
        case "investments":
          return r.investments;
        case "netWorth":
          return r.netWorth;
        default:
          return r.user.name;
      }
    },
    "netWorth"
  );

  return (
    <table>
      <thead>
        <tr>
          <SortableTh
            label={t("breakdown.person")}
            sortKey="name"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("breakdown.bankBalance")}
            sortKey="bank"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("breakdown.cardBalance")}
            sortKey="card"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("breakdown.investments")}
            sortKey="investments"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("breakdown.netWorth")}
            sortKey="netWorth"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.user.id}>
            <td>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <ColorSwatch color={r.user.color} />
                {r.user.name}
              </span>
            </td>
            <td className="money">{formatMoney(r.bankBalance)}</td>
            <td className="money">{formatMoney(r.cardBalance)}</td>
            <td className="money">{formatMoney(r.investments)}</td>
            <td className="money" style={{ fontWeight: 600 }}>
              {formatMoney(r.netWorth)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HouseholdPage() {
  const { t } = useTranslation("household");
  const { data: users } = useUsers();
  // These read the ambient nav-switcher scope — visiting this page with a
  // specific person selected just narrows it to them; picking "Household"
  // (the default) combines everyone, which is the page's main point.
  const { data: accounts } = useAccounts();
  const { data: investments } = useInvestments();
  const { data: debts } = useDebts();
  const { data: projections } = useProjections(HOUSEHOLD_PROJECTION_HORIZON_MONTHS);

  const { bankBalance, cardBalance, netWorth } = computeNetWorth(accounts ?? [], investments ?? []);

  const activeDebts = (debts ?? []).filter((d) => d.status === "active");
  const owedByHousehold = activeDebts
    .filter((d) => d.direction === "owed_by_me")
    .reduce((sum, d) => sum + d.remaining, 0);
  const owedToHousehold = activeDebts
    .filter((d) => d.direction === "owed_to_me")
    .reduce((sum, d) => sum + d.remaining, 0);

  const nextMonth = projections?.months[0];
  const hasShortfall = (projections?.months ?? []).some((m) => m.shortfall);

  const breakdown = buildBreakdown(users ?? [], accounts ?? [], investments ?? []);

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2>{t("title")}</h2>
        <p className="muted">{t("subtitle")}</p>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
        >
          <SummaryCard label={t("summary.netWorth")} value={formatMoney(netWorth)} />
          <SummaryCard label={t("summary.bankBalance")} value={formatMoney(bankBalance)} />
          <SummaryCard
            label={t("summary.cardBalance")}
            value={formatMoney(cardBalance)}
            tone={cardBalance > 0 ? "negative" : undefined}
          />
          <SummaryCard label={t("summary.owedByHousehold")} value={formatMoney(owedByHousehold)} />
          <SummaryCard label={t("summary.owedToHousehold")} value={formatMoney(owedToHousehold)} />
          <SummaryCard
            label={t("summary.nextMonth")}
            value={nextMonth ? formatMoney(nextMonth.balance) : "—"}
            tone={hasShortfall ? "bad" : "good"}
            caption={nextMonth ? formatMonthLabel(nextMonth.label) : undefined}
          />
        </div>
      </div>

      <div className="card">
        <h2>{t("breakdown.title")}</h2>
        <p className="muted">{t("breakdown.subtitle")}</p>
        {breakdown.length > 0 ? (
          <PersonBreakdownTable rows={breakdown} />
        ) : (
          <p className="muted">{t("breakdown.empty")}</p>
        )}
      </div>
    </div>
  );
}
