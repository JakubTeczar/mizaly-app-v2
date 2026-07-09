import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAdminAuth } from "./lib/authContext";
import AdminLayout from "./components/AdminLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import OrganizationsPage from "./pages/OrganizationsPage";
import SystemConfigPage from "./pages/SystemConfigPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAdminAuth>
            <AdminLayout />
          </RequireAdminAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="system" element={<SystemConfigPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
