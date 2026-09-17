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

describe("campaign approval API", () => {
  test("requires admin reauthentication, freezes eligible recipients, creates jobs once, and protects claimed jobs on reopen", async () => {
    const context = createTestContext();
    const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
    await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Initial Admin", password: "correct horse battery staple" });
    const app = createApp({ db: context.db, clock: context.clock, ids: context.ids, config });

    try {
      let adminCookie = await login(app, "admin@example.com", "correct horse battery staple");
      let csrf = await csrfFor(app, adminCookie);
      const first = await createContact(app, adminCookie, csrf, "081234567890", "Eligible One");
      const second = await createContact(app, adminCookie, csrf, "081298765432", "Will Opt Out");
      const reauth = await app.request("/api/auth/reauthenticate", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery staple" }) });
      adminCookie = reauth.headers.get("set-cookie")?.split(";", 1)[0] ?? adminCookie;
      csrf = await csrfFor(app, adminCookie);
      const gateway = await app.request("/api/gateways", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name: "Approval Mock", adapterType: "mock", senderIdentity: "628111111111", credentials: {}, messagesPerMinute: 60 }) });
      const gatewayId = (await gateway.json() as { gateway: { id: string } }).gateway.id;
      await app.request(`/api/gateways/${gatewayId}/health`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf } });
      const template = await app.request("/api/templates", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name: "Approval template", body: "Halo {{name}}" }) });
      const templateId = (await template.json() as { template: { id: string } }).template.id;
      const draft = await createCampaign(app, adminCookie, csrf, "Needs approval", gatewayId, templateId, [first, second], null);
      const submitted = await app.request(`/api/campaigns/${draft}/submit`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 1 }) });
      expect(submitted.status).toBe(200);

      await createOperator(context);
      const operatorCookie = await login(app, "operator@example.com", "operator password");
      const operatorCsrf = await csrfFor(app, operatorCookie);
      const operatorApproval = await app.request(`/api/campaigns/${draft}/approve`, { method: "POST", headers: { cookie: operatorCookie, "x-csrf-token": operatorCsrf, "content-type": "application/json" }, body: JSON.stringify({ version: 2 }) });
      expect(operatorApproval.status).toBe(403);

      const suppression = await app.request(`/api/contacts/${second}/suppression`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ reason: "opted out before approval" }) });
      expect(suppression.status).toBe(204);
      context.clock.advanceBy(11 * 60 * 1000);
      const staleApproval = await app.request(`/api/campaigns/${draft}/approve`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 2 }) });
      expect(staleApproval.status).toBe(403);
      expect((await staleApproval.json()).error).toBe("reauthentication_required");

      const freshReauth = await app.request("/api/auth/reauthenticate", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery staple" }) });
      adminCookie = freshReauth.headers.get("set-cookie")?.split(";", 1)[0] ?? adminCookie;
      csrf = await csrfFor(app, adminCookie);
      const approved = await app.request(`/api/campaigns/${draft}/approve`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 2 }) });
      expect(approved.status).toBe(200);
      const approvedBody = await approved.json() as { campaign: { state: string; version: number }; approval: { jobsCreated: number; excluded: number } };
      expect(approvedBody.campaign.state).toBe("queued");
      expect(approvedBody.approval).toEqual({ jobsCreated: 1, excluded: 1 });
      expect(context.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM campaign_recipients WHERE campaign_id = ?").get(draft)?.count).toBe(1);
      expect(context.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM message_jobs WHERE campaign_id = ?").get(draft)?.count).toBe(1);

      context.db.query("UPDATE contacts SET name = ? WHERE id = ?").run("Changed After Approval", first);
      context.db.query("UPDATE message_templates SET body = ? WHERE id = ?").run("Changed {{name}}", templateId);
      const snapshot = context.db.query<{ name: string; rendered_body: string }, [string]>("SELECT name, rendered_body FROM campaign_recipients WHERE campaign_id = ?").get(draft);
      expect(snapshot).toEqual({ name: "Eligible One", rendered_body: "Halo Eligible One" });

      const repeated = await app.request(`/api/campaigns/${draft}/approve`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: approvedBody.campaign.version }) });
      expect(repeated.status).toBe(409);
      const reopened = await app.request(`/api/campaigns/${draft}/reopen`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf } });
      expect(reopened.status).toBe(200);
      expect((await reopened.json()).campaign.state).toBe("draft");
      expect(context.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM message_jobs WHERE campaign_id = ?").get(draft)?.count).toBe(0);

      const scheduled = await createCampaign(app, adminCookie, csrf, "Scheduled approval", gatewayId, templateId, [first], "2026-01-02T00:00:00.000Z");
      await app.request(`/api/campaigns/${scheduled}/submit`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 1 }) });
      const scheduledApproval = await app.request(`/api/campaigns/${scheduled}/approve`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 2 }) });
      expect(scheduledApproval.status).toBe(200);
      context.db.query("UPDATE message_jobs SET status = 'leased', lease_owner = 'worker-1' WHERE campaign_id = ?").run(scheduled);
      const blockedReopen = await app.request(`/api/campaigns/${scheduled}/reopen`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf } });
      expect(blockedReopen.status).toBe(409);
    } finally {
      context.dispose();
    }
  });
});

async function login(app: ReturnType<typeof createApp>, email: string, password: string): Promise<string> {
  const response = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function csrfFor(app: ReturnType<typeof createApp>, cookie: string): Promise<string> {
  return ((await (await app.request("/api/auth/csrf", { headers: { cookie } })).json()) as { csrfToken: string }).csrfToken;
}

async function createContact(app: ReturnType<typeof createApp>, cookie: string, csrf: string, phone: string, name: string): Promise<string> {
  const response = await app.request("/api/contacts", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ phone, name, consentSource: "event", consentAt: "2026-01-01T00:00:00.000Z" }) });
  expect(response.status).toBe(201);
  return (await response.json() as { contact: { id: string } }).contact.id;
}

async function createCampaign(app: ReturnType<typeof createApp>, cookie: string, csrf: string, name: string, gatewayId: string, templateId: string, contactIds: string[], scheduleAt: string | null): Promise<string> {
  const response = await app.request("/api/campaigns", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name, gatewayId, templateId, contactIds, ...(scheduleAt === null ? {} : { scheduleAt }) }) });
  expect(response.status).toBe(201);
  return (await response.json() as { campaign: { id: string } }).campaign.id;
}

async function createOperator(context: ReturnType<typeof createTestContext>): Promise<void> {
  const organization = context.db.query<{ id: string }, []>("SELECT id FROM organizations LIMIT 1").get();
  if (!organization) throw new Error("organization_missing");
  const passwordHash = await Bun.password.hash("operator password", { algorithm: "argon2id" });
  context.db.query("INSERT INTO users (id, organization_id, email, display_name, role, password_hash, must_change_password, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'operator', ?, 0, 'active', ?, ?)").run("operator-1", organization.id, "operator@example.com", "Operator", passwordHash, context.clock.now().toISOString(), context.clock.now().toISOString());
}
