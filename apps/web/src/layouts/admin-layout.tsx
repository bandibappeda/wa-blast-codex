import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import type { UserSummary } from "@wa-blast/contracts";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { api } from "../lib/api-client";

const navigation = [
  { label: "Dashboard", path: "/dashboard", icon: "01" },
  { label: "Contacts", path: "/contacts", icon: "02" },
  { label: "Templates", path: "/templates", icon: "03" },
  { label: "Campaigns", path: "/campaigns", icon: "04" },
  { label: "Gateways", path: "/gateways", icon: "05", adminOnly: true },
  { label: "Users", path: "/users", icon: "06", adminOnly: true },
  { label: "Audit log", path: "/audit", icon: "07", adminOnly: true },
];

export function AdminLayout({ user, children, onLogout }: { user: UserSummary; children: ReactNode; onLogout: () => void }) {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const visibleNavigation = navigation.filter((item) => !item.adminOnly || user.role === "admin");

  const logout = async () => {
    setLoggingOut(true);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      await api.post("/api/auth/logout", undefined, csrf.csrfToken);
    } finally {
      onLogout();
      navigate("/login");
      setLoggingOut(false);
    }
  };

  return (
    <div className="admin-frame">
      <aside className="admin-sidebar">
        <Link to="/dashboard" className="brand-lockup" aria-label="WA Blast dashboard"><span className="brand-mark">WB</span><span><strong>WA Blast</strong><small>operations console</small></span></Link>
        <Separator />
        <nav aria-label="Primary navigation" className="primary-nav"><span className="nav-label">Workspace</span>{visibleNavigation.map((item) => <NavLink key={item.path} to={item.path} className={({ isActive }) => `nav-item${isActive ? " is-active" : ""}`}><span className="nav-index">{item.icon}</span><span>{item.label}</span></NavLink>)}</nav>
        <div className="sidebar-footer"><div className="user-chip"><span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{user.displayName}</strong><small>{user.role}</small></span></div><Button variant="ghost" className="logout-button" onClick={() => void logout()} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</Button></div>
      </aside>
      <main className="admin-content">{children}</main>
    </div>
  );
}
