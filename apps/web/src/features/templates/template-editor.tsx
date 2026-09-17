import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { api, ApiError } from "../../lib/api-client";
import { TemplatePreview } from "./template-preview";

export function TemplateEditor({ onCancel, onSaved, initialBody = "" }: { onCancel: () => void; onSaved: () => void | Promise<void>; initialBody?: string }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState(initialBody);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sampleAttributes = { name: "Ani", order_id: "ORD-7", company: "Acme" };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      let attachmentId: string | undefined;
      if (file) {
        const form = new FormData();
        form.set("file", file);
        const uploaded = await api.upload<{ attachment: { id: string } }>("/api/templates/attachments", form, csrf.csrfToken);
        attachmentId = uploaded.attachment.id;
      }
      await api.post("/api/templates", { name, body, ...(attachmentId ? { attachmentId } : {}) }, csrf.csrfToken);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === "malformed_variable" ? "Gunakan format {{variable_name}} tanpa ekspresi bertingkat." : "Template tidak dapat disimpan.");
    } finally {
      setSaving(false);
    }
  };

  return <form className="template-editor" onSubmit={(event) => void save(event)}>
    <div className="page-heading"><div><div className="eyebrow">MESSAGE TEMPLATE</div><h1>New template</h1><p>Plain text, controlled variables, one optional attachment.</p></div><Button type="button" variant="ghost" onClick={onCancel}>Close</Button></div>
    <div className="template-editor-grid">
      <div className="template-form-column">
        <div className="field-stack"><Label htmlFor="template-name">Template name</Label><Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
        <div className="field-stack"><Label htmlFor="template-body">Template body</Label><Textarea id="template-body" rows={12} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Halo {{name}}, …" required /><span className="toolbar-note">Variables use double braces, for example {"{{name}}"}.</span></div>
        <div className="field-stack"><Label htmlFor="template-attachment">Attachment (optional)</Label><Input id="template-attachment" type="file" accept="image/jpeg,image/png,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="toolbar-note">JPEG, PNG, PDF, or common office documents. Maximum 10 MiB.</span></div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save template"}</Button></div>
      </div>
      <TemplatePreview body={body} sampleAttributes={sampleAttributes} />
    </div>
  </form>;
}
