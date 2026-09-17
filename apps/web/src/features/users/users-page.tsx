import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { ApiError, api } from "../../lib/api-client";

interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "operator";
  status: "active" | "disabled";
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UsersResponse {
  users: UserRecord[];
}

interface UserMutationResponse {
  user: UserRecord;
  temporaryPassword?: string;
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "", role: "operator" as UserRecord["role"] });

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await api.get<UsersResponse>("/api/users");
      setUsers(response.users);
      setError(null);
    } catch {
      setError("Users could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking("create");
    setTemporaryPassword(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      const result = await api.post<UserMutationResponse>("/api/users", form, csrf.csrfToken);
      setUsers((current) => [...current, result.user].sort((left, right) => left.displayName.localeCompare(right.displayName)));
      setForm({ email: "", displayName: "", role: "operator" });
      setShowCreateForm(false);
      setTemporaryPassword(result.temporaryPassword ?? null);
      setError(null);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setWorking(null);
    }
  };

  const updateUser = async (user: UserRecord, change: { role?: UserRecord["role"]; status?: UserRecord["status"] }) => {
    setWorking(user.id);
    setTemporaryPassword(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      const updated = await api.patch<UserRecord>(`/api/users/${user.id}`, change, csrf.csrfToken);
      setUsers((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setError(null);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setWorking(null);
    }
  };

  const resetPassword = async (user: UserRecord) => {
    setWorking(user.id);
    setTemporaryPassword(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      const result = await api.post<UserMutationResponse>(`/api/users/${user.id}/reset-password`, {}, csrf.csrfToken);
      setUsers((current) => current.map((entry) => entry.id === result.user.id ? result.user : entry));
      setTemporaryPassword(result.temporaryPassword ?? null);
      setError(null);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setWorking(null);
    }
  };

  return <section className="page-shell users-page">
    <div className="page-heading">
      <div><div className="eyebrow">ACCESS / PEOPLE</div><h1>Users</h1><p>Manage workspace access, roles, and temporary credentials.</p></div>
      <Button onClick={() => { setShowCreateForm((visible) => !visible); setTemporaryPassword(null); }}>{showCreateForm ? "Close form" : "Create user"}</Button>
    </div>

    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {temporaryPassword ? <div className="temporary-password" role="status"><div><div className="eyebrow">ONE-TIME CREDENTIAL</div><strong>{temporaryPassword}</strong><p>Copy this password now and share it out of band. It will not be shown again.</p></div><Button variant="ghost" onClick={() => setTemporaryPassword(null)}>Dismiss</Button></div> : null}

    {showCreateForm ? <form className="user-form-panel" onSubmit={(event) => void createUser(event)}>
      <div><div className="eyebrow">NEW ACCOUNT</div><h2>Create user</h2><p>A generated temporary password will require a password change at first sign-in.</p></div>
      <div className="user-form-fields">
        <label className="field-stack"><span>Display name</span><Input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label>
        <label className="field-stack"><span>Email</span><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
        <label className="field-stack"><span>Role</span><select className="inline-select" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRecord["role"] })}><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
      </div>
      <div className="dialog-actions"><Button type="submit" disabled={working === "create"}>{working === "create" ? "Creating…" : "Create account"}</Button></div>
    </form> : null}

    <div className="section-heading users-section-heading"><div><div className="eyebrow">WORKSPACE ACCESS</div><h2>Team accounts</h2></div><span className="toolbar-note">{users.length} account{users.length === 1 ? "" : "s"}</span></div>
    {loading ? <p className="toolbar-note">Loading users…</p> : users.length === 0 ? <div className="empty-panel"><span className="empty-index">NONE</span><div><h2>No users found</h2><p>Create the first workspace account to begin.</p></div></div> : <div className="data-table users-table"><Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Password</TableHead><TableHead className="action-column">Actions</TableHead></TableRow></TableHeader><TableBody>{users.map((user) => <TableRow key={user.id}><TableCell><strong>{user.displayName}</strong><small className="table-subline">{user.email}</small></TableCell><TableCell><select className="inline-select inline-select-small" value={user.role} disabled={working === user.id} onChange={(event) => void updateUser(user, { role: event.target.value as UserRecord["role"] })} aria-label={`Role for ${user.displayName}`}><option value="operator">Operator</option><option value="admin">Admin</option></select></TableCell><TableCell><Badge variant={user.status === "active" ? "secondary" : "outline"}>{user.status}</Badge></TableCell><TableCell>{user.mustChangePassword ? <span className="table-note">Change required</span> : <span className="table-note">Set</span>}</TableCell><TableCell className="action-column"><div className="table-actions"><Button variant="ghost" size="sm" disabled={working === user.id} onClick={() => void updateUser(user, { status: user.status === "active" ? "disabled" : "active" })}>{user.status === "active" ? "Disable" : "Enable"}</Button><Button variant="outline" size="sm" disabled={working === user.id} onClick={() => void resetPassword(user)}>Reset password</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
  </section>;
}

function readError(error: unknown): string {
  if (!(error instanceof ApiError)) return "The request could not be completed.";
  const messages: Record<string, string> = {
    email_already_exists: "That email is already in use.",
    last_active_admin: "The final active admin cannot be disabled or demoted.",
    reauthentication_required: "Reauthentication is required before this sensitive action.",
    csrf_required: "Your session token expired. Refresh and try again.",
  };
  return messages[error.code] ?? "The request could not be completed.";
}
