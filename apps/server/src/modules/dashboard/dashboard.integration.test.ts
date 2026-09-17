import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { bootstrapAdmin, createAuthService } from "../auth/auth-service";
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

describe("dashboard API", () => {
  test("aggregates queue, approvals, active campaign progress, gateways, delivery, and failures", async () => {
    const context = createTestContext();
    const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
    const admin = await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Admin", password: "correct horse battery staple" });
    const now = context.clock.now().toISOString();
    const earlier = "2025-12-31T23:59:00.000Z";
    context.db.query("INSERT INTO gateway_connections (id, organization_id, name, adapter_type, sender_identity, encrypted_config, messages_per_minute, enabled, health_status, created_at, updated_at) VALUES ('gateway-healthy', ?, 'Healthy', 'mock', '628111111111', 'opaque', 60, 1, 'healthy', ?, ?), ('gateway-unhealthy', ?, 'Unhealthy', 'mock', '628222222222', 'opaque', 60, 1, 'unhealthy', ?, ?), ('gateway-unknown', ?, 'Unknown', 'mock', '628333333333', 'opaque', 60, 1, 'unknown', ?, ?)").run(admin.organizationId, now, now, admin.organizationId, now, now, admin.organizationId, now, now);
    context.db.query("INSERT INTO message_templates (id, organization_id, name, body, created_by_user_id, created_at, updated_at) VALUES ('template-dashboard', ?, 'Dashboard template', 'Hello', ?, ?, ?)").run(admin.organizationId, admin.id, now, now);
    context.db.query("INSERT INTO campaigns (id, organization_id, name, gateway_connection_id, template_id, state, audience_filter_json, version, created_by_user_id, created_at, updated_at) VALUES ('campaign-approval', ?, 'Needs approval', 'gateway-healthy', 'template-dashboard', 'pending_approval', '{}', 1, ?, ?, ?), ('campaign-active', ?, 'Active campaign', 'gateway-healthy', 'template-dashboard', 'queued', '{}', 1, ?, ?, ?)").run(admin.organizationId, admin.id, now, now, admin.organizationId, admin.id, now, now);
    context.db.query("INSERT INTO contacts (id, organization_id, phone_display, phone_e164, name, attributes_json, created_at, updated_at) VALUES ('contact-1', ?, '+628111111111', '+628111111111', 'One', '{}', ?, ?), ('contact-2', ?, '+628222222222', '+628222222222', 'Two', '{}', ?, ?), ('contact-3', ?, '+628333333333', '+628333333333', 'Three', '{}', ?, ?)").run(admin.organizationId, now, now, admin.organizationId, now, now, admin.organizationId, now, now);
    context.db.query("INSERT INTO campaign_recipients (id, campaign_id, contact_id, phone_e164, name, attributes_json, rendered_body, gateway_connection_id, created_at) VALUES ('recipient-1', 'campaign-active', 'contact-1', '+628111111111', 'One', '{}', 'Hello', 'gateway-healthy', ?), ('recipient-2', 'campaign-active', 'contact-2', '+628222222222', 'Two', '{}', 'Hello', 'gateway-healthy', ?), ('recipient-3', 'campaign-active', 'contact-3', '+628333333333', 'Three', '{}', 'Hello', 'gateway-healthy', ?)").run(now, now, now);
    context.db.query("INSERT INTO message_jobs (id, campaign_id, campaign_recipient_id, idempotency_key, status, attempt_count, available_at, last_error_message, created_at, updated_at) VALUES ('job-pending', 'campaign-active', 'recipient-1', 'key-pending', 'pending', 0, ?, NULL, ?, ?), ('job-delivered', 'campaign-active', 'recipient-2', 'key-delivered', 'delivered', 1, ?, NULL, ?, ?), ('job-failed', 'campaign-active', 'recipient-3', 'key-failed', 'failed', 3, ?, 'provider timeout', ?, ?)").run(earlier, earlier, earlier, now, now, now, now, now, now);
    const app = createApp({ db: context.db, clock: context.clock, ids: context.ids, config });

    try {
      const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "correct horse battery staple" }) });
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      const response = await app.request("/api/dashboard", { headers: { cookie } });
      expect(response.status).toBe(200);
      const body = await response.json() as { queue: { depth: number; oldestPendingAt: string | null }; approvals: { pending: number }; activeCampaigns: Array<{ id: string; total: number; delivered: number; failed: number }>; gateways: { total: number; healthy: number; unhealthy: number; unknown: number }; delivery: { total: number; delivered: number; failed: number }; recentFailures: Array<{ jobId: string; message: string }> };
      expect(body.queue.depth).toBe(1);
      expect(body.queue.oldestPendingAt).toBe(earlier);
      expect(body.approvals.pending).toBe(1);
      expect(body.activeCampaigns).toMatchObject([{ id: "campaign-active", total: 3, delivered: 1, failed: 1 }]);
      expect(body.gateways).toEqual({ total: 3, healthy: 1, unhealthy: 1, unknown: 1 });
      expect(body.delivery).toMatchObject({ total: 3, delivered: 1, failed: 1 });
      expect(body.recentFailures).toMatchObject([{ jobId: "job-failed", message: "provider timeout" }]);
    } finally { context.dispose(); }
  });
});
