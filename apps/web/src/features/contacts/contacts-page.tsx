import { useEffect, useState } from "react";
import type { UserSummary } from "@wa-blast/contracts";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Textarea } from "../../components/ui/textarea";
import { api, ApiError } from "../../lib/api-client";

interface Contact {
  id: string;
  phoneDisplay: string;
  phoneE164: string;
  name: string;
  hasConsent: boolean;
  suppressed: boolean;
  tags: string[];
}

export function ContactsPage({ user }: { user: UserSummary }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [csv, setCsv] = useState("phone,name,consent_source,consent_at\n");
  const [preview, setPreview] = useState<{ previewId: string; summary: Record<string, number> } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<{ contacts: Contact[] }>(`/api/contacts?search=${encodeURIComponent(search)}`);
      setContacts(result.contacts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [search]);

  const previewImport = async () => {
    setMessage(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      const result = await api.post<{ previewId: string; summary: Record<string, number> }>("/api/contacts/import/preview", { filename: "contacts.csv", content: csv }, csrf.csrfToken);
      setPreview(result);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? "CSV tidak dapat diproses." : "Import gagal.");
    }
  };

  const commitImport = async () => {
    if (!preview) return;
    const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
    const result = await api.post<{ accepted: number; skipped: number }>(`/api/contacts/import/${preview.previewId}/commit`, undefined, csrf.csrfToken);
    setMessage(`${result.accepted} contact diimpor; ${result.skipped} baris dilewati.`);
    setPreview(null);
    await load();
  };

  const suppress = async (contact: Contact) => {
    const reason = window.prompt(`Alasan suppression untuk ${contact.name}`);
    if (!reason) return;
    const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
    await api.post(`/api/contacts/${contact.id}/suppression`, { reason }, csrf.csrfToken);
    await load();
  };

  return <section className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">AUDIENCE / CONTACTS</div><h1>Contacts</h1><p>Consent is evidence. Suppression always wins.</p></div><Badge variant="outline">{contacts.length} visible</Badge></div>
    <div className="toolbar"><Input aria-label="Search contacts" placeholder="Search by name or phone" value={search} onChange={(event) => setSearch(event.target.value)} /><span className="toolbar-note">Numbers are stored normalized; display input remains visible.</span></div>
    <div className="import-panel"><div><div className="eyebrow">CSV IMPORT</div><h2>Preview before committing</h2><p>Use phone, name, consent_source, consent_at, tags, and optional attributes.</p></div><div className="import-controls"><Label htmlFor="contacts-csv">CSV content</Label><Textarea id="contacts-csv" rows={4} value={csv} onChange={(event) => setCsv(event.target.value)} /><div className="import-actions"><Button variant="outline" onClick={() => void previewImport()}>Preview import</Button>{preview ? <Button onClick={() => void commitImport()}>Commit {preview.summary.accepted ?? 0} accepted</Button> : null}</div>{preview ? <div className="preview-summary" role="status">Accepted {preview.summary.accepted ?? 0} · Suppressed {preview.summary.suppressed ?? 0} · Invalid {preview.summary.invalid ?? 0}</div> : null}</div></div>
    {message ? <p className="toolbar-note" role="status">{message}</p> : null}
    <div className="data-table"><Table><TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Consent</TableHead><TableHead>Tags</TableHead><TableHead className="action-column">Actions</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={5}>Loading contacts…</TableCell></TableRow> : contacts.length === 0 ? <TableRow><TableCell colSpan={5}>No contacts match this view.</TableCell></TableRow> : contacts.map((contact) => <TableRow key={contact.id}><TableCell><strong>{contact.name}</strong></TableCell><TableCell className="mono-cell">{contact.phoneE164}</TableCell><TableCell>{contact.suppressed ? <Badge variant="destructive">Suppressed</Badge> : contact.hasConsent ? <Badge variant="secondary">Consented</Badge> : <Badge variant="outline">Missing consent</Badge>}</TableCell><TableCell>{contact.tags.length ? contact.tags.join(", ") : "—"}</TableCell><TableCell className="action-column">{user.role === "admin" && !contact.suppressed ? <Button size="sm" variant="ghost" onClick={() => void suppress(contact)}>Suppress</Button> : null}</TableCell></TableRow>)}</TableBody></Table></div>
  </section>;
}
