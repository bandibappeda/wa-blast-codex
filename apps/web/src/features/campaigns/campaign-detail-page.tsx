import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { UserSummary } from "@wa-blast/contracts";
import { api } from "../../lib/api-client";
import { ApprovalDialog } from "./approval-dialog";
import { DeliveryResults } from "./delivery-results";

interface Detail { campaign: { id: string; name: string; version: number; state: string; scheduleAtUtc: string | null }; summary: { total: number; eligible: number; suppressed: number; missingConsent: number; missingVariables: number; invalid: number }; scheduleAtUtc: string | null; scheduleAtLocal: string | null; organizationTimeZone: string; gatewayWarning: string | null; }

export function CampaignDetailPage({ campaignId, user }: { campaignId: string; user: UserSummary }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => setDetail(await api.post<Detail>(`/api/campaigns/${campaignId}/preview`, undefined, (await api.get<{ csrfToken: string }>("/api/auth/csrf")).csrfToken));
  const submitForApproval = async () => {
    if (!detail) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      await api.post(`/api/campaigns/${campaignId}/submit`, { version: detail.campaign.version }, csrf.csrfToken);
      setMessage("Campaign submitted for admin approval.");
      await load();
    } catch {
      setMessage("Campaign could not be submitted. Check eligibility and gateway health.");
    } finally {
      setSubmitting(false);
    }
  };
  useEffect(() => { void load(); }, [campaignId]);
  if (!detail) return <section className="page-shell"><p>Loading campaign…</p></section>;
  return <section className="page-shell"><div className="page-heading"><div><div className="eyebrow">CAMPAIGN / REVIEW</div><h1>{detail.campaign.name}</h1><p>{detail.campaign.state} · version {detail.campaign.version}</p></div><div className="page-heading-actions"><Badge variant="outline">{detail.summary.eligible} eligible</Badge>{detail.campaign.state === "draft" ? <Button onClick={() => void submitForApproval()} disabled={submitting || detail.summary.eligible !== detail.summary.total}>{submitting ? "Submitting…" : "Submit for approval"}</Button> : null}{user.role === "admin" && detail.campaign.state === "pending_approval" ? <Button onClick={() => setApprovalOpen(true)}>Review approval</Button> : null}</div></div><div className="metric-grid"><Metric label="Total audience" value={detail.summary.total} /><Metric label="Eligible" value={detail.summary.eligible} /><Metric label="Excluded" value={detail.summary.total - detail.summary.eligible} /><Metric label="Schedule" value={detail.scheduleAtLocal ?? "Immediate"} /></div><div className="review-panel"><span className="eyebrow">ELIGIBILITY</span><p>Suppressed {detail.summary.suppressed} · Missing consent {detail.summary.missingConsent} · Missing variables {detail.summary.missingVariables} · Invalid {detail.summary.invalid}</p>{detail.gatewayWarning ? <p className="form-error">Gateway warning: {detail.gatewayWarning}</p> : null}{message ? <p className="toolbar-note" role="status">{message}</p> : null}</div><DeliveryResults campaignId={campaignId} />{approvalOpen ? <ApprovalDialog campaignId={detail.campaign.id} version={detail.campaign.version} summary={{ eligible: detail.summary.eligible, excluded: detail.summary.total - detail.summary.eligible }} onClose={() => setApprovalOpen(false)} onApproved={async () => { setApprovalOpen(false); await load(); }} /> : null}</section>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <article className="metric-panel"><span>{label}</span><strong>{value}</strong></article>; }
