import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { api } from "../../lib/api-client";
import { CampaignEditor, type CampaignContactOption, type CampaignGatewayOption, type CampaignTemplateOption } from "./campaign-editor";

interface CampaignSummary { id: string; name: string; gatewayId: string; templateId: string; scheduleAtUtc: string | null; state: string; version: number; contactIds: string[]; tagNames: string[]; createdAt: string; updatedAt: string; }

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [gateways, setGateways] = useState<CampaignGatewayOption[]>([]);
  const [templates, setTemplates] = useState<CampaignTemplateOption[]>([]);
  const [contacts, setContacts] = useState<CampaignContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [campaignResult, gatewayResult, templateResult, contactResult] = await Promise.all([
        api.get<{ campaigns: CampaignSummary[] }>("/api/campaigns"),
        api.get<{ gateways: CampaignGatewayOption[] }>("/api/gateways"),
        api.get<{ templates: CampaignTemplateOption[] }>("/api/templates"),
        api.get<{ contacts: CampaignContactOption[] }>("/api/contacts"),
      ]);
      setCampaigns(campaignResult.campaigns);
      setGateways(gatewayResult.gateways);
      setTemplates(templateResult.templates);
      setContacts(contactResult.contacts);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (editing) return <section className="page-shell"><CampaignEditor gateways={gateways} templates={templates} contacts={contacts} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }} /></section>;
  return <section className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">OUTBOUND / CAMPAIGNS</div><h1>Campaigns</h1><p>Draft, preview, and submit campaigns for approval.</p></div><Button onClick={() => setEditing(true)} disabled={!gateways.length || !templates.length}>New campaign</Button></div>
    {!gateways.length || !templates.length ? <p className="toolbar-note" role="status">Create at least one healthy gateway and one template before drafting.</p> : null}
    <div className="data-table"><Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>State</TableHead><TableHead>Audience</TableHead><TableHead>Schedule</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={5}>Loading campaigns…</TableCell></TableRow> : campaigns.length === 0 ? <TableRow><TableCell colSpan={5}>No campaign drafts yet.</TableCell></TableRow> : campaigns.map((campaign) => <TableRow key={campaign.id}><TableCell><Link className="table-link" to={`/campaigns/${campaign.id}`}><strong>{campaign.name}</strong><small className="table-subline">Version {campaign.version}</small></Link></TableCell><TableCell><Badge variant={campaign.state === "pending_approval" ? "secondary" : campaign.state === "cancelled" ? "destructive" : "outline"}>{campaign.state.replaceAll("_", " ")}</Badge></TableCell><TableCell>{campaign.contactIds.length || campaign.tagNames.length ? `${campaign.contactIds.length} contacts${campaign.tagNames.length ? ` · ${campaign.tagNames.length} tags` : ""}` : "No audience"}</TableCell><TableCell className="mono-cell">{campaign.scheduleAtUtc ? new Date(campaign.scheduleAtUtc).toLocaleString() : "Immediate"}</TableCell><TableCell className="mono-cell">{new Date(campaign.updatedAt).toLocaleDateString()}</TableCell></TableRow>)}</TableBody></Table></div>
  </section>;
}
