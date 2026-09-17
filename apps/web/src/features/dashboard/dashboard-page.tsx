import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Badge } from "../../components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { api } from "../../lib/api-client";

interface DashboardData {
  queue: { depth: number; oldestPendingAt: string | null; oldestPendingAgeSeconds: number | null };
  approvals: { pending: number };
  activeCampaigns: Array<{ id: string; name: string; state: string; total: number; pending: number; sent: number; delivered: number; read: number; failed: number; progressPercent: number }>;
  gateways: { total: number; healthy: number; unhealthy: number; unknown: number };
  delivery: { total: number; pending: number; retrying: number; sent: number; delivered: number; read: number; failed: number; successRate: number | null };
  recentFailures: Array<{ jobId: string; campaignId: string; campaignName: string; recipientName: string; message: string; updatedAt: string }>;
}

const chartConfig = {
  sent: { label: "Sent", color: "var(--primary)" },
  delivered: { label: "Delivered", color: "oklch(0.58 0.16 150)" },
  read: { label: "Read", color: "oklch(0.62 0.12 205)" },
  failed: { label: "Failed", color: "var(--destructive)" },
} satisfies ChartConfig;

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.get<DashboardData>("/api/dashboard")
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError("Dashboard data is unavailable right now."); });
    return () => { active = false; };
  }, []);

  if (error) return <section className="page-shell"><p className="form-error" role="alert">{error}</p></section>;
  if (!data) return <section className="page-shell"><p className="toolbar-note">Loading dashboard…</p></section>;

  const chartData = [
    { label: "Outbound", sent: data.delivery.sent, delivered: data.delivery.delivered, read: data.delivery.read, failed: data.delivery.failed },
  ];
  return <section className="page-shell dashboard-page">
    <div className="page-heading"><div><div className="eyebrow">OPERATIONS / TODAY</div><h1>Dashboard</h1><p>Monitor queue pressure, approval work, gateway health, and delivery outcomes.</p></div><Badge variant={data.gateways.unhealthy > 0 ? "destructive" : "secondary"}>{data.gateways.healthy}/{data.gateways.total} gateways healthy</Badge></div>
    <div className="metric-grid"><Metric label="Queue depth" value={data.queue.depth} detail={data.queue.oldestPendingAgeSeconds === null ? "No pending jobs" : `Oldest pending ${formatAge(data.queue.oldestPendingAgeSeconds)}`} /><Metric label="Approvals" value={data.approvals.pending} detail="Campaigns awaiting admin" /><Metric label="Delivery rate" value={data.delivery.successRate === null ? "—" : `${data.delivery.successRate}%`} detail={`${data.delivery.total} delivery jobs`} /><Metric label="Gateway health" value={`${data.gateways.healthy}/${data.gateways.total}`} detail={`${data.gateways.unhealthy} unhealthy · ${data.gateways.unknown} unknown`} /></div>
    <div className="dashboard-grid"><section className="dashboard-panel"><div className="section-heading"><div><div className="eyebrow">ACTIVE WORK</div><h2>Campaign progress</h2></div><span className="toolbar-note">{data.approvals.pending} pending approval</span></div><div className="data-table"><Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>State</TableHead><TableHead>Progress</TableHead><TableHead>Results</TableHead></TableRow></TableHeader><TableBody>{data.activeCampaigns.length === 0 ? <TableRow><TableCell colSpan={4}>No campaigns are currently sending.</TableCell></TableRow> : data.activeCampaigns.map((campaign) => <TableRow key={campaign.id}><TableCell><strong>{campaign.name}</strong><small className="table-subline">{campaign.total} recipients</small></TableCell><TableCell><Badge variant="outline">{campaign.state}</Badge></TableCell><TableCell><div className="progress-track" aria-label={`${campaign.progressPercent}% complete`}><span style={{ width: `${campaign.progressPercent}%` }} /></div><small className="table-subline">{campaign.progressPercent}% complete</small></TableCell><TableCell className="mono-cell">{campaign.delivered + campaign.read} delivered · {campaign.failed} failed</TableCell></TableRow>)}</TableBody></Table></div></section><section className="dashboard-panel"><div className="section-heading"><div><div className="eyebrow">DELIVERY / OUTCOMES</div><h2>Delivery outcomes</h2></div><span className="toolbar-note">{data.delivery.total} jobs</span></div><ChartContainer config={chartConfig} className="dashboard-chart"><BarChart accessibilityLayer data={chartData}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="sent" stackId="a" fill="var(--color-sent)" radius={[0, 0, 0, 0]} /><Bar dataKey="delivered" stackId="a" fill="var(--color-delivered)" radius={[0, 0, 0, 0]} /><Bar dataKey="read" stackId="a" fill="var(--color-read)" radius={[0, 0, 0, 0]} /><Bar dataKey="failed" stackId="a" fill="var(--color-failed)" radius={[3, 3, 0, 0]} /></BarChart></ChartContainer><div className="outcome-legend"><span><i className="legend-swatch legend-sent" />Sent {data.delivery.sent}</span><span><i className="legend-swatch legend-delivered" />Delivered {data.delivery.delivered}</span><span><i className="legend-swatch legend-read" />Read {data.delivery.read}</span><span><i className="legend-swatch legend-failed" />Failed {data.delivery.failed}</span></div></section></div>
    <section className="dashboard-panel dashboard-failures"><div className="section-heading"><div><div className="eyebrow">ATTENTION REQUIRED</div><h2>Recent failures</h2></div><span className="toolbar-note">Last 8 failed jobs</span></div>{data.recentFailures.length === 0 ? <div className="empty-panel"><span className="empty-index">CLEAR</span><div><h2>No recent failures</h2><p>Delivery errors will appear here with their latest retry context.</p></div></div> : <div className="failure-list">{data.recentFailures.map((failure) => <article className="failure-item" key={failure.jobId}><div><strong>{failure.recipientName}</strong><span>{failure.campaignName}</span></div><p>{failure.message}</p><time dateTime={failure.updatedAt}>{new Date(failure.updatedAt).toLocaleString()}</time></article>)}</div>}</section>
  </section>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <article className="metric-panel"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function formatAge(seconds: number): string { if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; return `${Math.floor(seconds / 3600)}h`; }
