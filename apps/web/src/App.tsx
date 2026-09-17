import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import { Badge } from "./components/ui/badge";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthProvider, useAuth } from "./features/auth/auth-provider";
import { ChangePasswordPage } from "./features/auth/change-password-page";
import { LoginPage } from "./features/auth/login-page";
import { AdminLayout } from "./layouts/admin-layout";
import { ContactsPage } from "./features/contacts/contacts-page";
import { GatewaysPage } from "./features/gateways/gateways-page";
import { TemplatesPage } from "./features/templates/templates-page";
import { CampaignsPage } from "./features/campaigns/campaigns-page";
import { CampaignDetailPage } from "./features/campaigns/campaign-detail-page";
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
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/contacts" element={<ContactsPage user={user} />} />
    <Route path="/templates" element={<TemplatesPage />} />
    <Route path="/campaigns" element={<CampaignsPage />} />
    <Route path="/campaigns/:campaignId" element={<CampaignDetailRoute user={user} />} />
    <Route path="/gateways" element={user.role === "admin" ? <GatewaysPage /> : <Forbidden />} />
    <Route path="/users" element={user.role === "admin" ? <Placeholder title="Users" description="Manage internal access and roles." /> : <Forbidden />} />
    <Route path="/audit" element={user.role === "admin" ? <Placeholder title="Audit log" description="Review sensitive actions and state changes." /> : <Forbidden />} />
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes></AdminLayout>;
}

function Dashboard() {
  return <section className="page-shell"><div className="page-heading"><div><div className="eyebrow">OPERATIONS / TODAY</div><h1>Dashboard</h1><p>Monitor campaign work without losing the next action.</p></div><Badge variant="outline">Mock gateway ready</Badge></div><div className="metric-grid"><Metric label="Queue depth" value="0" detail="No pending jobs" /><Metric label="Active campaigns" value="0" detail="Nothing running" /><Metric label="Delivery rate" value="—" detail="Awaiting first campaign" /><Metric label="Gateway health" value="OK" detail="Mock adapter" /></div><div className="empty-panel"><span className="empty-index">NEXT</span><div><h2>Prepare your first campaign</h2><p>Import consented contacts, create a template, then submit a campaign for approval.</p></div></div></section>;
}

function CampaignDetailRoute({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const { campaignId = "" } = useParams();
  return <CampaignDetailPage campaignId={campaignId} user={user} />;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric-panel"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Placeholder({ title, description }: { title: string; description: string }) { return <section className="page-shell"><div className="page-heading"><div><div className="eyebrow">WORKSPACE MODULE</div><h1>{title}</h1><p>{description}</p></div></div><div className="empty-panel"><span className="empty-index">BUILD</span><div><h2>Module ready for data</h2><p>This surface is wired into the authenticated shell. The next implementation task adds its API and workflow.</p></div></div></section>; }
function Forbidden() { return <section className="page-shell"><div className="empty-panel"><span className="empty-index">403</span><div><h2>Access restricted</h2><p>Your role does not have access to this module.</p></div></div></section>; }

export default App;
