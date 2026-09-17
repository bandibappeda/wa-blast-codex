import type { Database } from "bun:sqlite";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { GatewayDeliveryError, GatewayService } from "../gateways/gateway-service";
import { classifyGatewayResult } from "./error-classifier";
import { JobRepository } from "./job-repository";
import { retryDecision } from "./retry-policy";
import { DeliveryScheduler } from "./scheduler";

export interface WorkerTickResult { claimed: number; sent: number; retried: number; failed: number; }

export interface DeliveryWorkerDependencies {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  gatewayService: GatewayService;
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  retryJitter?: () => number;
}

export class DeliveryWorker {
  private readonly jobs: JobRepository;
  private readonly scheduler: DeliveryScheduler;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly retryJitter: () => number;

  constructor(private readonly dependencies: DeliveryWorkerDependencies) {
    this.jobs = new JobRepository(dependencies);
    this.scheduler = new DeliveryScheduler(dependencies);
    this.batchSize = dependencies.batchSize ?? 25;
    this.leaseMs = dependencies.leaseMs ?? 60_000;
    this.retryJitter = dependencies.retryJitter ?? (() => Math.floor(Math.random() * 5_000));
  }

  async tick(): Promise<WorkerTickResult> {
    const now = this.dependencies.clock.now();
    this.scheduler.advance(now);
    this.jobs.heartbeat(this.dependencies.workerId, "healthy");
    const claimed = this.jobs.claim(this.dependencies.workerId, now, this.batchSize, this.leaseMs);
    const result: WorkerTickResult = { claimed: claimed.length, sent: 0, retried: 0, failed: 0 };
    for (const job of claimed) {
      const slot = this.dependencies.gatewayService.reserveSendSlot(job.gateway_connection_id, job.organization_id, now);
      if (slot > now) {
        this.jobs.release(job.id, slot);
        continue;
      }
      try {
        const sendResult = await this.dependencies.gatewayService.sendMessageForJob({
          connectionId: job.gateway_connection_id,
          organizationId: job.organization_id,
          idempotencyKey: job.idempotency_key,
          recipientPhone: job.phone_e164,
          body: job.rendered_body,
          ...(job.attachment_storage_key && job.attachment_mime_type ? { attachment: { storageKey: job.attachment_storage_key, mimeType: job.attachment_mime_type } } : {}),
        });
        const classified = classifyGatewayResult(sendResult);
        if (classified.category === "sent") {
          this.dependencies.gatewayService.recordDeliveryOutcome(job.gateway_connection_id, job.organization_id, false);
          this.jobs.markSent(job, classified);
          result.sent += 1;
        } else {
          this.dependencies.gatewayService.recordDeliveryOutcome(job.gateway_connection_id, job.organization_id, classified.category === "transient");
          const decision = classified.category === "transient" ? retryDecision(job.attempt_count + 1, now, this.retryJitter) : { shouldRetry: false, availableAt: null };
          this.jobs.markFailure(job, classified, decision.availableAt ? new Date(decision.availableAt) : null);
          if (decision.shouldRetry) result.retried += 1;
          else result.failed += 1;
        }
      } catch (error) {
        this.dependencies.gatewayService.recordDeliveryOutcome(job.gateway_connection_id, job.organization_id, true);
        const failure = error instanceof GatewayDeliveryError ? { category: "permanent" as const, code: error.code, message: error.code } : { category: "transient" as const, code: "worker_error", message: "gateway delivery failed" };
        const decision = failure.category === "transient" ? retryDecision(job.attempt_count + 1, now, this.retryJitter) : { shouldRetry: false, availableAt: null };
        this.jobs.markFailure(job, failure, decision.availableAt ? new Date(decision.availableAt) : null);
        if (decision.shouldRetry) result.retried += 1;
        else result.failed += 1;
      }
    }
    return result;
  }

  shutdown(): void {
    this.jobs.releaseWorkerLeases(this.dependencies.workerId);
    this.jobs.heartbeat(this.dependencies.workerId, "stopping");
  }
}
