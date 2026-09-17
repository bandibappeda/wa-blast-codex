import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthProvider, useAuth } from "./features/auth/auth-provider";
import { ChangePasswordPage } from "./features/auth/change-password-page";
import { LoginPage } from "./features/auth/login-page";
import { AuditPage } from "./features/audit/audit-page";
import { ContactsPage } from "./features/contacts/contacts-page";
import { DashboardPage } from "./features/dashboard/dashboard-page";
import { GatewaysPage } from "./features/gateways/gateways-page";
import { UsersPage } from "./features/users/users-page";
import { TemplatesPage } from "./features/templates/templates-page";
import { CampaignsPage } from "./features/campaigns/campaigns-page";
import { CampaignDetailPage } from "./features/campaigns/campaign-detail-page";
import { AdminLayout } from "./layouts/admin-layout";
import "./App.css";

function App() {
  return <BrowserRouter><AuthProvider><TooltipProvider><AppRoutes /></TooltipProvider></AuthProvider></BrowserRouter>;
}

function AppRoutes() {
  const { user, loading, setUser } = useAuth();
  if (loading) return <div className="app-loading">Loading workspace…</div>;
  return <Routes>
    <Route path="/login" element={user ? <Navigate to={user.mustChangePassword ? "/change-password" : "/dashboard"} replace /> : <LoginPage onAuthenticated={setUser} />} />
    <Route path="/change-password" element={user ? <ChangePasswordPage onChanged={setUser} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={user ? <ProtectedRoutes user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" replace />} />
  </Routes>;
}

function ProtectedRoutes({ user, onLogout }: { user: NonNullable<ReturnType<typeof useAuth>["user"]>; onLogout: () => void }) {
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <AdminLayout user={user} onLogout={onLogout}><Routes>
    <Route path="/dashboard" element={<DashboardPage />} />
    <Route path="/contacts" element={<ContactsPage user={user} />} />
    <Route path="/templates" element={<TemplatesPage />} />
    <Route path="/campaigns" element={<CampaignsPage />} />
    <Route path="/campaigns/:campaignId" element={<CampaignDetailRoute user={user} />} />
    <Route path="/gateways" element={user.role === "admin" ? <GatewaysPage /> : <Forbidden />} />
    <Route path="/users" element={user.role === "admin" ? <UsersPage /> : <Forbidden />} />
    <Route path="/audit" element={user.role === "admin" ? <AuditPage /> : <Forbidden />} />
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes></AdminLayout>;
}

function CampaignDetailRoute({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const { campaignId = "" } = useParams();
  return <CampaignDetailPage campaignId={campaignId} user={user} />;
}

function Forbidden() { return <section className="page-shell"><div className="empty-panel"><span className="empty-index">403</span><div><h2>Access restricted</h2><p>Your role does not have access to this module.</p></div></div></section>; }

export default App;
