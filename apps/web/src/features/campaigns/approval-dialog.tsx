import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { api, ApiError } from "../../lib/api-client";

export function ApprovalDialog({ campaignId, version, summary, onClose, onApproved }: { campaignId: string; version: number; summary: { eligible: number; excluded: number }; onClose: () => void; onApproved: () => void | Promise<void> }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const approve = async () => {
    setSaving(true);
    setMessage(null);
    try {
      let csrf = (await api.get<{ csrfToken: string }>("/api/auth/csrf")).csrfToken;
      if (reauthRequired) {
        await api.post("/api/auth/reauthenticate", { password }, csrf);
        csrf = (await api.get<{ csrfToken: string }>("/api/auth/csrf")).csrfToken;
      }
      await api.post(`/api/campaigns/${campaignId}/approve`, { version }, csrf);
      setMessage("Campaign approved.");
      await onApproved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "reauthentication_required") setReauthRequired(true);
      else setMessage("Approval gagal. Periksa eligibility dan versi draft.");
    } finally { setSaving(false); }
  };

  return <div className="gateway-dialog-backdrop" role="presentation"><section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="dialog-heading"><div><div className="eyebrow">IRREVERSIBLE COMMAND</div><h2 id="approval-title">Approve campaign</h2></div><Button variant="ghost" onClick={onClose}>Close</Button></div><p className="approval-warning">Approval freezes recipients, rendered messages, gateway, schedule, and attachment metadata. This cannot be undone after a job is claimed.</p><div className="approval-counts"><strong>{summary.eligible}</strong><span>eligible recipients</span><strong>{summary.excluded}</strong><span>excluded at preview</span></div>{confirmOpen ? <div className="approval-confirm"><label className="approval-check"><input type="checkbox" aria-label="I understand this action" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I understand this action creates delivery jobs.</label>{reauthRequired ? <div className="field-stack"><Label htmlFor="approval-password">Current password</Label><Input id="approval-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div> : null}</div> : null}{message ? <p className="toolbar-note" role="status">{message}</p> : null}<div className="dialog-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => { if (!confirmOpen) setConfirmOpen(true); else void approve(); }} disabled={saving || (confirmOpen && !confirmed)}>{saving ? "Approving…" : "Approve campaign"}</Button></div></section></div>;
}
