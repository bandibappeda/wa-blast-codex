import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { DeliveryResultsQuery } from "@wa-blast/contracts";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import type { AuthContext } from "../auth/auth-service";
import type { CredentialVault } from "../gateways/credential-vault";
import type { GatewayRegistry } from "../gateways/gateway-registry";
import type { GatewayWebhookRequest, NormalizedGatewayEvent } from "../gateways/gateway-adapter";
import { projectDeliveryStatus, type ProjectedDeliveryStatus } from "./status-projector";

type StoredDeliveryStatus = ProjectedDeliveryStatus;
type CanonicalEventStatus = "sent" | "delivered" | "read" | "failed" | "unknown";

interface GatewayWebhookRow {
  id: string;
  adapter_type: string;
  encrypted_config: string;
}

interface MessageJobRow {
  id: string;
  status: StoredDeliveryStatus;
  provider_message_id: string | null;
  sent_at: string | null;
}

export interface WebhookServiceDependencies {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  registry: GatewayRegistry;
  vault: CredentialVault;
}

export interface WebhookResult {
  accepted: number;
  duplicate: number;
  unknown: number;
}

export type DeliveryResultStatus = StoredDeliveryStatus | "retry";

export interface DeliveryResults {
  campaign: { id: string; name: string; state: string };
  summary: {
    total: number;
    pending: number;
    retrying: number;
    leased: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    cancelled: number;
  };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  recipients: Array<{
    id: string;
    name: string;
    phone: string;
    status: DeliveryResultStatus;
    attemptCount: number;
    providerMessageId: string | null;
    lastError: string | null;
    updatedAt: string;
  }>;
}

interface CampaignRow {
  id: string;
  name: string;
  state: string;
}

interface RecipientRow {
  id: string;
  name: string;
  phone_e164: string;
  status: DeliveryResultStatus;
  attempt_count: number;
  provider_message_id: string | null;
  last_error_message: string | null;
  updated_at: string;
}

interface IncomingEvent {
  eventId?: string;
  idempotencyKey: string;
  status: CanonicalEventStatus;
  providerMessageId?: string;
  raw?: unknown;
}

export class WebhookService {
  constructor(private readonly dependencies: WebhookServiceDependencies) {}

  async processWebhook(gatewayId: string, token: string | undefined, request: GatewayWebhookRequest): Promise<WebhookResult> {
    const gateway = this.getGateway(gatewayId);
    if (!gateway) throw new WebhookInputError("gateway_not_found");

    const credentials = await this.dependencies.vault.decrypt(gateway.encrypted_config).catch(() => null);
    const webhookSecret = credentials?.webhookSecret ?? credentials?.webhookToken;
    if (!webhookSecret || !timingSafeEqual(webhookSecret, token)) {
      throw new WebhookAuthError();
    }

    const adapter = this.dependencies.registry.get(gateway.adapter_type);
    const normalized = await adapter.normalizeWebhook(request);
    const events: IncomingEvent[] = normalized.length > 0
      ? normalized.map((event) => toIncomingEvent(event))
      : [{
          idempotencyKey: request.idempotencyKey,
          status: "unknown",
          ...(request.eventId === undefined ? {} : { eventId: request.eventId }),
          ...(request.providerMessageId === undefined ? {} : { providerMessageId: request.providerMessageId }),
          ...(request.raw === undefined ? {} : { raw: request.raw }),
        }];

    const result: WebhookResult = { accepted: 0, duplicate: 0, unknown: 0 };
    for (const event of events) {
      const outcome = this.recordEvent(gatewayId, request, event);
      if (outcome === "duplicate") result.duplicate += 1;
      else if (outcome === "unknown") result.unknown += 1;
      else result.accepted += 1;
    }
    return result;
  }

  getDeliveryResults(campaignId: string, actor: AuthContext, query: DeliveryResultsQuery): DeliveryResults {
    const campaign = this.getCampaign(campaignId, actor.user.organizationId);
    const summary: DeliveryResults["summary"] = {
      total: 0,
      pending: 0,
      retrying: 0,
      leased: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      cancelled: 0,
    };
    const counts = this.dependencies.db.query<{ status: DeliveryResultStatus; count: number }, [string, string]>(
      "SELECT j.status, COUNT(*) AS count FROM message_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE j.campaign_id = ? AND c.organization_id = ? GROUP BY j.status",
    ).all(campaignId, actor.user.organizationId);
    for (const row of counts) {
      summary.total += row.count;
      const key = row.status === "retry" ? "retrying" : row.status;
      if (key in summary) summary[key as Exclude<keyof DeliveryResults["summary"], "total">] = row.count;
    }

    const total = this.countRecipients(campaignId, actor.user.organizationId, query);
    const rows = this.getRecipientRows(campaignId, actor.user.organizationId, query, query.pageSize, (query.page - 1) * query.pageSize);
    return {
      campaign,
      summary,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      recipients: rows.map(toDeliveryRecipient),
    };
  }

  getDeliveryCsv(campaignId: string, actor: AuthContext, query: DeliveryResultsQuery): string {
    this.getCampaign(campaignId, actor.user.organizationId);
    const rows = this.getRecipientRows(campaignId, actor.user.organizationId, query);
    const header = ["job_id", "recipient", "phone", "status", "attempts", "provider_message_id", "last_error", "updated_at"];
    const body = rows.map((row) => [
      row.id,
      row.name,
      row.phone_e164,
      row.status,
      row.attempt_count,
      row.provider_message_id,
      row.last_error_message,
      row.updated_at,
    ]);
    return [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  private getCampaign(campaignId: string, organizationId: string): CampaignRow {
    const campaign = this.dependencies.db.query<CampaignRow, [string, string]>(
      "SELECT id, name, state FROM campaigns WHERE id = ? AND organization_id = ?",
    ).get(campaignId, organizationId);
    if (!campaign) throw new WebhookInputError("campaign_not_found");
    return campaign;
  }

  private countRecipients(campaignId: string, organizationId: string, query: DeliveryResultsQuery): number {
    const params = this.deliveryFilterParams(campaignId, organizationId, query);
    return this.dependencies.db.query<{ count: number }, [string, string, string | null, string | null, string, string, string]>(
      `SELECT COUNT(*) AS count
       FROM message_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
       JOIN campaign_recipients cr ON cr.id = j.campaign_recipient_id
       WHERE j.campaign_id = ? AND c.organization_id = ?
         AND (? IS NULL OR j.status = ?)
         AND (? = '' OR lower(cr.name) LIKE ? OR cr.phone_e164 LIKE ?)`,
    ).get(...params)?.count ?? 0;
  }

  private getRecipientRows(campaignId: string, organizationId: string, query: DeliveryResultsQuery, limit?: number, offset?: number): RecipientRow[] {
    const sql = `SELECT j.id, cr.name, cr.phone_e164, j.status, j.attempt_count,
                        j.provider_message_id, j.last_error_message, j.updated_at
                 FROM message_jobs j
                 JOIN campaigns c ON c.id = j.campaign_id
                 JOIN campaign_recipients cr ON cr.id = j.campaign_recipient_id
                 WHERE j.campaign_id = ? AND c.organization_id = ?
                   AND (? IS NULL OR j.status = ?)
                   AND (? = '' OR lower(cr.name) LIKE ? OR cr.phone_e164 LIKE ?)
                 ORDER BY cr.name, cr.id`;
    const params = this.deliveryFilterParams(campaignId, organizationId, query);
    if (limit !== undefined && offset !== undefined) {
      return this.dependencies.db.query<RecipientRow, [string, string, string | null, string | null, string, string, string, number, number]>(`${sql} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    }
    return this.dependencies.db.query<RecipientRow, [string, string, string | null, string | null, string, string, string]>(sql).all(...params);
  }

  private deliveryFilterParams(campaignId: string, organizationId: string, query: DeliveryResultsQuery): [string, string, string | null, string | null, string, string, string] {
    const status = query.status === "retrying" ? "retry" : query.status ?? null;
    const search = query.search?.trim().toLowerCase() ?? "";
    return [campaignId, organizationId, status, status, search, `%${search}%`, `%${search}%`];
  }

  private recordEvent(gatewayId: string, request: GatewayWebhookRequest, event: IncomingEvent): "accepted" | "duplicate" | "unknown" {
    const providerEventId = event.eventId ? `${gatewayId}:${event.eventId}` : null;
    const fingerprint = providerEventId ?? createHash("sha256")
      .update(`${gatewayId}|${event.idempotencyKey}|${event.status}|${event.providerMessageId ?? ""}`)
      .digest("hex");
    const now = this.dependencies.clock.now().toISOString();
    const rawJson = JSON.stringify(event.raw ?? request.raw ?? request);

    this.dependencies.db.exec("BEGIN IMMEDIATE");
    try {
      const job = this.findJob(gatewayId, event.idempotencyKey);
      if (!job) {
        this.dependencies.db.exec("COMMIT");
        return "unknown";
      }
      this.dependencies.db.query(
        `INSERT OR IGNORE INTO delivery_events
          (id, message_job_id, provider_event_id, fingerprint, canonical_status, raw_type, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        this.dependencies.ids.next(),
        job.id,
        providerEventId,
        fingerprint,
        event.status,
        request.status,
        rawJson,
        now,
      );
      const inserted = this.dependencies.db.query<{ changes: number }, []>("SELECT changes() AS changes").get()?.changes === 1;
      if (!inserted) {
        this.dependencies.db.exec("COMMIT");
        return "duplicate";
      }

      if (event.status !== "unknown") {
        const projected = projectDeliveryStatus(job.status, event.status, job.provider_message_id, event.providerMessageId);
        const providerMessageId = event.providerMessageId ?? job.provider_message_id;
        const sentAt = isSentStatus(projected) ? job.sent_at ?? now : job.sent_at;
        this.dependencies.db.query(
          `UPDATE message_jobs
           SET status = ?, provider_message_id = ?, sent_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(projected, providerMessageId, sentAt, now, job.id);
      }
      this.dependencies.db.exec("COMMIT");
      return event.status === "unknown" ? "unknown" : "accepted";
    } catch (error) {
      this.dependencies.db.exec("ROLLBACK");
      throw error;
    }
  }

  private getGateway(id: string): GatewayWebhookRow | null {
    return this.dependencies.db.query<GatewayWebhookRow, [string]>(
      "SELECT id, adapter_type, encrypted_config FROM gateway_connections WHERE id = ?",
    ).get(id) ?? null;
  }

  private findJob(gatewayId: string, idempotencyKey: string): MessageJobRow | null {
    return this.dependencies.db.query<MessageJobRow, [string, string]>(
      `SELECT j.id, j.status, j.provider_message_id, j.sent_at
       FROM message_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
       WHERE j.idempotency_key = ? AND c.gateway_connection_id = ?`,
    ).get(idempotencyKey, gatewayId) ?? null;
  }
}

export class WebhookAuthError extends Error {
  constructor() { super("invalid_webhook_auth"); }
}

export class WebhookInputError extends Error {
  constructor(readonly code: "gateway_not_found" | "campaign_not_found") { super(code); }
}

function toIncomingEvent(event: NormalizedGatewayEvent): IncomingEvent {
  return {
    idempotencyKey: event.idempotencyKey,
    status: event.status,
    ...(event.eventId === undefined ? {} : { eventId: event.eventId }),
    ...(event.providerMessageId === undefined ? {} : { providerMessageId: event.providerMessageId }),
    ...(event.raw === undefined ? {} : { raw: event.raw }),
  };
}

function isSentStatus(status: StoredDeliveryStatus): boolean {
  return status === "sent" || status === "delivered" || status === "read";
}

function timingSafeEqual(expected: string, actual: string | undefined): boolean {
  const expectedBytes = new TextEncoder().encode(expected);
  const actualBytes = new TextEncoder().encode(actual ?? "");
  let difference = expectedBytes.length ^ actualBytes.length;
  const length = Math.max(expectedBytes.length, actualBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (actualBytes[index] ?? 0);
  }
  return difference === 0;
}

function toDeliveryRecipient(row: RecipientRow): DeliveryResults["recipients"][number] {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone_e164,
    status: row.status,
    attemptCount: row.attempt_count,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error_message,
    updatedAt: row.updated_at,
  };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
