import type { Database } from "bun:sqlite";
import type { AuditQuery } from "@wa-blast/contracts";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export interface AuditEntryInput {
  organizationId: string;
  actorUserId?: string;
  action: string;
  subjectType: string;
  subjectId?: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export interface AuditDependencies {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
}

export class AuditService {
  constructor(private readonly dependencies: AuditDependencies) {}

  record(input: AuditEntryInput): string {
    const id = this.dependencies.ids.next();
    const correlationId = input.correlationId ?? id;
    this.dependencies.db
      .query(
        `INSERT INTO audit_entries
          (id, organization_id, actor_user_id, action, subject_type, subject_id,
           details_json, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.organizationId,
        input.actorUserId ?? null,
        input.action,
        input.subjectType,
        input.subjectId ?? null,
        JSON.stringify(input.details ?? {}),
        correlationId,
        this.dependencies.clock.now().toISOString(),
      );
    return id;
  }

  listEntries(input: { organizationId: string; query: AuditQuery }): { entries: AuditEntryView[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } } {
    const { organizationId, query } = input;
    const filterParams: AuditFilterParams = [organizationId, query.actorId ?? null, query.actorId ?? null, query.action ?? null, query.action ?? null, query.subjectType ?? null, query.subjectType ?? null, query.subjectId ?? null, query.subjectId ?? null, query.from ?? null, query.from ?? null, query.to ?? null, query.to ?? null];
    const total = this.dependencies.db.query<{ count: number }, AuditFilterParams>(
      `SELECT COUNT(*) AS count FROM audit_entries
       WHERE organization_id = ?
         AND (? IS NULL OR actor_user_id = ?)
         AND (? IS NULL OR action = ?)
         AND (? IS NULL OR subject_type = ?)
         AND (? IS NULL OR subject_id = ?)
         AND (? IS NULL OR created_at >= ?)
         AND (? IS NULL OR created_at <= ?)`,
    ).get(...filterParams)?.count ?? 0;
    const rows = this.dependencies.db.query<AuditRow, [string, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, number, number]>(
      `SELECT a.id, a.action, a.subject_type, a.subject_id, a.details_json, a.correlation_id, a.created_at,
              u.id AS actor_id, u.email AS actor_email, u.display_name AS actor_display_name
       FROM audit_entries a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.organization_id = ?
         AND (? IS NULL OR a.actor_user_id = ?)
         AND (? IS NULL OR a.action = ?)
         AND (? IS NULL OR a.subject_type = ?)
         AND (? IS NULL OR a.subject_id = ?)
         AND (? IS NULL OR a.created_at >= ?)
         AND (? IS NULL OR a.created_at <= ?)
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
    ).all(...filterParams, query.pageSize, (query.page - 1) * query.pageSize);
    return {
      entries: rows.map(toView),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
    };
  }
}

type AuditFilterParams = [string, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null];

interface AuditRow {
  id: string;
  action: string;
  subject_type: string;
  subject_id: string | null;
  details_json: string;
  correlation_id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_display_name: string | null;
}

export interface AuditEntryView {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  actor: { id: string; email: string; displayName: string } | null;
  details: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
}

function toView(row: AuditRow): AuditEntryView {
  return {
    id: row.id,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    actor: row.actor_id && row.actor_email && row.actor_display_name ? { id: row.actor_id, email: row.actor_email, displayName: row.actor_display_name } : null,
    details: redactDetails(parseDetails(row.details_json)) as Record<string, unknown>,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

function parseDetails(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function redactDetails(value: unknown, key?: string): unknown {
  if (key && /(password|secret|token|credential|encrypted|csrf|session|authorization)/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactDetails(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactDetails(entryValue, entryKey)]));
  return value;
}
