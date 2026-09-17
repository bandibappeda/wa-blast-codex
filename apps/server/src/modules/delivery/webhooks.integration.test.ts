import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { bootstrapAdmin, createAuthService } from "../auth/auth-service";
import { CredentialVault } from "../gateways/credential-vault";
import { createTestContext } from "../../test/create-test-context";

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

describe("gateway webhooks", () => {
  test("authenticates, normalizes, deduplicates, and projects provider events", async () => {
    const context = createTestContext();
    const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
    const admin = await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Admin", password: "correct horse battery staple" });
    const vault = new CredentialVault(config.gatewayEncryptionKey);
    const now = context.clock.now().toISOString();
    const encrypted = await vault.encrypt({ webhookSecret: "hook-secret" });
    context.db.query("INSERT INTO gateway_connections (id, organization_id, name, adapter_type, sender_identity, encrypted_config, messages_per_minute, enabled, health_status, created_at, updated_at) VALUES ('gateway-hook', ?, 'Hook gateway', 'mock', '628111111111', ?, 60, 1, 'healthy', ?, ?)").run(admin.organizationId, encrypted, now, now);
    context.db.query("INSERT INTO contacts (id, organization_id, phone_display, phone_e164, name, attributes_json, created_at, updated_at) VALUES ('contact-hook', ?, '+6281234567890', '+6281234567890', 'Hook contact', '{}', ?, ?)").run(admin.organizationId, now, now);
    context.db.query("INSERT INTO message_templates (id, organization_id, name, body, created_by_user_id, created_at, updated_at) VALUES ('template-hook', ?, 'Hook template', 'Hello', ?, ?, ?)").run(admin.organizationId, admin.id, now, now);
    context.db.query("INSERT INTO campaigns (id, organization_id, name, gateway_connection_id, template_id, state, audience_filter_json, version, created_by_user_id, created_at, updated_at) VALUES ('campaign-hook', ?, 'Hook campaign', 'gateway-hook', 'template-hook', 'queued', '{}', 1, ?, ?, ?)").run(admin.organizationId, admin.id, now, now);
    context.db.query("INSERT INTO campaign_recipients (id, campaign_id, contact_id, phone_e164, name, attributes_json, rendered_body, gateway_connection_id, created_at) VALUES ('recipient-hook', 'campaign-hook', 'contact-hook', '+6281234567890', 'Hook contact', '{}', 'Hello', 'gateway-hook', ?)").run(now);
    context.db.query("INSERT INTO message_jobs (id, campaign_id, campaign_recipient_id, idempotency_key, status, provider_message_id, available_at, created_at, updated_at) VALUES ('job-hook', 'campaign-hook', 'recipient-hook', 'job-hook-key', 'sent', 'provider-1', ?, ?, ?)").run(now, now, now);
    const app = createApp({ db: context.db, clock: context.clock, ids: context.ids, config });

    try {
      const invalid = await app.request("/api/webhooks/gateways/gateway-hook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: "job-hook-key", status: "delivered" }) });
      expect(invalid.status).toBe(401);

      const headers = { "content-type": "application/json", "x-gateway-token": "hook-secret" };
      const delivered = await app.request("/api/webhooks/gateways/gateway-hook", { method: "POST", headers, body: JSON.stringify({ eventId: "evt-1", idempotencyKey: "job-hook-key", status: "delivered", providerMessageId: "provider-1", raw: { type: "message.delivered" } }) });
      expect(delivered.status).toBe(200);
      expect((await delivered.json()).accepted).toBe(1);
      expect(context.db.query<{ status: string }, [string]>("SELECT status FROM message_jobs WHERE id = ?").get("job-hook")).toEqual({ status: "delivered" });

      const duplicate = await app.request("/api/webhooks/gateways/gateway-hook", { method: "POST", headers, body: JSON.stringify({ eventId: "evt-1", idempotencyKey: "job-hook-key", status: "delivered", providerMessageId: "provider-1" }) });
      expect((await duplicate.json()).duplicate).toBe(1);
      expect(context.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM delivery_events WHERE message_job_id = ?").get("job-hook")?.count).toBe(1);

      const read = await app.request("/api/webhooks/gateways/gateway-hook", { method: "POST", headers, body: JSON.stringify({ idempotencyKey: "job-hook-key", status: "read", providerMessageId: "provider-1" }) });
      expect((await read.json()).accepted).toBe(1);
      expect(context.db.query<{ status: string }, [string]>("SELECT status FROM message_jobs WHERE id = ?").get("job-hook")).toEqual({ status: "read" });
      const fingerprintDuplicate = await app.request("/api/webhooks/gateways/gateway-hook", { method: "POST", headers, body: JSON.stringify({ idempotencyKey: "job-hook-key", status: "read", providerMessageId: "provider-1" }) });
      expect((await fingerprintDuplicate.json()).duplicate).toBe(1);

      const outOfOrder = await app.request("/api/webhooks/gateways/gateway-hook", { method: "POST", headers, body: JSON.stringify({ eventId: "evt-2", idempotencyKey: "job-hook-key", status: "sent", providerMessageId: "provider-1" }) });
      expect((await outOfOrder.json()).accepted).toBe(1);
      expect(context.db.query<{ status: string }, [string]>("SELECT status FROM message_jobs WHERE id = ?").get("job-hook")).toEqual({ status: "read" });

      const unknown = await app.request("/api/webhooks/gateways/gateway-hook", { method: "POST", headers, body: JSON.stringify({ eventId: "evt-3", idempotencyKey: "job-hook-key", status: "mystery", raw: { type: "unknown" } }) });
      expect((await unknown.json()).unknown).toBe(1);
      expect(context.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM delivery_events WHERE message_job_id = ?").get("job-hook")?.count).toBe(4);

      const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "correct horse battery staple" }) });
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      context.db.query("UPDATE campaign_recipients SET name = '=Hook contact' WHERE id = 'recipient-hook'").run();
      const results = await app.request("/api/campaigns/campaign-hook/delivery?status=read&search=hook", { headers: { cookie } });
      expect(results.status).toBe(200);
      const resultBody = await results.json() as { summary: { read: number }; pagination: { total: number }; recipients: Array<{ name: string }> };
      expect(resultBody.summary.read).toBe(1);
      expect(resultBody.pagination.total).toBe(1);
      expect(resultBody.recipients[0]?.name).toBe("=Hook contact");

      const csv = await app.request("/api/campaigns/campaign-hook/delivery.csv?search=hook", { headers: { cookie } });
      expect(csv.status).toBe(200);
      expect(csv.headers.get("content-type")).toContain("text/csv");
      const csvBody = await csv.text();
      expect(csvBody).toContain("'=Hook contact");
      expect(csvBody).not.toContain("Hello");

      const unauthenticatedResults = await app.request("/api/campaigns/campaign-hook/delivery");
      expect(unauthenticatedResults.status).toBe(401);
    } finally { context.dispose(); }
  });
});
