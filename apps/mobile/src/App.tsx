import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, RequireAuth } from "./lib/authContext";
import { MobileLayout } from "./components/MobileLayout";
import { ComingSoonPage } from "./components/ComingSoonPage";
import { LoginPage } from "./pages/LoginPage";
import { InspiracjePage } from "./pages/InspiracjePage";
import { TworzeniePage } from "./pages/TworzeniePage";
import { AnalitykePage } from "./pages/AnalitykePage";
import { WiadomosciPage } from "./pages/WiadomosciPage";
import { KontaPage } from "./pages/KontaPage";
import { FEATURE_FLAGS } from "./lib/featureFlags";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <RequireAuth>
              <MobileLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/tworzenie" replace />} />
          <Route path="inspiracje" element={<InspiracjePage />} />
          <Route path="tworzenie" element={<TworzeniePage />} />
          <Route path="analityke" element={<AnalitykePage />} />
          <Route
            path="wiadomosci"
            element={FEATURE_FLAGS.wiadomosci ? <ComingSoonPage title="Wiadomości" /> : <WiadomosciPage />}
          />
          <Route path="konta" element={<KontaPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
