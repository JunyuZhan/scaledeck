import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { auth, type Me } from "./api/client";
import { LangProvider, useI18n } from "./i18n";
import Layout from "./components/Layout";
import TranslationBanner from "./components/TranslationBanner";
import { BrandingProvider } from "./components/BrandingProvider";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Nodes from "./pages/Nodes";
import Users from "./pages/Users";
import PreAuthKeys from "./pages/PreAuthKeys";
import Policy from "./pages/Policy";
import SelfService from "./pages/SelfService";
import Events from "./pages/Events";
import Settings from "./pages/Settings";
import WebUsers from "./pages/WebUsers";

function AppInner() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();

  useEffect(() => {
    auth
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-graphite">{t("Loading…")}</div>;
  }

  return (
    <>
      <TranslationBanner />
      <Routes>
        <Route
          path="/login"
          element={
            me ? (
              <Navigate to="/" replace />
            ) : (
              <Login onLogin={() => auth.me().then(setMe)} />
            )
          }
        />
        {me ? (
          <Route element={<Layout me={me} onLogout={() => { setMe(null); }} />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/nodes" element={<Nodes />} />
            <Route path="/myself" element={<SelfService />} />
            {me.role === "admin" && (
              <>
                <Route path="/users" element={<Users />} />
                <Route path="/accounts" element={<WebUsers />} />
                <Route path="/keys" element={<PreAuthKeys />} />
                <Route path="/policy" element={<Policy />} />
              <Route path="/events" element={<Events />} />
              <Route path="/settings" element={<Settings />} />
              </>
            )}
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <LangProvider>
      <BrandingProvider>
        <AppInner />
      </BrandingProvider>
    </LangProvider>
  );
}
