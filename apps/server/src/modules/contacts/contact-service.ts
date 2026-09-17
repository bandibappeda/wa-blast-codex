import type { Database } from "bun:sqlite";
import type { ContactCreateRequest } from "@wa-blast/contracts";
import type { AppConfig } from "../../config";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { AuditService } from "../audit/audit-service";
import type { AuthContext } from "../auth/auth-service";
import { parseContactCsv, type CsvRow } from "./csv-import";
import { normalizePhone } from "./phone";

interface ContactActor {
  userId: string;
  organizationId: string;
  role: "admin" | "operator";
}

interface ContactRecord {
  id: string;
  phoneDisplay: string;
  phoneE164: string;
  name: string;
  attributes: Record<string, string>;
  hasConsent: boolean;
  suppressed: boolean;
  tags: string[];
}

interface ImportRowData {
  phone: string;
  phoneE164: string;
  name: string;
  consentSource: string;
  consentAt: string;
  tags: string[];
  attributes: Record<string, string>;
}

export interface ContactServiceDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
  ids: IdGenerator;
}

export class ContactService {
  private readonly audit: AuditService;

  constructor(private readonly dependencies: ContactServiceDependencies) {
    this.audit = new AuditService(dependencies);
  }

  createContact(input: ContactCreateRequest, actor: ContactActor): ContactRecord {
    const normalized = normalizePhone(input.phone, this.dependencies.config.defaultPhoneCountry);
    if (!normalized) throw new ContactInputError("invalid_phone");
    const consentAt = parseDate(input.consentAt);
    const now = this.dependencies.clock.now().toISOString();
    const id = this.dependencies.ids.next();
    const insert = this.dependencies.db.transaction(() => {
      this.dependencies.db.query(
        `INSERT INTO contacts
          (id, organization_id, phone_display, phone_e164, name, attributes_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.organizationId, normalized.display, normalized.e164, input.name.trim(), JSON.stringify(input.attributes), now, now);
      this.addConsent(id, input.consentSource, consentAt, now);
      this.replaceTags(id, input.tags, actor.organizationId);
      this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "contact.created", subjectType: "contact", subjectId: id });
    });
    try {
      insert();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new ContactInputError("duplicate_phone");
      throw error;
    }
    return this.getContact(id, actor.organizationId) as ContactRecord;
  }

  previewContactImport(input: { filename: string; content: string }, actor: ContactActor) {
    const rows = parseContactCsv(input.content);
    const importId = this.dependencies.ids.next();
    const now = this.dependencies.clock.now().toISOString();
    const seen = new Set<string>();
    const results: Array<{ rowNumber: number; status: "accepted" | "invalid" | "suppressed" | "duplicate"; error?: string; data?: ImportRowData }> = [];

    for (const [index, row] of rows.entries()) {
      const result = this.validateRow(row, actor.organizationId, seen);
      if (result.data) seen.add(result.data.phoneE164);
      results.push({ rowNumber: index + 2, ...result });
    }

    this.dependencies.db.transaction(() => {
      this.dependencies.db.query(
        "INSERT INTO contact_imports (id, organization_id, actor_user_id, filename, status, created_at) VALUES (?, ?, ?, ?, 'preview', ?)",
      ).run(importId, actor.organizationId, actor.userId, input.filename, now);
      for (const result of results) {
        this.dependencies.db.query(
          "INSERT INTO contact_import_rows (id, import_id, row_number, raw_json, status, error) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(this.dependencies.ids.next(), importId, result.rowNumber, JSON.stringify(result.data ?? {}), result.status, result.error ?? null);
      }
    })();

    return {
      previewId: importId,
      summary: {
        accepted: results.filter((row) => row.status === "accepted").length,
        invalid: results.filter((row) => row.status === "invalid").length,
        suppressed: results.filter((row) => row.status === "suppressed").length,
        duplicate: results.filter((row) => row.status === "duplicate").length,
      },
      rows: results,
    };
  }

  commitContactImport(previewId: string, actor: ContactActor): { accepted: number; skipped: number } {
    const preview = this.dependencies.db.query<{ status: string; organization_id: string }, [string]>("SELECT status, organization_id FROM contact_imports WHERE id = ?").get(previewId);
    if (!preview || preview.organization_id !== actor.organizationId || preview.status !== "preview") throw new ContactInputError("invalid_import");
    const rows = this.dependencies.db.query<{ id: string; row_number: number; raw_json: string; status: string }, [string]>("SELECT id, row_number, raw_json, status FROM contact_import_rows WHERE import_id = ? ORDER BY row_number").all(previewId);
    let accepted = 0;
    let skipped = 0;
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.transaction(() => {
      for (const row of rows) {
        if (row.status !== "accepted") { skipped += 1; continue; }
        const data = JSON.parse(row.raw_json) as ImportRowData;
        const existing = this.findByPhone(actor.organizationId, data.phoneE164);
        if (existing && this.isSuppressed(existing.id)) { skipped += 1; continue; }
        const contactId = existing?.id ?? this.dependencies.ids.next();
        if (existing) {
          this.dependencies.db.query("UPDATE contacts SET phone_display = ?, name = ?, attributes_json = ?, updated_at = ? WHERE id = ?").run(data.phone, data.name, JSON.stringify(data.attributes), now, contactId);
        } else {
          this.dependencies.db.query("INSERT INTO contacts (id, organization_id, phone_display, phone_e164, name, attributes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(contactId, actor.organizationId, data.phone, data.phoneE164, data.name, JSON.stringify(data.attributes), now, now);
        }
        this.addConsent(contactId, data.consentSource, data.consentAt, now);
        this.replaceTags(contactId, data.tags, actor.organizationId);
        this.dependencies.db.query("UPDATE contact_import_rows SET status = 'committed', contact_id = ? WHERE id = ?").run(contactId, row.id);
        accepted += 1;
      }
      this.dependencies.db.query("UPDATE contact_imports SET status = 'committed', committed_at = ? WHERE id = ?").run(now, previewId);
      this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "contact.import_committed", subjectType: "contact_import", subjectId: previewId, details: { accepted, skipped } });
    })();
    return { accepted, skipped };
  }

  listContacts(actor: ContactActor, query: { search?: string; limit?: number }): { contacts: ContactRecord[]; nextCursor: null } {
    const search = query.search?.trim() ?? "";
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const rows = this.dependencies.db.query<Record<string, unknown>, [string, string, string, number]>(
      `SELECT c.id, c.phone_display, c.phone_e164, c.name, c.attributes_json,
        EXISTS(SELECT 1 FROM contact_consents cc WHERE cc.contact_id = c.id) AS has_consent,
        EXISTS(SELECT 1 FROM suppressions s WHERE s.contact_id = c.id AND s.lifted_at IS NULL) AS suppressed
       FROM contacts c
       WHERE c.organization_id = ? AND (c.name LIKE ? OR c.phone_e164 LIKE ?)
       ORDER BY c.name, c.id LIMIT ?`,
    ).all(actor.organizationId, `%${search}%`, `%${search}%`, limit);
    return { contacts: rows.map((row) => this.recordFromRow(row, actor.organizationId)), nextCursor: null };
  }

  suppressContact(contactId: string, reason: string, actor: ContactActor): void {
    if (actor.role !== "admin") throw new ContactInputError("forbidden");
    const contact = this.getContact(contactId, actor.organizationId);
    if (!contact) throw new ContactInputError("contact_not_found");
    this.dependencies.db.query("INSERT INTO suppressions (id, contact_id, reason, suppressed_at, actor_user_id) VALUES (?, ?, ?, ?, ?)").run(this.dependencies.ids.next(), contactId, reason, this.dependencies.clock.now().toISOString(), actor.userId);
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "contact.suppressed", subjectType: "contact", subjectId: contactId, details: { reason } });
  }

  liftSuppression(contactId: string, reason: string, actor: ContactActor): void {
    if (actor.role !== "admin") throw new ContactInputError("forbidden");
    const active = this.dependencies.db.query<{ id: string }, [string]>("SELECT id FROM suppressions WHERE contact_id = ? AND lifted_at IS NULL ORDER BY suppressed_at DESC LIMIT 1").get(contactId);
    if (!active) throw new ContactInputError("suppression_not_found");
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query("UPDATE suppressions SET lifted_at = ?, lifted_reason = ?, lifted_by_user_id = ? WHERE id = ?").run(now, reason, actor.userId, active.id);
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "contact.suppression_lifted", subjectType: "contact", subjectId: contactId, details: { reason } });
  }

  private validateRow(row: CsvRow, organizationId: string, seen: Set<string>): { status: "accepted" | "invalid" | "suppressed" | "duplicate"; error?: string; data?: ImportRowData } {
    const normalized = normalizePhone(row.phone ?? "", this.dependencies.config.defaultPhoneCountry);
    if (!normalized) return { status: "invalid", error: "invalid_phone" };
    if (seen.has(normalized.e164)) return { status: "duplicate", error: "duplicate_in_file" };
    const consentSource = row.consent_source?.trim();
    const consentAt = row.consent_at?.trim();
    if (!consentSource || !consentAt || !isValidDate(consentAt)) return { status: "invalid", error: "consent_required" };
    const tags = (row.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const reserved = new Set(["phone", "name", "consent_source", "consent_at", "tags"]);
    const attributes = Object.fromEntries(Object.entries(row).filter(([key, value]) => !reserved.has(key) && value));
    const data: ImportRowData = { phone: normalized.display, phoneE164: normalized.e164, name: row.name?.trim() || normalized.e164, consentSource, consentAt: new Date(consentAt).toISOString(), tags, attributes };
    const existing = this.findByPhone(organizationId, normalized.e164);
    if (existing && this.isSuppressed(existing.id)) return { status: "suppressed", data };
    return { status: "accepted", data };
  }

  private addConsent(contactId: string, source: string, consentAt: string, createdAt: string): void {
    this.dependencies.db.query("INSERT INTO contact_consents (id, contact_id, source, consent_at, created_at) VALUES (?, ?, ?, ?, ?)").run(this.dependencies.ids.next(), contactId, source.trim(), parseDate(consentAt), createdAt);
  }

  private replaceTags(contactId: string, names: string[], organizationId: string): void {
    for (const name of names.map((tag) => tag.trim().toLowerCase()).filter(Boolean)) {
      const existing = this.dependencies.db.query<{ id: string }, [string, string]>("SELECT id FROM tags WHERE organization_id = ? AND name = ?").get(organizationId, name);
      const tagId = existing?.id ?? this.dependencies.ids.next();
      if (!existing) this.dependencies.db.query("INSERT INTO tags (id, organization_id, name) VALUES (?, ?, ?)").run(tagId, organizationId, name);
      this.dependencies.db.query("INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)").run(contactId, tagId);
    }
  }

  private findByPhone(organizationId: string, phoneE164: string): { id: string } | null {
    return this.dependencies.db.query<{ id: string }, [string, string]>("SELECT id FROM contacts WHERE organization_id = ? AND phone_e164 = ?").get(organizationId, phoneE164) ?? null;
  }

  private isSuppressed(contactId: string): boolean {
    return Boolean(this.dependencies.db.query("SELECT 1 AS active FROM suppressions WHERE contact_id = ? AND lifted_at IS NULL LIMIT 1").get(contactId));
  }

  private getContact(contactId: string, organizationId: string): ContactRecord | null {
    const row = this.dependencies.db.query<Record<string, unknown>, [string, string]>("SELECT c.id, c.phone_display, c.phone_e164, c.name, c.attributes_json, EXISTS(SELECT 1 FROM contact_consents cc WHERE cc.contact_id = c.id) AS has_consent, EXISTS(SELECT 1 FROM suppressions s WHERE s.contact_id = c.id AND s.lifted_at IS NULL) AS suppressed FROM contacts c WHERE c.id = ? AND c.organization_id = ?").get(contactId, organizationId);
    return row ? this.recordFromRow(row, organizationId) : null;
  }

  private recordFromRow(row: Record<string, unknown>, organizationId: string): ContactRecord {
    const tags = this.dependencies.db.query<{ name: string }, [string]>("SELECT t.name FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = ? ORDER BY t.name").all(String(row.id)).map((tag) => tag.name);
    return { id: String(row.id), phoneDisplay: String(row.phone_display), phoneE164: String(row.phone_e164), name: String(row.name), attributes: JSON.parse(String(row.attributes_json)) as Record<string, string>, hasConsent: Boolean(row.has_consent), suppressed: Boolean(row.suppressed), tags };
  }
}

export class ContactInputError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function actorFromAuth(auth: AuthContext): ContactActor {
  return { userId: auth.user.id, organizationId: auth.user.organizationId, role: auth.user.summary.role };
}

function parseDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ContactInputError("invalid_date");
  return parsed.toISOString();
}

function isValidDate(value: string): boolean { return !Number.isNaN(new Date(value).getTime()); }
