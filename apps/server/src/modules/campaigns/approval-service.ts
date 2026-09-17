import type { Database } from "bun:sqlite";
import type { AppConfig } from "../../config";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { AuditService } from "../audit/audit-service";
import type { AuthContext } from "../auth/auth-service";
import { CampaignInputError, CampaignService, type CampaignActor, type CampaignSummary } from "./campaign-service";
import type { CampaignState } from "./campaign-state";

interface CampaignApprovalRow {
  id: string;
  organization_id: string;
  gateway_connection_id: string;
  template_id: string;
  schedule_at: string | null;
  state: CampaignState;
  version: number;
}

interface TemplateApprovalRow {
  body: string;
  attachment_original_name: string | null;
  attachment_mime_type: string | null;
  attachment_storage_key: string | null;
}

interface ContactApprovalRow {
  id: string;
  phone_e164: string;
  name: string;
  attributes_json: string;
}

export interface ApprovalServiceDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
  ids: IdGenerator;
  campaigns: CampaignService;
}

export interface ApprovalResult {
  campaign: CampaignSummary;
  approval: { jobsCreated: number; excluded: number };
}

export class ApprovalService {
  private readonly audit: AuditService;

  constructor(private readonly dependencies: ApprovalServiceDependencies) {
    this.audit = new AuditService(dependencies);
  }

  approve(id: string, version: number, actor: CampaignActor): ApprovalResult {
    const initial = this.getCampaign(id, actor.organizationId);
    if (!initial) throw new CampaignInputError("campaign_not_found");
    if (initial.state !== "pending_approval") throw new CampaignInputError("campaign_not_pending_approval");
    if (initial.version !== version) throw new CampaignInputError("version_conflict");

    let jobsCreated = 0;
    let excluded = 0;
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getCampaign(id, actor.organizationId);
      if (!current || current.state !== "pending_approval") throw new CampaignInputError("campaign_not_pending_approval");
      if (current.version !== version) throw new CampaignInputError("version_conflict");
      const preview = this.dependencies.campaigns.previewDraft(id, actor);
      const eligible = preview.rows.filter((row) => row.status === "eligible");
      excluded = preview.rows.length - eligible.length;
      if (eligible.length === 0) throw new CampaignInputError("no_eligible_recipients", preview.summary);
      const template = this.getTemplate(id, current.template_id, actor.organizationId);
      if (!template) throw new CampaignInputError("template_not_found");
      const availableAt = current.schedule_at && new Date(current.schedule_at) > this.dependencies.clock.now() ? current.schedule_at : now;
      const nextState: CampaignState = current.schedule_at && new Date(current.schedule_at) > this.dependencies.clock.now() ? "scheduled" : "queued";
      for (const row of eligible) {
        const contact = this.getContact(row.contactId, actor.organizationId);
        if (!contact) continue;
        const recipientId = this.dependencies.ids.next();
        this.dependencies.db.query(
          `INSERT INTO campaign_recipients
            (id, campaign_id, contact_id, phone_e164, name, attributes_json, rendered_body,
             attachment_original_name, attachment_mime_type, attachment_storage_key,
             gateway_connection_id, schedule_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(recipientId, id, contact.id, contact.phone_e164, contact.name, contact.attributes_json, row.renderedBody, template.attachment_original_name, template.attachment_mime_type, template.attachment_storage_key, current.gateway_connection_id, current.schedule_at, now);
        this.dependencies.db.query(
          `INSERT INTO message_jobs
            (id, campaign_id, campaign_recipient_id, idempotency_key, status, attempt_count,
             available_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
        ).run(this.dependencies.ids.next(), id, recipientId, `${id}:${recipientId}`, availableAt, now, now);
        jobsCreated += 1;
      }
      this.dependencies.db.query(
        `UPDATE campaigns SET state = ?, version = version + 1, approved_by_user_id = ?, approved_at = ?, updated_at = ?
         WHERE id = ? AND organization_id = ? AND version = ? AND state = 'pending_approval'`,
      ).run(nextState, actor.userId, now, now, id, actor.organizationId, version);
      this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "campaign.approved", subjectType: "campaign", subjectId: id, details: { jobsCreated, excluded, state: nextState } });
      this.dependencies.db.exec("COMMIT");
    } catch (error) {
      this.dependencies.db.exec("ROLLBACK");
      throw error;
    }
    return { campaign: this.dependencies.campaigns.listCampaigns(actor).campaigns.find((campaign) => campaign.id === id) as CampaignSummary, approval: { jobsCreated, excluded } };
  }

  reopen(id: string, actor: CampaignActor): CampaignSummary {
    const campaign = this.getCampaign(id, actor.organizationId);
    if (!campaign) throw new CampaignInputError("campaign_not_found");
    if (campaign.state !== "queued" && campaign.state !== "scheduled") throw new CampaignInputError("campaign_not_reopenable");
    const claimed = this.dependencies.db.query("SELECT 1 FROM message_jobs WHERE campaign_id = ? AND (status <> 'pending' OR attempt_count > 0) LIMIT 1").get(id);
    if (claimed) throw new CampaignInputError("campaign_jobs_claimed");
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.exec("BEGIN IMMEDIATE");
    try {
      this.dependencies.db.query("DELETE FROM message_jobs WHERE campaign_id = ?").run(id);
      this.dependencies.db.query("DELETE FROM campaign_recipients WHERE campaign_id = ?").run(id);
      this.dependencies.db.query("UPDATE campaigns SET state = 'draft', version = version + 1, submitted_by_user_id = NULL, submitted_at = NULL, approved_by_user_id = NULL, approved_at = NULL, updated_at = ? WHERE id = ? AND organization_id = ?").run(now, id, actor.organizationId);
      this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "campaign.reopened", subjectType: "campaign", subjectId: id });
      this.dependencies.db.exec("COMMIT");
    } catch (error) {
      this.dependencies.db.exec("ROLLBACK");
      throw error;
    }
    return this.dependencies.campaigns.listCampaigns(actor).campaigns.find((item) => item.id === id) as CampaignSummary;
  }

  private getCampaign(id: string, organizationId: string): CampaignApprovalRow | null {
    return this.dependencies.db.query<CampaignApprovalRow, [string, string]>("SELECT id, organization_id, gateway_connection_id, template_id, schedule_at, state, version FROM campaigns WHERE id = ? AND organization_id = ?").get(id, organizationId) ?? null;
  }

  private getTemplate(campaignId: string, templateId: string, organizationId: string): TemplateApprovalRow | null {
    return this.dependencies.db.query<TemplateApprovalRow, [string, string, string]>(
      `SELECT t.body, a.original_name AS attachment_original_name, a.mime_type AS attachment_mime_type, a.storage_key AS attachment_storage_key
       FROM campaigns c JOIN message_templates t ON t.id = ? AND t.organization_id = ?
       LEFT JOIN attachments a ON a.id = t.attachment_id
       WHERE c.id = ?`,
    ).get(templateId, organizationId, campaignId) ?? null;
  }

  private getContact(id: string, organizationId: string): ContactApprovalRow | null {
    return this.dependencies.db.query<ContactApprovalRow, [string, string]>("SELECT id, phone_e164, name, attributes_json FROM contacts WHERE id = ? AND organization_id = ?").get(id, organizationId) ?? null;
  }
}

export function approvalActorFromAuth(auth: AuthContext): CampaignActor {
  return { userId: auth.user.id, organizationId: auth.user.organizationId, role: auth.user.summary.role };
}
