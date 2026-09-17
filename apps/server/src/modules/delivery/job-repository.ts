import type { Database } from "bun:sqlite";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import type { ClassifiedGatewayResult } from "./error-classifier";

export interface DeliveryJob {
  id: string;
  campaign_id: string;
  campaign_recipient_id: string;
  idempotency_key: string;
  status: "pending" | "retry" | "leased" | "sent" | "delivered" | "read" | "failed" | "cancelled";
  attempt_count: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  gateway_connection_id: string;
  organization_id: string;
  campaign_state: string;
  phone_e164: string;
  rendered_body: string;
  attachment_storage_key: string | null;
  attachment_mime_type: string | null;
}

export interface DeliveryRepositoryDependencies {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
}

export class JobRepository {
  constructor(private readonly dependencies: DeliveryRepositoryDependencies) {}

  claim(owner: string, now: Date, limit: number, leaseMs: number): DeliveryJob[] {
    const nowIso = now.toISOString();
    const leaseExpires = new Date(now.getTime() + leaseMs).toISOString();
    this.dependencies.db.exec("BEGIN IMMEDIATE");
    try {
      const claimed = this.dependencies.db.query<{ id: string }, [string, string, number, string, string, string]>(
        `WITH candidates AS (
          SELECT j.id
          FROM message_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE j.status IN ('pending', 'retry')
            AND j.available_at <= ?
            AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= ?)
            AND c.state IN ('queued', 'running')
          ORDER BY j.available_at, j.id
          LIMIT ?
        )
        UPDATE message_jobs
        SET status = 'leased', lease_owner = ?, lease_expires_at = ?, updated_at = ?
        WHERE id IN (SELECT id FROM candidates)
        RETURNING id`,
      ).all(nowIso, nowIso, limit, owner, leaseExpires, nowIso);
      const jobs = claimed.map((row) => this.get(row.id)).filter((job): job is DeliveryJob => job !== null);
      this.dependencies.db.exec("COMMIT");
      return jobs;
    } catch (error) {
      this.dependencies.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(id: string): DeliveryJob | null {
    return this.dependencies.db.query<DeliveryJob, [string]>(
      `SELECT j.id, j.campaign_id, j.campaign_recipient_id, j.idempotency_key, j.status,
        j.attempt_count, j.available_at, j.lease_owner, j.lease_expires_at,
        c.gateway_connection_id, c.organization_id, c.state AS campaign_state,
        cr.phone_e164, cr.rendered_body, cr.attachment_storage_key, cr.attachment_mime_type
       FROM message_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
       JOIN campaign_recipients cr ON cr.id = j.campaign_recipient_id
       WHERE j.id = ?`,
    ).get(id) ?? null;
  }

  release(jobId: string, availableAt: Date): void {
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query("UPDATE message_jobs SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, available_at = ?, updated_at = ? WHERE id = ? AND status = 'leased'").run(availableAt.toISOString(), now, jobId);
  }

  markSent(job: DeliveryJob, result: Extract<ClassifiedGatewayResult, { category: "sent" }>): void {
    const now = this.dependencies.clock.now().toISOString();
    const attemptNumber = job.attempt_count + 1;
    this.dependencies.db.transaction(() => {
      this.dependencies.db.query("INSERT INTO delivery_attempts (id, message_job_id, attempt_number, outcome, provider_message_id, started_at, finished_at) VALUES (?, ?, ?, 'sent', ?, ?, ?)").run(this.dependencies.ids.next(), job.id, attemptNumber, result.providerMessageId, now, now);
      this.dependencies.db.query("UPDATE message_jobs SET status = 'sent', attempt_count = ?, provider_message_id = ?, sent_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND lease_owner IS NOT NULL").run(attemptNumber, result.providerMessageId, now, now, job.id);
    })();
  }

  markFailure(job: DeliveryJob, result: Extract<ClassifiedGatewayResult, { category: "transient" | "permanent" }>, retryAt: Date | null): void {
    const now = this.dependencies.clock.now().toISOString();
    const attemptNumber = job.attempt_count + 1;
    const retrying = result.category === "transient" && retryAt !== null;
    this.dependencies.db.transaction(() => {
      this.dependencies.db.query("INSERT INTO delivery_attempts (id, message_job_id, attempt_number, outcome, error_code, error_message, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(this.dependencies.ids.next(), job.id, attemptNumber, result.category, result.code, result.message, now, now);
      this.dependencies.db.query(
        `UPDATE message_jobs SET status = ?, attempt_count = ?, available_at = ?, lease_owner = NULL,
           lease_expires_at = NULL, last_error_category = ?, last_error_code = ?, last_error_message = ?, updated_at = ?
         WHERE id = ? AND lease_owner IS NOT NULL`,
      ).run(retrying ? "retry" : "failed", attemptNumber, retryAt?.toISOString() ?? now, result.category, result.code, result.message, now, job.id);
    })();
  }

  releaseWorkerLeases(owner: string): void {
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query("UPDATE message_jobs SET status = 'retry', lease_owner = NULL, lease_expires_at = NULL, available_at = ?, updated_at = ? WHERE lease_owner = ? AND status = 'leased'").run(now, now, owner);
  }

  heartbeat(workerId: string, status: "healthy" | "stopping" | "unhealthy"): void {
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query("INSERT INTO worker_heartbeats (worker_id, last_tick_at, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(worker_id) DO UPDATE SET last_tick_at = excluded.last_tick_at, status = excluded.status, updated_at = excluded.updated_at").run(workerId, now, status, now);
  }
}
