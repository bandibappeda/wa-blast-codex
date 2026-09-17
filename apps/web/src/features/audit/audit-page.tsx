import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { api } from "../../lib/api-client";

interface AuditEntry {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  actor: { id: string; email: string; displayName: string } | null;
  details: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface AuditFilters {
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  from: string;
  to: string;
}

const emptyFilters: AuditFilters = { actorId: "", action: "", subjectType: "", subjectId: "", from: "", to: "" };

export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [applied, setApplied] = useState<AuditFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = async (nextPage: number, query: AuditFilters) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(nextPage), pageSize: "50" });
    if (query.actorId.trim()) params.set("actorId", query.actorId.trim());
    if (query.action.trim()) params.set("action", query.action.trim());
    if (query.subjectType.trim()) params.set("subjectType", query.subjectType.trim());
    if (query.subjectId.trim()) params.set("subjectId", query.subjectId.trim());
    if (query.from) params.set("from", toIso(query.from));
    if (query.to) params.set("to", toIso(query.to, true));
    try {
      setResult(await api.get<AuditResponse>(`/api/audit?${params.toString()}`));
      setError(null);
    } catch {
      setError("Audit history could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries(page, applied);
  }, [page, applied]);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setPage(1);
    setApplied(emptyFilters);
  };

  const pagination = result?.pagination;
  return <section className="page-shell audit-page">
    <div className="page-heading"><div><div className="eyebrow">GOVERNANCE / HISTORY</div><h1>Audit log</h1><p>Review access changes, approvals, and operational state transitions.</p></div><span className="toolbar-note">{pagination?.total ?? 0} recorded events</span></div>
    <form className="audit-filters" onSubmit={submitFilters}>
      <label className="field-stack"><span>Actor ID</span><Input value={filters.actorId} onChange={(event) => setFilters({ ...filters, actorId: event.target.value })} placeholder="usr_…" /></label>
      <label className="field-stack"><span>Action</span><Input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} placeholder="user.created" /></label>
      <label className="field-stack"><span>Subject type</span><Input value={filters.subjectType} onChange={(event) => setFilters({ ...filters, subjectType: event.target.value })} placeholder="campaign" /></label>
      <label className="field-stack"><span>Subject ID</span><Input value={filters.subjectId} onChange={(event) => setFilters({ ...filters, subjectId: event.target.value })} placeholder="Optional ID" /></label>
      <label className="field-stack"><span>From</span><Input type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label className="field-stack"><span>To</span><Input type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <div className="audit-filter-actions"><Button type="submit">Apply filters</Button><Button type="button" variant="ghost" onClick={clearFilters}>Clear</Button></div>
    </form>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading ? <p className="toolbar-note">Loading audit history…</p> : result?.entries.length === 0 ? <div className="empty-panel"><span className="empty-index">CLEAR</span><div><h2>No matching events</h2><p>Try removing a filter or return when the workspace has recorded more activity.</p></div></div> : <div className="data-table audit-table"><Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Subject</TableHead><TableHead>Details</TableHead></TableRow></TableHeader><TableBody>{result?.entries.map((entry) => <TableRow key={entry.id}><TableCell className="audit-time"><time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time></TableCell><TableCell><strong>{entry.action}</strong><small className="table-subline mono-cell">{entry.correlationId}</small></TableCell><TableCell>{entry.actor ? <><strong>{entry.actor.displayName}</strong><small className="table-subline">{entry.actor.email}</small></> : <span className="table-note">System</span>}</TableCell><TableCell><span>{entry.subjectType}</span>{entry.subjectId ? <small className="table-subline mono-cell">{entry.subjectId}</small> : null}</TableCell><TableCell><code className="audit-details">{JSON.stringify(entry.details)}</code></TableCell></TableRow>)}</TableBody></Table></div>}
    {pagination && pagination.totalPages > 1 ? <div className="delivery-pagination"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</Button><span className="toolbar-note">Page {pagination.page} of {pagination.totalPages}</span><Button variant="outline" size="sm" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</Button></div> : null}
  </section>;
}

function toIso(value: string, endOfMinute = false): string {
  const date = new Date(value);
  if (endOfMinute) date.setSeconds(59, 999);
  return date.toISOString();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
