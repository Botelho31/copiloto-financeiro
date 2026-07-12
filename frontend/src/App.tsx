import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BillsPage } from "./pages/Bills";
import { ConfigPage } from "./pages/Config";
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
        <Route path="/config" element={<ConfigPage />} />
      </Routes>
    </Layout>
  );
}
