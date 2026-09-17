import type { Database } from "bun:sqlite";
import type { CampaignCreateRequest, CampaignUpdateRequest } from "@wa-blast/contracts";
import type { AppConfig } from "../../config";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { AuditService } from "../audit/audit-service";
import type { AuthContext } from "../auth/auth-service";
import { previewTemplate } from "../templates/template-variables";
import { assertCampaignTransition, type CampaignState } from "./campaign-state";

export interface CampaignActor {
  userId: string;
  organizationId: string;
  role: "admin" | "operator";
}

export interface CampaignSummary {
  id: string;
  name: string;
  gatewayId: string;
  templateId: string;
  scheduleAtUtc: string | null;
  state: CampaignState;
  version: number;
  contactIds: string[];
  tagNames: string[];
  createdAt: string;
  updatedAt: string;
}

interface CampaignRow {
  id: string;
  organization_id: string;
  name: string;
  gateway_connection_id: string;
  template_id: string;
  schedule_at: string | null;
  state: CampaignState;
  audience_filter_json: string;
  version: number;
  created_by_user_id: string;
  submitted_by_user_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ContactRow {
  id: string;
  phone_e164: string;
  name: string;
  attributes_json: string;
}

interface TemplateRow {
  id: string;
  body: string;
}

interface GatewayRow {
  id: string;
  enabled: number;
  health_status: "unknown" | "healthy" | "unhealthy";
  messages_per_minute: number;
}

export interface CampaignServiceDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
  ids: IdGenerator;
}

export class CampaignService {
  private readonly audit: AuditService;

  constructor(private readonly dependencies: CampaignServiceDependencies) {
    this.audit = new AuditService(dependencies);
  }

  createDraft(input: CampaignCreateRequest, actor: CampaignActor): CampaignSummary {
    const gateway = this.getGateway(input.gatewayId, actor.organizationId);
    if (!gateway) throw new CampaignInputError("gateway_not_found");
    const template = this.getTemplate(input.templateId, actor.organizationId);
    if (!template) throw new CampaignInputError("template_not_found");
    const contactIds = uniqueStrings(input.contactIds);
    this.assertContactsBelongToOrganization(contactIds, actor.organizationId);
    const tagNames = normalizeTags(input.tagNames);
    const id = this.dependencies.ids.next();
    const now = this.dependencies.clock.now().toISOString();
    const scheduleAt = normalizeSchedule(input.scheduleAt);
    try {
      this.dependencies.db.transaction(() => {
        this.dependencies.db.query(
          `INSERT INTO campaigns
            (id, organization_id, name, gateway_connection_id, template_id, schedule_at,
             state, audience_filter_json, version, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?)`,
        ).run(id, actor.organizationId, input.name.trim(), gateway.id, template.id, scheduleAt, JSON.stringify({ tagNames }), actor.userId, now, now);
        this.insertCampaignContacts(id, contactIds);
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new CampaignInputError("duplicate_campaign_name");
      throw error;
    }
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "campaign.created", subjectType: "campaign", subjectId: id, details: { gatewayId: gateway.id, templateId: template.id, contactCount: contactIds.length, tagNames } });
    return this.getSummary(id, actor.organizationId) as CampaignSummary;
  }

  updateDraft(id: string, input: CampaignUpdateRequest, actor: CampaignActor): CampaignSummary {
    const existing = this.getRow(id, actor.organizationId);
    if (!existing) throw new CampaignInputError("campaign_not_found");
    if (existing.state !== "draft") throw new CampaignInputError("campaign_not_editable");
    if (existing.version !== input.version) throw new CampaignInputError("version_conflict");
    const gatewayId = input.gatewayId ?? existing.gateway_connection_id;
    const templateId = input.templateId ?? existing.template_id;
    if (!this.getGateway(gatewayId, actor.organizationId)) throw new CampaignInputError("gateway_not_found");
    if (!this.getTemplate(templateId, actor.organizationId)) throw new CampaignInputError("template_not_found");
    const contactIds = input.contactIds === undefined ? this.currentContactIds(id) : uniqueStrings(input.contactIds);
    this.assertContactsBelongToOrganization(contactIds, actor.organizationId);
    const tagNames = input.tagNames === undefined ? this.currentTagNames(existing) : normalizeTags(input.tagNames);
    const scheduleAt = input.scheduleAt === undefined ? existing.schedule_at : normalizeSchedule(input.scheduleAt);
    const now = this.dependencies.clock.now().toISOString();
    try {
      this.dependencies.db.transaction(() => {
        this.dependencies.db.query(
          `UPDATE campaigns SET name = ?, gateway_connection_id = ?, template_id = ?, schedule_at = ?,
             audience_filter_json = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND organization_id = ? AND version = ? AND state = 'draft'`,
        ).run(input.name?.trim() ?? existing.name, gatewayId, templateId, scheduleAt, JSON.stringify({ tagNames }), now, id, actor.organizationId, input.version);
        this.dependencies.db.query("DELETE FROM campaign_contacts WHERE campaign_id = ?").run(id);
        this.insertCampaignContacts(id, contactIds);
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new CampaignInputError("duplicate_campaign_name");
      throw error;
    }
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "campaign.updated", subjectType: "campaign", subjectId: id, details: { version: input.version + 1 } });
    return this.getSummary(id, actor.organizationId) as CampaignSummary;
  }

  listCampaigns(actor: CampaignActor): { campaigns: CampaignSummary[] } {
    const rows = this.dependencies.db.query<CampaignRow, [string]>("SELECT * FROM campaigns WHERE organization_id = ? ORDER BY updated_at DESC, id DESC").all(actor.organizationId);
    return { campaigns: rows.map((row) => this.toSummary(row)) };
  }

  previewDraft(id: string, actor: CampaignActor) {
    const campaign = this.getRow(id, actor.organizationId);
    if (!campaign) throw new CampaignInputError("campaign_not_found");
    const template = this.getTemplate(campaign.template_id, actor.organizationId);
    const gateway = this.getGateway(campaign.gateway_connection_id, actor.organizationId);
    if (!template) throw new CampaignInputError("template_not_found");
    if (!gateway) throw new CampaignInputError("gateway_not_found");
    const contacts = this.resolveAudience(campaign, actor.organizationId);
    const rows = contacts.map((contact) => this.evaluateContact(contact, template.body));
    const summary = {
      total: rows.length,
      eligible: rows.filter((row) => row.status === "eligible").length,
      suppressed: rows.filter((row) => row.status === "suppressed").length,
      missingConsent: rows.filter((row) => row.status === "missing_consent").length,
      missingVariables: rows.filter((row) => row.status === "missing_variables").length,
      invalid: rows.filter((row) => row.status === "invalid").length,
    };
    const gatewayWarning = !gateway.enabled ? "gateway_disabled" : gateway.health_status !== "healthy" ? `gateway_${gateway.health_status}` : null;
    return {
      campaign: this.toSummary(campaign),
      summary,
      rows,
      scheduleAtUtc: campaign.schedule_at,
      scheduleAtLocal: campaign.schedule_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: this.dependencies.config.organizationTimeZone }).format(new Date(campaign.schedule_at)) : null,
      organizationTimeZone: this.dependencies.config.organizationTimeZone,
      gatewayWarning,
      rateLimit: { messagesPerMinute: gateway.messages_per_minute, estimatedMinutes: gateway.messages_per_minute > 0 ? Math.ceil(summary.eligible / gateway.messages_per_minute) : null },
    };
  }

  async submitForApproval(id: string, version: number, actor: CampaignActor): Promise<CampaignSummary> {
    const campaign = this.getRow(id, actor.organizationId);
    if (!campaign) throw new CampaignInputError("campaign_not_found");
    if (campaign.state !== "draft") throw new CampaignInputError("campaign_not_editable");
    if (campaign.version !== version) throw new CampaignInputError("version_conflict");
    const preview = this.previewDraft(id, actor);
    if (preview.summary.total === 0 || preview.summary.eligible !== preview.summary.total) throw new CampaignInputError("ineligible_recipients", preview.summary);
    if (preview.gatewayWarning) throw new CampaignInputError(preview.gatewayWarning);
    assertCampaignTransition(campaign.state, "pending_approval");
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query("UPDATE campaigns SET state = 'pending_approval', version = version + 1, submitted_by_user_id = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND version = ?").run(actor.userId, now, now, id, actor.organizationId, version);
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "campaign.submitted", subjectType: "campaign", subjectId: id, details: { eligible: preview.summary.eligible } });
    return this.getSummary(id, actor.organizationId) as CampaignSummary;
  }

  cancelCampaign(id: string, actor: CampaignActor): CampaignSummary {
    const campaign = this.getRow(id, actor.organizationId);
    if (!campaign) throw new CampaignInputError("campaign_not_found");
    assertCampaignTransition(campaign.state, "cancelled");
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query("UPDATE campaigns SET state = 'cancelled', version = version + 1, updated_at = ? WHERE id = ? AND organization_id = ?").run(now, id, actor.organizationId);
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "campaign.cancelled", subjectType: "campaign", subjectId: id });
    return this.getSummary(id, actor.organizationId) as CampaignSummary;
  }

  private getSummary(id: string, organizationId: string): CampaignSummary | null {
    const row = this.getRow(id, organizationId);
    return row ? this.toSummary(row) : null;
  }

  private getRow(id: string, organizationId: string): CampaignRow | null {
    return this.dependencies.db.query<CampaignRow, [string, string]>("SELECT * FROM campaigns WHERE id = ? AND organization_id = ?").get(id, organizationId) ?? null;
  }

  private toSummary(row: CampaignRow): CampaignSummary {
    return { id: row.id, name: row.name, gatewayId: row.gateway_connection_id, templateId: row.template_id, scheduleAtUtc: row.schedule_at, state: row.state, version: row.version, contactIds: this.currentContactIds(row.id), tagNames: this.currentTagNames(row), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private getGateway(id: string, organizationId: string): GatewayRow | null {
    return this.dependencies.db.query<GatewayRow, [string, string]>("SELECT id, enabled, health_status, messages_per_minute FROM gateway_connections WHERE id = ? AND organization_id = ?").get(id, organizationId) ?? null;
  }

  private getTemplate(id: string, organizationId: string): TemplateRow | null {
    return this.dependencies.db.query<TemplateRow, [string, string]>("SELECT id, body FROM message_templates WHERE id = ? AND organization_id = ?").get(id, organizationId) ?? null;
  }

  private insertCampaignContacts(campaignId: string, contactIds: string[]): void {
    for (const contactId of contactIds) this.dependencies.db.query("INSERT INTO campaign_contacts (campaign_id, contact_id) VALUES (?, ?)").run(campaignId, contactId);
  }

  private currentContactIds(campaignId: string): string[] {
    return this.dependencies.db.query<{ contact_id: string }, [string]>("SELECT contact_id FROM campaign_contacts WHERE campaign_id = ? ORDER BY contact_id").all(campaignId).map((row) => row.contact_id);
  }

  private currentTagNames(row: CampaignRow): string[] {
    const parsed = JSON.parse(row.audience_filter_json) as { tagNames?: unknown };
    return Array.isArray(parsed.tagNames) ? parsed.tagNames.filter((tag): tag is string => typeof tag === "string") : [];
  }

  private assertContactsBelongToOrganization(contactIds: string[], organizationId: string): void {
    if (contactIds.length === 0) return;
    const knownIds = new Set(this.dependencies.db.query<{ id: string }, [string]>("SELECT id FROM contacts WHERE organization_id = ?").all(organizationId).map((row) => row.id));
    if (contactIds.some((contactId) => !knownIds.has(contactId))) throw new CampaignInputError("contact_not_found");
  }

  private resolveAudience(row: CampaignRow, organizationId: string): ContactRow[] {
    const explicitIds = new Set(this.currentContactIds(row.id));
    const tagNames = this.currentTagNames(row);
    const contacts = this.dependencies.db.query<ContactRow, [string]>("SELECT id, phone_e164, name, attributes_json FROM contacts WHERE organization_id = ? ORDER BY name, id").all(organizationId);
    return contacts.filter((contact) => explicitIds.has(contact.id) || tagNames.some((tag) => Boolean(this.dependencies.db.query("SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ? AND t.organization_id = ? AND t.name = ? LIMIT 1").get(contact.id, organizationId, tag))));
  }

  private evaluateContact(contact: ContactRow, body: string) {
    const attributes = { ...safeAttributes(contact.attributes_json), name: contact.name, phone: contact.phone_e164 };
    const missingVariables = previewTemplate(body, attributes).missing;
    let status: "eligible" | "suppressed" | "missing_consent" | "missing_variables" | "invalid" = "eligible";
    if (!/^\+\d{8,15}$/.test(contact.phone_e164)) status = "invalid";
    else if (this.isSuppressed(contact.id)) status = "suppressed";
    else if (!this.hasConsent(contact.id)) status = "missing_consent";
    else if (missingVariables.length > 0) status = "missing_variables";
    return { contactId: contact.id, name: contact.name, phone: contact.phone_e164, status, missingVariables, renderedBody: previewTemplate(body, attributes).rendered };
  }

  private isSuppressed(contactId: string): boolean {
    return Boolean(this.dependencies.db.query("SELECT 1 FROM suppressions WHERE contact_id = ? AND lifted_at IS NULL LIMIT 1").get(contactId));
  }

  private hasConsent(contactId: string): boolean {
    return Boolean(this.dependencies.db.query("SELECT 1 FROM contact_consents WHERE contact_id = ? LIMIT 1").get(contactId));
  }
}

export class CampaignInputError extends Error {
  constructor(readonly code: string, readonly details?: Record<string, unknown>) { super(code); }
}

export function campaignActorFromAuth(auth: AuthContext): CampaignActor {
  return { userId: auth.user.id, organizationId: auth.user.organizationId, role: auth.user.summary.role };
}

function uniqueStrings(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function normalizeTags(values: string[]): string[] { return uniqueStrings(values.map((value) => value.toLowerCase())); }
function normalizeSchedule(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CampaignInputError("invalid_schedule");
  return date.toISOString();
}
function safeAttributes(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}
