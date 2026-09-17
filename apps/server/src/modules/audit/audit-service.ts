import type { Database } from "bun:sqlite";
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
}
