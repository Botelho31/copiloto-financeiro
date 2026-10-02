import { useTranslation } from "react-i18next";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useVaultStatus } from "./hooks/useVault";
import { BillsPage } from "./pages/Bills";
import { ConfigApiKeys } from "./pages/ConfigApiKeys";
import { ConfigPage } from "./pages/Config";
import { ConfigAppSettings } from "./pages/ConfigAppSettings";
import { ConfigCategories } from "./pages/ConfigCategories";
import { ConfigPeople } from "./pages/ConfigPeople";
import { ConfigUserProfile } from "./pages/ConfigUserProfile";
import { DashboardPage } from "./pages/Dashboard";
import { DebtsPage } from "./pages/Debts";
import { HouseholdPage } from "./pages/Household";
import { ProjectionsPage } from "./pages/Projections";
import { TransactionsPage } from "./pages/Transactions";
import { VaultSetup } from "./pages/VaultSetup";
import { VaultUnlock } from "./pages/VaultUnlock";

export function App() {
  const { t } = useTranslation("vault");
  const { data: vaultStatus, isLoading } = useVaultStatus();

  // Gated above the whole Layout/Routes tree, not inside it — the setup and
  // unlock screens are deliberately chrome-less (no nav, no person switcher,
  // none of it makes sense before the vault is open).
  if (isLoading || !vaultStatus) return <p className="muted">{t("loading")}</p>;
  if (!vaultStatus.hasVault) return <VaultSetup />;
  if (!vaultStatus.unlocked) return <VaultUnlock />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/debts" element={<DebtsPage />} />
        <Route path="/projections" element={<ProjectionsPage />} />
        <Route path="/household" element={<HouseholdPage />} />
        <Route path="/config" element={<ConfigPage />}>
          <Route index element={<ConfigPeople />} />
          <Route path="categories" element={<ConfigCategories />} />
          <Route path="app-settings" element={<ConfigAppSettings />} />
          <Route path="api-keys" element={<ConfigApiKeys />} />
        </Route>
        <Route path="/config/users/:id" element={<ConfigUserProfile />} />
      </Routes>
    </Layout>
  );
}
