import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { api, ApiError } from "../../lib/api-client";

export interface CampaignGatewayOption { id: string; name: string; healthStatus: string; enabled: boolean; }
export interface CampaignTemplateOption { id: string; name: string; body: string; }
export interface CampaignContactOption { id: string; name: string; phoneE164: string; tags: string[]; }

interface CampaignEditorProps {
  gateways: CampaignGatewayOption[];
  templates: CampaignTemplateOption[];
  contacts: CampaignContactOption[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

const steps = ["Campaign details", "Audience", "Message & schedule", "Review & submit"];

export function CampaignEditor({ gateways, templates, contacts, onCancel, onSaved }: CampaignEditorProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [gatewayId, setGatewayId] = useState(gateways[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = templates.find((item) => item.id === templateId);
  const gateway = gateways.find((item) => item.id === gatewayId);
  const selected = useMemo(() => contacts.filter((contact) => selectedContacts.includes(contact.id)), [contacts, selectedContacts]);
  const tags = useMemo(() => [...new Set(contacts.flatMap((contact) => contact.tags))].sort(), [contacts]);

  const toggleContact = (contactId: string) => setSelectedContacts((current) => current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < 3) { setStep((current) => current + 1); return; }
    setSaving(true);
    setError(null);
    try {
      const csrf = await api.get<{ csrfToken: string }>("/api/auth/csrf");
      await api.post("/api/campaigns", { name, gatewayId, templateId, contactIds: selectedContacts, tagNames: selectedTags, ...(scheduleAt ? { scheduleAt: new Date(scheduleAt).toISOString() } : {}) }, csrf.csrfToken);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? "Campaign tidak dapat disimpan." : "Campaign tidak dapat disimpan.");
    } finally { setSaving(false); }
  };

  return <form className="campaign-editor" onSubmit={(event) => void save(event)}>
    <div className="page-heading"><div><div className="eyebrow">CAMPAIGN DRAFT</div><h1>New campaign</h1><p>Build the audience, message, schedule, and review in one stable flow.</p></div><Button type="button" variant="ghost" onClick={onCancel}>Close</Button></div>
    <nav className="campaign-stepper" aria-label="Campaign steps">{steps.map((label, index) => <button type="button" key={label} className={index === step ? "campaign-step is-current" : index < step ? "campaign-step is-complete" : "campaign-step"} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
    <div className="campaign-step-content">
      {step === 0 ? <section><h2>Campaign details</h2><div className="campaign-fields"><div className="field-stack"><Label htmlFor="campaign-name">Campaign name</Label><Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} required /></div><div className="field-stack"><Label htmlFor="campaign-gateway">Gateway connection</Label><select id="campaign-gateway" value={gatewayId} onChange={(event) => setGatewayId(event.target.value)} required>{gateways.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.healthStatus}</option>)}</select>{gateway && (!gateway.enabled || gateway.healthStatus !== "healthy") ? <span className="toolbar-note">Gateway health will be checked again before approval.</span> : null}</div></div></section> : null}
      {step === 1 ? <section><div className="step-heading"><div><h2>Audience</h2><p>Select contacts directly or include contacts by tag.</p></div><BadgeCount count={selected.length + selectedTags.length} /></div><div className="audience-list">{contacts.length === 0 ? <p className="toolbar-note">No contacts available.</p> : contacts.map((contact) => <label className="audience-row" key={contact.id}><input type="checkbox" checked={selectedContacts.includes(contact.id)} onChange={() => toggleContact(contact.id)} /><span><strong>{contact.name}</strong><small>{contact.phoneE164}{contact.tags.length ? ` · ${contact.tags.join(", ")}` : ""}</small></span></label>)}</div>{tags.length ? <div className="tag-filter"><span className="eyebrow">TAG FILTERS</span>{tags.map((tag) => <label className="tag-option" key={tag}><input type="checkbox" checked={selectedTags.includes(tag)} onChange={() => setSelectedTags((current) => current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag])} />{tag}</label>)}</div> : null}</section> : null}
      {step === 2 ? <section><h2>Message & schedule</h2><div className="campaign-fields"><div className="field-stack"><Label htmlFor="campaign-template">Message template</Label><select id="campaign-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="message-sample"><span className="eyebrow">TEMPLATE BODY</span><p>{template?.body ?? "Select a template."}</p></div><div className="field-stack"><Label htmlFor="campaign-schedule">Schedule (optional)</Label><Input id="campaign-schedule" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /><span className="toolbar-note">Stored as UTC; organization time zone is applied by the API.</span></div></div></section> : null}
      {step === 3 ? <section><h2>Review & submit</h2><div className="review-grid"><ReviewItem label="Campaign" value={name || "Unnamed campaign"} /><ReviewItem label="Gateway" value={gateway?.name ?? "Not selected"} /><ReviewItem label="Template" value={template?.name ?? "Not selected"} /><ReviewItem label="Audience" value={`${selected.length} contacts${selectedTags.length ? ` · ${selectedTags.length} tags` : ""}`} /><ReviewItem label="Schedule" value={scheduleAt ? new Date(scheduleAt).toLocaleString() : "Send immediately"} /></div><p className="toolbar-note">Submitting creates a draft. Eligibility and gateway health are rechecked before approval.</p></section> : null}
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="dialog-actions"><Button type="button" variant="outline" onClick={step === 0 ? onCancel : () => setStep((current) => current - 1)}>{step === 0 ? "Cancel" : "Back"}</Button><Button type="submit" disabled={saving || !gatewayId || !templateId}>{step < 3 ? "Continue" : saving ? "Saving…" : "Save draft"}</Button></div>
  </form>;
}

function BadgeCount({ count }: { count: number }) { return <span className="selection-count">{count} selected</span>; }
function ReviewItem({ label, value }: { label: string; value: string }) { return <div className="review-item"><span>{label}</span><strong>{value}</strong></div>; }
