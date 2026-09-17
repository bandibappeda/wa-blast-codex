import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { api, ApiError } from "../../lib/api-client";
import { GatewayDialog } from "./gateway-dialog";

export interface GatewaySummary {
  id: string;
  name: string;
  adapterType: string;
  senderIdentity: string;
  messagesPerMinute: number;
  enabled: boolean;
  healthStatus: "unknown" | "healthy" | "unhealthy";
  lastHealthCheckedAt: string | null;
  consecutiveFailures: number;
  unhealthyUntil: string | null;
}

export function GatewaysPage() {
  const [gateways, setGateways] = useState<GatewaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<{ gateways: GatewaySummary[] }>("/api/gateways");
      setGateways(result.gateways);
    } catch {
      setMessage("Gateway tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const checkHealth = async (gateway: GatewaySummary) => {
    setMessage(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      await api.post(`/api/gateways/${gateway.id}/health`, undefined, csrf.csrfToken);
      await load();
    } catch (cause) {
      setMessage(cause instanceof ApiError && cause.code === "reauthentication_required" ? "Re-authenticate to check gateway health." : "Health check gagal.");
    }
  };

  return <section className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">INTEGRATIONS / GATEWAYS</div><h1>Gateway connections</h1><p>Manage senders, pacing, and provider health.</p></div><Button onClick={() => setDialogOpen(true)}>Add gateway</Button></div>
    {message ? <p className="toolbar-note" role="status">{message}</p> : null}
    <div className="data-table gateway-table"><Table><TableHeader><TableRow><TableHead>Connection</TableHead><TableHead>Sender</TableHead><TableHead>Adapter</TableHead><TableHead>Rate</TableHead><TableHead>Health</TableHead><TableHead>Status</TableHead><TableHead className="action-column">Actions</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={7}>Loading gateways…</TableCell></TableRow> : gateways.length === 0 ? <TableRow><TableCell colSpan={7}>No gateway connections configured.</TableCell></TableRow> : gateways.map((gateway) => <TableRow key={gateway.id}><TableCell><strong>{gateway.name}</strong></TableCell><TableCell className="mono-cell">{gateway.senderIdentity}</TableCell><TableCell><Badge variant="outline">{gateway.adapterType}</Badge></TableCell><TableCell>{gateway.messagesPerMinute}/min</TableCell><TableCell><span className={`status-label status-${gateway.healthStatus}`}><span className="status-dot" aria-hidden="true" />{gateway.healthStatus}</span></TableCell><TableCell>{gateway.enabled ? <Badge variant="secondary">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}</TableCell><TableCell className="action-column"><Button size="sm" variant="ghost" onClick={() => void checkHealth(gateway)}>Check health</Button></TableCell></TableRow>)}</TableBody></Table></div>
    {dialogOpen ? <GatewayDialog onClose={() => setDialogOpen(false)} onCreated={load} /> : null}
  </section>;
}
