import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { api } from "../../lib/api-client";

type DeliveryStatus = "pending" | "retry" | "leased" | "sent" | "delivered" | "read" | "failed" | "cancelled";
type DeliveryFilterStatus = "pending" | "retrying" | "leased" | "sent" | "delivered" | "read" | "failed" | "cancelled";

export interface DeliveryResultsData {
  campaign: { id: string; name: string; state: string };
  summary: Record<"total" | "pending" | "retrying" | "leased" | "sent" | "delivered" | "read" | "failed" | "cancelled", number>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  recipients: Array<{
    id: string;
    idempotencyKey: string;
    name: string;
    phone: string;
    status: DeliveryStatus;
    attemptCount: number;
    providerMessageId: string | null;
    lastError: string | null;
    updatedAt: string;
  }>;
}

const summaryItems: Array<{ key: keyof DeliveryResultsData["summary"]; label: string }> = [
  { key: "total", label: "Total" },
  { key: "pending", label: "Pending" },
  { key: "retrying", label: "Retrying" },
  { key: "leased", label: "In progress" },
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
];

export function DeliveryResults({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<DeliveryResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<DeliveryFilterStatus | "">("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set("status", status);
    if (search.trim()) query.set("search", search.trim());
    setError(null);
    void api.get<DeliveryResultsData>(`/api/campaigns/${campaignId}/delivery?${query.toString()}`)
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError("Delivery results are unavailable right now."); });
    return () => { active = false; };
  }, [campaignId, page, pageSize, search, status]);

  if (error) return <section className="delivery-results"><p className="form-error" role="alert">{error}</p></section>;
  if (!data) return <section className="delivery-results"><p className="toolbar-note">Loading delivery results…</p></section>;

  const csvQuery = new URLSearchParams();
  if (status) csvQuery.set("status", status);
  if (search.trim()) csvQuery.set("search", search.trim());
  const csvUrl = `/api/campaigns/${campaignId}/delivery.csv${csvQuery.toString() ? `?${csvQuery.toString()}` : ""}`;

  return <section className="delivery-results" aria-labelledby="delivery-results-title">
    <div className="section-heading"><div><div className="eyebrow">OUTBOUND / DELIVERY</div><h2 id="delivery-results-title">Delivery results</h2></div><div className="delivery-heading-actions"><Badge variant="outline">{data.summary.total} total</Badge><a className="button-link" href={csvUrl} download>Download CSV</a></div></div>
    <div className="delivery-summary" aria-label="Delivery summary">
      {summaryItems.map((item) => <div className="delivery-summary-item" key={item.key}><span>{item.label}</span><strong>{data.summary[item.key]}</strong></div>)}
    </div>
    <div className="delivery-toolbar"><Input aria-label="Search delivery results" placeholder="Search name or phone" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><select aria-label="Filter delivery status" value={status} onChange={(event) => { setStatus(event.target.value as DeliveryFilterStatus | ""); setPage(1); }}><option value="">All statuses</option><option value="pending">Pending</option><option value="retrying">Retrying</option><option value="leased">In progress</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="read">Read</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select><span className="toolbar-note">{data.pagination.total} matching recipients</span></div>
    <div className="data-table gateway-table"><Table><TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead>Provider message</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>
      {data.recipients.length === 0 ? <TableRow><TableCell colSpan={5}>No delivery jobs match this view.</TableCell></TableRow> : data.recipients.map((recipient) => <TableRow key={recipient.id}><TableCell><strong>{recipient.name}</strong><small className="table-subline mono-cell">{recipient.phone}</small>{recipient.lastError ? <small className="table-subline form-error">{recipient.lastError}</small> : null}</TableCell><TableCell><StatusBadge status={recipient.status} /></TableCell><TableCell>{recipient.attemptCount}</TableCell><TableCell className="mono-cell">{recipient.providerMessageId ?? "—"}</TableCell><TableCell className="mono-cell">{new Date(recipient.updatedAt).toLocaleString()}</TableCell></TableRow>)}
    </TableBody></Table></div>{data.pagination.totalPages > 1 ? <div className="delivery-pagination"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><span className="toolbar-note">Page {data.pagination.page} of {data.pagination.totalPages}</span><Button size="sm" variant="outline" disabled={page >= data.pagination.totalPages} onClick={() => setPage((current) => Math.min(data.pagination.totalPages, current + 1))}>Next</Button></div> : null}
  </section>;
}

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const variant = status === "failed" ? "destructive" : status === "delivered" || status === "read" ? "secondary" : "outline";
  return <Badge variant={variant}><span className={`delivery-status-dot delivery-status-${status}`} aria-hidden="true" />{formatStatus(status)}</Badge>;
}

function formatStatus(status: DeliveryStatus): string {
  return status === "retry" ? "Retrying" : status.charAt(0).toUpperCase() + status.slice(1);
}
