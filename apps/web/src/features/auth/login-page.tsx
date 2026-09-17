import { useState, type FormEvent } from "react";
import type { UserSummary } from "@wa-blast/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { ApiError, api } from "../../lib/api-client";

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: UserSummary) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await api.post<{ user: UserSummary }>("/api/auth/login", {
        email,
        password,
      });
      onAuthenticated(response.user);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) {
        setError("Terlalu banyak percobaan. Coba lagi beberapa menit lagi.");
      } else {
        setError("Email atau password tidak valid.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="eyebrow">WA BLAST / INTERNAL</div>
        <h1 id="login-title">Sign in to operations</h1>
        <p className="auth-subtitle">Kelola kontak, campaign, approval, dan delivery dari satu workspace.</p>
        <form className="auth-form" onSubmit={submit}>
          <div className="field-stack">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="field-stack">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error ? <Alert variant="destructive" role="alert"><AlertTitle>Sign in failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <Button type="submit" disabled={submitting} className="auth-submit">{submitting ? "Signing in…" : "Sign in"}</Button>
        </form>
      </section>
    </main>
  );
}
