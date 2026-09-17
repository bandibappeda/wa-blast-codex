import type { Database } from "bun:sqlite";
import type { GatewayCreateRequest, GatewayUpdateRequest } from "@wa-blast/contracts";
import type { AppConfig } from "../../config";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { AuditService } from "../audit/audit-service";
import type { AuthContext } from "../auth/auth-service";
import type {
  GatewayConnectionConfig,
  GatewayHealth,
  SendMessageResult,
} from "./gateway-adapter";
import { CredentialVault } from "./credential-vault";
import { GatewayRegistry } from "./gateway-registry";

export interface GatewayActor {
  userId: string;
  organizationId: string;
  role: "admin" | "operator";
}

export interface GatewaySummary {
  id: string;
  name: string;
  adapterType: string;
  senderIdentity: string;
  messagesPerMinute: number;
  enabled: boolean;
  healthStatus: "unknown" | "healthy" | "unhealthy";
  lastHealthCheckedAt: string | null;
  consecutiveFailures: number;
  unhealthyUntil: string | null;
}

interface GatewayRow {
  id: string;
  organization_id: string;
  name: string;
  adapter_type: string;
  sender_identity: string;
  encrypted_config: string;
  messages_per_minute: number;
  enabled: number;
  health_status: "unknown" | "healthy" | "unhealthy";
  last_health_checked_at: string | null;
  consecutive_failures: number;
  unhealthy_until: string | null;
  next_send_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GatewayServiceDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
  ids: IdGenerator;
  registry: GatewayRegistry;
  vault: CredentialVault;
}

export class GatewayService {
  private readonly audit: AuditService;

  constructor(private readonly dependencies: GatewayServiceDependencies) {
    this.audit = new AuditService(dependencies);
  }

  async createConnection(input: GatewayCreateRequest, actor: GatewayActor): Promise<GatewaySummary> {
    const adapter = this.dependencies.registry.get(input.adapterType);
    const connection: GatewayConnectionConfig = {
      id: "validation",
      type: input.adapterType,
      senderIdentity: input.senderIdentity,
      config: input.credentials,
    };
    const validation = await adapter.validateConnection(connection);
    if (!validation.valid) throw new GatewayInputError(validation.error ?? "invalid_connection");

    const id = this.dependencies.ids.next();
    const now = this.dependencies.clock.now().toISOString();
    const encryptedConfig = await this.dependencies.vault.encrypt(input.credentials);
    try {
      this.dependencies.db.query(
        `INSERT INTO gateway_connections
          (id, organization_id, name, adapter_type, sender_identity, encrypted_config,
           messages_per_minute, enabled, health_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'unknown', ?, ?)`,
      ).run(
        id,
        actor.organizationId,
        input.name.trim(),
        input.adapterType,
        input.senderIdentity.trim(),
        encryptedConfig,
        input.messagesPerMinute,
        now,
        now,
      );
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new GatewayInputError("duplicate_gateway_name");
      throw error;
    }
    this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gateway.created",
      subjectType: "gateway",
      subjectId: id,
      details: { name: input.name.trim(), adapterType: input.adapterType, senderIdentity: input.senderIdentity.trim() },
    });
    return this.getSummary(id, actor.organizationId) as GatewaySummary;
  }

  listConnections(actor: GatewayActor): { gateways: GatewaySummary[] } {
    const rows = this.dependencies.db.query<GatewayRow, [string]>(
      "SELECT * FROM gateway_connections WHERE organization_id = ? ORDER BY name, id",
    ).all(actor.organizationId);
    return { gateways: rows.map((row) => this.toSummary(row)) };
  }

  async updateConnection(id: string, input: GatewayUpdateRequest, actor: GatewayActor): Promise<GatewaySummary> {
    const row = this.getRow(id, actor.organizationId);
    if (!row) throw new GatewayInputError("gateway_not_found");
    const nextType = input.adapterType ?? row.adapter_type;
    const nextSender = input.senderIdentity?.trim() ?? row.sender_identity;
    const nextCredentials = input.credentials ?? await this.dependencies.vault.decrypt(row.encrypted_config);
    const adapter = this.dependencies.registry.get(nextType);
    const validation = await adapter.validateConnection({ id, type: nextType, senderIdentity: nextSender, config: nextCredentials });
    if (!validation.valid) throw new GatewayInputError(validation.error ?? "invalid_connection");
    const encryptedConfig = input.credentials
      ? await this.dependencies.vault.encrypt(nextCredentials)
      : row.encrypted_config;
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query(
      `UPDATE gateway_connections
       SET name = ?, adapter_type = ?, sender_identity = ?, encrypted_config = ?,
           messages_per_minute = ?, enabled = ?, health_status = 'unknown', updated_at = ?
       WHERE id = ? AND organization_id = ?`,
    ).run(
      input.name?.trim() ?? row.name,
      nextType,
      nextSender,
      encryptedConfig,
      input.messagesPerMinute ?? row.messages_per_minute,
      input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
      now,
      id,
      actor.organizationId,
    );
    this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gateway.updated",
      subjectType: "gateway",
      subjectId: id,
      details: { changedCredentials: Boolean(input.credentials), enabled: input.enabled },
    });
    return this.getSummary(id, actor.organizationId) as GatewaySummary;
  }

  async checkHealth(id: string, actor: GatewayActor): Promise<{ gateway: GatewaySummary; health: GatewayHealth }> {
    const row = this.getRow(id, actor.organizationId);
    if (!row) throw new GatewayInputError("gateway_not_found");
    const health = await this.dependencies.registry.get(row.adapter_type).checkHealth(await this.toConnection(row));
    const now = this.dependencies.clock.now().toISOString();
    const failures = health.status === "healthy" ? 0 : row.consecutive_failures + 1;
    const unhealthyUntil = health.status === "healthy"
      ? null
      : new Date(this.dependencies.clock.now().getTime() + 60_000).toISOString();
    this.dependencies.db.query(
      `UPDATE gateway_connections
       SET health_status = ?, last_health_checked_at = ?, consecutive_failures = ?, unhealthy_until = ?, updated_at = ?
       WHERE id = ? AND organization_id = ?`,
    ).run(health.status, now, failures, unhealthyUntil, now, id, actor.organizationId);
    this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gateway.health_checked",
      subjectType: "gateway",
      subjectId: id,
      details: { status: health.status },
    });
    return { gateway: this.getSummary(id, actor.organizationId) as GatewaySummary, health };
  }

  async sendTestMessage(id: string, recipientPhone: string, body: string, actor: GatewayActor): Promise<SendMessageResult> {
    const row = this.getRow(id, actor.organizationId);
    if (!row) throw new GatewayInputError("gateway_not_found");
    if (!row.enabled) throw new GatewayInputError("gateway_disabled");
    const result = await this.dependencies.registry.get(row.adapter_type).sendMessage({
      connection: await this.toConnection(row),
      idempotencyKey: `test-${this.dependencies.ids.next()}`,
      recipientPhone,
      body,
    });
    this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "gateway.test_sent",
      subjectType: "gateway",
      subjectId: id,
      details: { result: result.kind, recipientPhone: maskPhone(recipientPhone) },
    });
    return result;
  }

  private async toConnection(row: GatewayRow): Promise<GatewayConnectionConfig> {
    return {
      id: row.id,
      type: row.adapter_type,
      senderIdentity: row.sender_identity,
      config: await this.dependencies.vault.decrypt(row.encrypted_config),
    };
  }

  private getRow(id: string, organizationId: string): GatewayRow | null {
    return this.dependencies.db.query<GatewayRow, [string, string]>(
      "SELECT * FROM gateway_connections WHERE id = ? AND organization_id = ?",
    ).get(id, organizationId) ?? null;
  }

  private getSummary(id: string, organizationId: string): GatewaySummary | null {
    const row = this.getRow(id, organizationId);
    return row ? this.toSummary(row) : null;
  }

  private toSummary(row: GatewayRow): GatewaySummary {
    return {
      id: row.id,
      name: row.name,
      adapterType: row.adapter_type,
      senderIdentity: row.sender_identity,
      messagesPerMinute: row.messages_per_minute,
      enabled: row.enabled === 1,
      healthStatus: row.health_status,
      lastHealthCheckedAt: row.last_health_checked_at,
      consecutiveFailures: row.consecutive_failures,
      unhealthyUntil: row.unhealthy_until,
    };
  }
}

export class GatewayInputError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function gatewayActorFromAuth(auth: AuthContext): GatewayActor {
  return { userId: auth.user.id, organizationId: auth.user.organizationId, role: auth.user.summary.role };
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}
