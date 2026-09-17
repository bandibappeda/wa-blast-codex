import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { api } from "../../lib/api-client";
import { TemplateEditor } from "./template-editor";

interface TemplateSummary { id: string; name: string; body: string; variables: string[]; attachment: { originalName: string; mimeType: string } | null; createdAt: string; updatedAt: string; }

export function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setTemplates((await api.get<{ templates: TemplateSummary[] }>("/api/templates")).templates); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (editing) return <section className="page-shell"><TemplateEditor onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }} /></section>;
  return <section className="page-shell">
    <div className="page-heading"><div><div className="eyebrow">MESSAGING / TEMPLATES</div><h1>Templates</h1><p>Personalized plain-text messages with one authenticated attachment.</p></div><Button onClick={() => setEditing(true)}>Add template</Button></div>
    <div className="data-table"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Variables</TableHead><TableHead>Attachment</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={4}>Loading templates…</TableCell></TableRow> : templates.length === 0 ? <TableRow><TableCell colSpan={4}>No templates created yet.</TableCell></TableRow> : templates.map((template) => <TableRow key={template.id}><TableCell><strong>{template.name}</strong><small className="table-subline">{template.body.slice(0, 72)}{template.body.length > 72 ? "…" : ""}</small></TableCell><TableCell>{template.variables.length ? template.variables.join(", ") : "—"}</TableCell><TableCell>{template.attachment ? <Badge variant="secondary">{template.attachment.originalName}</Badge> : <Badge variant="outline">None</Badge>}</TableCell><TableCell className="mono-cell">{new Date(template.updatedAt).toLocaleDateString()}</TableCell></TableRow>)}</TableBody></Table></div>
  </section>;
}
