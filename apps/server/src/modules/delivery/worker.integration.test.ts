import { describe, expect, test } from "bun:test";
import { createTestContext } from "../../test/create-test-context";
import { createAuthService, bootstrapAdmin } from "../auth/auth-service";
import { CredentialVault } from "../gateways/credential-vault";
import { GatewayRegistry } from "../gateways/gateway-registry";
import { GatewayService } from "../gateways/gateway-service";
import { MockGatewayAdapter } from "../gateways/mock-gateway-adapter";
import { DeliveryWorker } from "./worker";
import { JobRepository } from "./job-repository";

const config = {
  appEnv: "test",
  appOrigin: "http://localhost:5173",
  apiHost: "127.0.0.1",
  apiPort: 3000,
  databasePath: ":memory:",
  uploadsPath: "/tmp/wa-blast-test-uploads",
  defaultPhoneCountry: "ID",
  organizationTimeZone: "Asia/Jakarta",
  sessionTtlHours: 12,
  sessionCookieSecure: false,
  gatewayEncryptionKey: Buffer.from("01234567890123456789012345678901").toString("base64"),
};

describe("delivery worker", () => {
  test("claims atomically, sends once, and does not duplicate a completed job", async () => {
    const fixture = await createFixture();
    try {
      const first = await fixture.worker.tick();
      const second = await fixture.worker.tick();
      expect(first).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
      expect(second).toMatchObject({ claimed: 0, sent: 0, retried: 0, failed: 0 });
      expect(fixture.adapter.sentCount).toBe(1);
      const job = fixture.context.db.query<{ status: string; attempt_count: number; provider_message_id: string | null }, [string]>("SELECT status, attempt_count, provider_message_id FROM message_jobs WHERE id = ?").get(fixture.jobId);
      expect(job).toEqual({ status: "sent", attempt_count: 1, provider_message_id: "mock-1" });
      expect(fixture.context.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM delivery_attempts WHERE message_job_id = ?").get(fixture.jobId)?.count).toBe(1);
    } finally { fixture.context.dispose(); }
  });

  test("retries transient failures twice and terminally fails on the third attempt", async () => {
    const fixture = await createFixture();
    fixture.adapter.script(fixture.idempotencyKey, { kind: "transient_failure", code: "timeout", message: "timeout" });
    try {
      expect((await fixture.worker.tick()).retried).toBe(1);
      fixture.context.clock.advanceBy(30_000);
      expect((await fixture.worker.tick()).retried).toBe(1);
      fixture.context.clock.advanceBy(120_000);
      expect((await fixture.worker.tick()).failed).toBe(1);
      const job = fixture.context.db.query<{ status: string; attempt_count: number }, [string]>("SELECT status, attempt_count FROM message_jobs WHERE id = ?").get(fixture.jobId);
      expect(job).toEqual({ status: "failed", attempt_count: 3 });
      expect(fixture.context.db.query<{ health_status: string; consecutive_failures: number }, [string]>("SELECT health_status, consecutive_failures FROM gateway_connections WHERE id = ?").get("gateway-worker")).toEqual({ health_status: "unhealthy", consecutive_failures: 3 });
    } finally { fixture.context.dispose(); }
  });

  test("queues scheduled work only when due, persists pacing, and skips cancelled campaigns", async () => {
    const fixture = await createFixture();
    try {
      const future = new Date(contextNow(fixture) + 60_000).toISOString();
      fixture.context.db.query("UPDATE campaigns SET state = 'scheduled', schedule_at = ? WHERE id = ?").run(future, "campaign-worker");
      fixture.context.db.query("UPDATE message_jobs SET available_at = ? WHERE id = ?").run(future, fixture.jobId);
      expect((await fixture.worker.tick()).claimed).toBe(0);
      fixture.context.clock.advanceBy(60_000);
      expect((await fixture.worker.tick()).sent).toBe(1);

      await addSecondJob(fixture);
      expect((await fixture.worker.tick()).sent).toBe(0);
      expect(fixture.adapter.sentCount).toBe(1);
      fixture.context.clock.advanceBy(1_000);
      expect((await fixture.worker.tick()).sent).toBe(1);
      expect(fixture.adapter.sentCount).toBe(2);

      const cancelled = await createFixture();
      try {
        cancelled.context.db.query("UPDATE campaigns SET state = 'cancelled' WHERE id = ?").run("campaign-worker");
        expect((await cancelled.worker.tick()).claimed).toBe(0);
      } finally { cancelled.context.dispose(); }
    } finally { fixture.context.dispose(); }
  });

  test("allows one lease owner and releases its lease during shutdown", async () => {
    const fixture = await createFixture();
    try {
      const repository = new JobRepository({ db: fixture.context.db, clock: fixture.context.clock, ids: fixture.context.ids });
      expect(repository.claim("worker-test", fixture.context.clock.now(), 1, 60_000)).toHaveLength(1);
      expect(repository.claim("worker-b", fixture.context.clock.now(), 1, 60_000)).toHaveLength(0);
      fixture.worker.shutdown();
      const released = fixture.context.db.query<{ status: string; lease_owner: string | null }, [string]>("SELECT status, lease_owner FROM message_jobs WHERE id = ?").get(fixture.jobId);
      expect(released).toEqual({ status: "retry", lease_owner: null });
    } finally { fixture.context.dispose(); }
  });
});

async function createFixture() {
  const context = createTestContext();
  const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
  const admin = await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Admin", password: "correct horse battery staple" });
  const registry = new GatewayRegistry();
  const adapter = new MockGatewayAdapter();
  registry.register(adapter);
  const vault = new CredentialVault(config.gatewayEncryptionKey);
  const gatewayService = new GatewayService({ db: context.db, clock: context.clock, ids: context.ids, config, registry, vault });
  const gatewayId = "gateway-worker";
  const campaignId = "campaign-worker";
  const contactId = "contact-worker";
  const recipientId = "recipient-worker";
  const jobId = "job-worker";
  const idempotencyKey = `${campaignId}:${recipientId}`;
  const now = context.clock.now().toISOString();
  const encryptedConfig = await vault.encrypt({});
  context.db.query("INSERT INTO gateway_connections (id, organization_id, name, adapter_type, sender_identity, encrypted_config, messages_per_minute, enabled, health_status, created_at, updated_at) VALUES (?, ?, ?, 'mock', ?, ?, 60, 1, 'healthy', ?, ?)").run(gatewayId, admin.organizationId, "Worker gateway", "628111111111", encryptedConfig, now, now);
  context.db.query("INSERT INTO contacts (id, organization_id, phone_display, phone_e164, name, attributes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)").run(contactId, admin.organizationId, "+6281234567890", "+6281234567890", "Worker Contact", now, now);
  context.db.query("INSERT INTO message_templates (id, organization_id, name, body, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("template-worker", admin.organizationId, "Worker template", "Hello", admin.id, now, now);
  context.db.query("INSERT INTO campaigns (id, organization_id, name, gateway_connection_id, template_id, state, audience_filter_json, version, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', '{}', 1, ?, ?, ?)").run(campaignId, admin.organizationId, "Worker campaign", gatewayId, "template-worker", admin.id, now, now);
  context.db.query("INSERT INTO campaign_recipients (id, campaign_id, contact_id, phone_e164, name, attributes_json, rendered_body, gateway_connection_id, created_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)").run(recipientId, campaignId, contactId, "+6281234567890", "Worker Contact", "Hello", gatewayId, now);
  context.db.query("INSERT INTO message_jobs (id, campaign_id, campaign_recipient_id, idempotency_key, status, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)").run(jobId, campaignId, recipientId, idempotencyKey, now, now, now);
  return { context, worker: new DeliveryWorker({ db: context.db, clock: context.clock, ids: context.ids, gatewayService, workerId: "worker-test", batchSize: 10, leaseMs: 60_000, retryJitter: () => 0 }), adapter, jobId, idempotencyKey };
}

function contextNow(fixture: Awaited<ReturnType<typeof createFixture>>): number { return fixture.context.clock.now().getTime(); }

async function addSecondJob(fixture: Awaited<ReturnType<typeof createFixture>>): Promise<void> {
  const now = fixture.context.clock.now().toISOString();
  fixture.context.db.query("INSERT INTO contacts (id, organization_id, phone_display, phone_e164, name, attributes_json, created_at, updated_at) SELECT 'contact-worker-2', organization_id, '+6281234567891', '+6281234567891', 'Worker Contact Two', '{}', ?, ? FROM contacts WHERE id = 'contact-worker'").run(now, now);
  fixture.context.db.query("INSERT INTO campaign_recipients (id, campaign_id, contact_id, phone_e164, name, attributes_json, rendered_body, gateway_connection_id, created_at) VALUES ('recipient-worker-2', 'campaign-worker', 'contact-worker-2', '+6281234567891', 'Worker Contact Two', '{}', 'Hello', 'gateway-worker', ?)").run(now);
  fixture.context.db.query("INSERT INTO message_jobs (id, campaign_id, campaign_recipient_id, idempotency_key, status, available_at, created_at, updated_at) VALUES ('job-worker-2', 'campaign-worker', 'recipient-worker-2', 'campaign-worker:recipient-worker-2', 'pending', ?, ?, ?)").run(now, now, now);
}
