import type { Database } from "bun:sqlite";
import type { TemplateCreateRequest, TemplateUpdateRequest } from "@wa-blast/contracts";
import type { AppConfig } from "../../config";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { AuditService } from "../audit/audit-service";
import type { AuthContext } from "../auth/auth-service";
import { AttachmentStore, type StoredAttachment } from "./attachment-store";
import { extractTemplateVariables, previewTemplate, TemplateVariableError } from "./template-variables";

export interface TemplateActor {
  userId: string;
  organizationId: string;
  role: "admin" | "operator";
}

export interface AttachmentSummary {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  body: string;
  variables: string[];
  attachment: AttachmentSummary | null;
  createdAt: string;
  updatedAt: string;
}

interface AttachmentRow {
  id: string;
  organization_id: string;
  original_name: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  created_by_user_id: string;
  created_at: string;
}

interface TemplateRow {
  id: string;
  organization_id: string;
  name: string;
  body: string;
  attachment_id: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  attachment_original_name: string | null;
  attachment_mime_type: string | null;
  attachment_byte_size: number | null;
  attachment_sha256: string | null;
  attachment_created_at: string | null;
}

export interface TemplateServiceDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
  ids: IdGenerator;
  attachmentStore: AttachmentStore;
}

export class TemplateService {
  private readonly audit: AuditService;

  constructor(private readonly dependencies: TemplateServiceDependencies) {
    this.audit = new AuditService(dependencies);
  }

  async uploadAttachment(file: File, actor: TemplateActor): Promise<AttachmentSummary> {
    const stored = await this.dependencies.attachmentStore.put(file);
    const id = this.dependencies.ids.next();
    const now = this.dependencies.clock.now().toISOString();
    try {
      this.dependencies.db.query(
        `INSERT INTO attachments
          (id, organization_id, original_name, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.organizationId, stored.originalName, stored.storageKey, stored.mimeType, stored.byteSize, stored.sha256, actor.userId, now);
    } catch (error) {
      await this.dependencies.attachmentStore.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "attachment.uploaded", subjectType: "attachment", subjectId: id, details: { mimeType: stored.mimeType, byteSize: stored.byteSize } });
    return this.attachmentSummary({ id, organization_id: actor.organizationId, original_name: stored.originalName, storage_key: stored.storageKey, mime_type: stored.mimeType, byte_size: stored.byteSize, sha256: stored.sha256, created_by_user_id: actor.userId, created_at: now });
  }

  listTemplates(actor: TemplateActor): { templates: TemplateSummary[] } {
    const rows = this.dependencies.db.query<TemplateRow, [string]>(this.templateSelect("WHERE t.organization_id = ? ORDER BY t.name, t.id")).all(actor.organizationId);
    return { templates: rows.map((row) => this.templateSummary(row)) };
  }

  createTemplate(input: TemplateCreateRequest, actor: TemplateActor): TemplateSummary {
    const variables = validateBody(input.body);
    const attachment = input.attachmentId ? this.getAttachment(input.attachmentId, actor.organizationId) : null;
    if (input.attachmentId && !attachment) throw new TemplateInputError("attachment_not_found");
    if (attachment && this.isAttachmentUsed(attachment.id)) throw new TemplateInputError("attachment_in_use");
    const id = this.dependencies.ids.next();
    const now = this.dependencies.clock.now().toISOString();
    try {
      this.dependencies.db.query(
        `INSERT INTO message_templates (id, organization_id, name, body, attachment_id, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.organizationId, input.name.trim(), input.body, attachment?.id ?? null, actor.userId, now, now);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new TemplateInputError("duplicate_template_name");
      throw error;
    }
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "template.created", subjectType: "template", subjectId: id, details: { variables, attachmentId: attachment?.id ?? null } });
    return this.getTemplate(id, actor.organizationId) as TemplateSummary;
  }

  updateTemplate(id: string, input: TemplateUpdateRequest, actor: TemplateActor): TemplateSummary {
    const existing = this.getTemplateRow(id, actor.organizationId);
    if (!existing) throw new TemplateInputError("template_not_found");
    const nextBody = input.body ?? existing.body;
    const variables = validateBody(nextBody);
    const attachmentId = input.attachmentId === undefined ? existing.attachment_id : input.attachmentId;
    const attachment = attachmentId ? this.getAttachment(attachmentId, actor.organizationId) : null;
    if (attachmentId && !attachment) throw new TemplateInputError("attachment_not_found");
    if (attachment && attachment.id !== existing.attachment_id && this.isAttachmentUsed(attachment.id)) throw new TemplateInputError("attachment_in_use");
    const now = this.dependencies.clock.now().toISOString();
    try {
      this.dependencies.db.query("UPDATE message_templates SET name = ?, body = ?, attachment_id = ?, updated_at = ? WHERE id = ? AND organization_id = ?").run(input.name?.trim() ?? existing.name, nextBody, attachment?.id ?? null, now, id, actor.organizationId);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new TemplateInputError("duplicate_template_name");
      throw error;
    }
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "template.updated", subjectType: "template", subjectId: id, details: { variables, attachmentId: attachment?.id ?? null } });
    return this.getTemplate(id, actor.organizationId) as TemplateSummary;
  }

  preview(body: string, attributes: Record<string, string>) {
    try { return previewTemplate(body, attributes); } catch (error) { throw toTemplateInputError(error); }
  }

  async downloadAttachment(id: string, actor: TemplateActor): Promise<{ attachment: AttachmentSummary; blob: Blob }> {
    const row = this.getAttachment(id, actor.organizationId);
    if (!row) throw new TemplateInputError("attachment_not_found");
    return { attachment: this.attachmentSummary(row), blob: await this.dependencies.attachmentStore.open(row.storage_key, row.mime_type) };
  }

  async deleteAttachment(id: string, actor: TemplateActor): Promise<void> {
    const row = this.getAttachment(id, actor.organizationId);
    if (!row) throw new TemplateInputError("attachment_not_found");
    if (this.isAttachmentUsed(id)) throw new TemplateInputError("attachment_in_use");
    await this.dependencies.attachmentStore.remove(row.storage_key);
    this.dependencies.db.query("DELETE FROM attachments WHERE id = ? AND organization_id = ?").run(id, actor.organizationId);
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "attachment.deleted", subjectType: "attachment", subjectId: id });
  }

  private getTemplate(id: string, organizationId: string): TemplateSummary | null {
    const row = this.getTemplateRow(id, organizationId);
    return row ? this.templateSummary(row) : null;
  }

  private getTemplateRow(id: string, organizationId: string): TemplateRow | null {
    return this.dependencies.db.query<TemplateRow, [string, string]>(this.templateSelect("WHERE t.id = ? AND t.organization_id = ?")).get(id, organizationId) ?? null;
  }

  private templateSelect(tail: string): string {
    return `SELECT t.*, a.original_name AS attachment_original_name, a.mime_type AS attachment_mime_type,
      a.byte_size AS attachment_byte_size, a.sha256 AS attachment_sha256, a.created_at AS attachment_created_at
      FROM message_templates t LEFT JOIN attachments a ON a.id = t.attachment_id ${tail}`;
  }

  private getAttachment(id: string, organizationId: string): AttachmentRow | null {
    return this.dependencies.db.query<AttachmentRow, [string, string]>("SELECT * FROM attachments WHERE id = ? AND organization_id = ?").get(id, organizationId) ?? null;
  }

  private isAttachmentUsed(id: string): boolean {
    return Boolean(this.dependencies.db.query("SELECT 1 FROM message_templates WHERE attachment_id = ? LIMIT 1").get(id));
  }

  private templateSummary(row: TemplateRow): TemplateSummary {
    return { id: row.id, name: row.name, body: row.body, variables: extractTemplateVariables(row.body), attachment: row.attachment_id && row.attachment_original_name && row.attachment_mime_type && row.attachment_byte_size !== null && row.attachment_sha256 && row.attachment_created_at ? { id: row.attachment_id, originalName: row.attachment_original_name, mimeType: row.attachment_mime_type, byteSize: row.attachment_byte_size, sha256: row.attachment_sha256, createdAt: row.attachment_created_at } : null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private attachmentSummary(row: AttachmentRow): AttachmentSummary {
    return { id: row.id, originalName: row.original_name, mimeType: row.mime_type, byteSize: row.byte_size, sha256: row.sha256, createdAt: row.created_at };
  }
}

export class TemplateInputError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function templateActorFromAuth(auth: AuthContext): TemplateActor {
  return { userId: auth.user.id, organizationId: auth.user.organizationId, role: auth.user.summary.role };
}

function validateBody(body: string): string[] {
  try { return extractTemplateVariables(body); } catch (error) { throw toTemplateInputError(error); }
}

function toTemplateInputError(error: unknown): TemplateInputError {
  if (error instanceof TemplateVariableError) return new TemplateInputError(error.code);
  return error instanceof TemplateInputError ? error : new TemplateInputError("invalid_template_body");
}
