import { useState, type FormEvent } from "react";
import type { UserSummary } from "@wa-blast/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { ApiError, api } from "../../lib/api-client";

export function ChangePasswordPage({ onChanged }: { onChanged: (user: UserSummary) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      const response = await api.post<{ user: UserSummary }>("/api/auth/change-password", { currentPassword, newPassword }, csrf.csrfToken);
      onChanged(response.user);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 400 ? "Password baru minimal 12 karakter." : "Password saat ini tidak valid atau perubahan gagal.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="change-password-title">
        <div className="eyebrow">SECURITY CHECK</div>
        <h1 id="change-password-title">Change your password</h1>
        <p className="auth-subtitle">Password sementara harus diganti sebelum workspace dapat digunakan.</p>
        <form className="auth-form" onSubmit={submit}>
          <div className="field-stack"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
          <div className="field-stack"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div>
          {error ? <Alert variant="destructive" role="alert"><AlertTitle>Could not change password</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <Button type="submit" disabled={submitting} className="auth-submit">{submitting ? "Saving…" : "Save password"}</Button>
        </form>
      </section>
    </main>
  );
}
