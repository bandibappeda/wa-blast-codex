import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { api, ApiError } from "../../lib/api-client";

export function GatewayDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [senderIdentity, setSenderIdentity] = useState("");
  const [token, setToken] = useState("");
  const [messagesPerMinute, setMessagesPerMinute] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      await api.post("/api/gateways", {
        name,
        adapterType: "mock",
        senderIdentity,
        credentials: token ? { token } : {},
        messagesPerMinute: Number(messagesPerMinute),
      }, csrf.csrfToken);
      await onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === "reauthentication_required"
        ? "Re-authenticate before changing gateway credentials."
        : "Gateway tidak dapat disimpan.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="gateway-dialog-backdrop" role="presentation">
    <form className="gateway-dialog" role="dialog" aria-modal="true" aria-labelledby="gateway-dialog-title" onSubmit={(event) => void submit(event)}>
      <div className="dialog-heading"><div><div className="eyebrow">NEW CONNECTION</div><h2 id="gateway-dialog-title">Add gateway</h2></div><Button type="button" variant="ghost" onClick={onClose}>Close</Button></div>
      <p className="toolbar-note">Credentials are encrypted at rest and are never shown after save.</p>
      <div className="dialog-fields">
        <div className="field-stack"><Label htmlFor="gateway-name">Connection name</Label><Input id="gateway-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
        <div className="field-stack"><Label htmlFor="gateway-sender">Sender identity</Label><Input id="gateway-sender" value={senderIdentity} onChange={(event) => setSenderIdentity(event.target.value)} placeholder="62811…" required /></div>
        <div className="field-stack"><Label htmlFor="gateway-token">Credential token</Label><Input id="gateway-token" type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Optional for mock adapter" /></div>
        <div className="field-stack"><Label htmlFor="gateway-rate">Messages per minute</Label><Input id="gateway-rate" type="number" min={1} max={600} value={messagesPerMinute} onChange={(event) => setMessagesPerMinute(event.target.value)} required /></div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save gateway"}</Button></div>
    </form>
  </div>;
}
