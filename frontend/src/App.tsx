import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BillsPage } from "./pages/Bills";
import { ConfigPage } from "./pages/Config";
import { ConfigAppSettings } from "./pages/ConfigAppSettings";
import { ConfigCategories } from "./pages/ConfigCategories";
import { ConfigNotifications } from "./pages/ConfigNotifications";
import { ConfigPeople } from "./pages/ConfigPeople";
import { ConfigUserProfile } from "./pages/ConfigUserProfile";
import { DashboardPage } from "./pages/Dashboard";
import { DebtsPage } from "./pages/Debts";
import { HouseholdPage } from "./pages/Household";
import { ProjectionsPage } from "./pages/Projections";
import { TransactionsPage } from "./pages/Transactions";

export function App() {
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
          <Route path="notifications" element={<ConfigNotifications />} />
          <Route path="categories" element={<ConfigCategories />} />
          <Route path="app-settings" element={<ConfigAppSettings />} />
        </Route>
        <Route path="/config/users/:id" element={<ConfigUserProfile />} />
      </Routes>
    </Layout>
  );
}
