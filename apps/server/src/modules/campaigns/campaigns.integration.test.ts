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

describe("campaign drafts API", () => {
  test("previews audience eligibility, tag selection, gateway health, UTC schedule, and optimistic versions", async () => {
    const context = createTestContext();
    const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
    await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Initial Admin", password: "correct horse battery staple" });
    const app = createApp({ db: context.db, clock: context.clock, ids: context.ids, config });

    try {
      let cookie = "";
      let csrf = "";
      const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "correct horse battery staple" }) });
      cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      csrf = await csrfFor(app, cookie);

      const eligible = await createContact(app, cookie, csrf, { phone: "081234567890", name: "Eligible", attributes: { city: "Jakarta" }, tags: ["pilot"] });
      const suppressed = await createContact(app, cookie, csrf, { phone: "081298765432", name: "Suppressed", attributes: { city: "Bandung" } });
      const missingVariable = await createContact(app, cookie, csrf, { phone: "081277788899", name: "Needs City" });
      const organization = context.db.query<{ id: string }, []>("SELECT id FROM organizations LIMIT 1").get();
      if (!organization) throw new Error("organization_missing");
      context.db.query("INSERT INTO contacts (id, organization_id, phone_display, phone_e164, name, attributes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("missing-consent", organization.id, "081266677788", "+6281266677788", "No Consent", JSON.stringify({ city: "Jakarta" }), context.clock.now().toISOString(), context.clock.now().toISOString());

      const suppression = await app.request(`/api/contacts/${suppressed}/suppression`, { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ reason: "opted out" }) });
      expect(suppression.status).toBe(204);

      const reauth = await app.request("/api/auth/reauthenticate", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery staple" }) });
      cookie = reauth.headers.get("set-cookie")?.split(";", 1)[0] ?? cookie;
      csrf = await csrfFor(app, cookie);
      const gatewayResponse = await app.request("/api/gateways", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name: "Primary", adapterType: "mock", senderIdentity: "628111111111", credentials: {}, messagesPerMinute: 60 }) });
      const gatewayId = ((await gatewayResponse.json()) as { gateway: { id: string } }).gateway.id;
      expect(gatewayResponse.status).toBe(201);
      expect((await app.request(`/api/gateways/${gatewayId}/health`, { method: "POST", headers: { cookie, "x-csrf-token": csrf } })).status).toBe(200);

      const template = await app.request("/api/templates", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name: "City offer", body: "Halo {{name}} dari {{city}}" }) });
      const templateId = ((await template.json()) as { template: { id: string } }).template.id;

      const draft = await app.request("/api/campaigns", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name: "September offer", gatewayId, templateId, scheduleAt: "2026-01-01T02:00:00.000Z", contactIds: [eligible, suppressed, missingVariable, "missing-consent"] }) });
      expect(draft.status).toBe(201);
      const draftBody = await draft.json() as { campaign: { id: string; version: number } };

      const preview = await app.request(`/api/campaigns/${draftBody.campaign.id}/preview`, { method: "POST", headers: { cookie, "x-csrf-token": csrf } });
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as { summary: Record<string, number>; scheduleAtUtc: string; gatewayWarning: string | null };
      expect(previewBody.summary).toEqual({ total: 4, eligible: 1, suppressed: 1, missingConsent: 1, missingVariables: 1, invalid: 0 });
      expect(previewBody.scheduleAtUtc).toBe("2026-01-01T02:00:00.000Z");
      expect(previewBody.gatewayWarning).toBeNull();

      const rejected = await app.request(`/api/campaigns/${draftBody.campaign.id}/submit`, { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 1 }) });
      expect(rejected.status).toBe(422);

      const updated = await app.request(`/api/campaigns/${draftBody.campaign.id}`, { method: "PATCH", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 1, name: "September offer revised" }) });
      expect(updated.status).toBe(200);
      expect((await updated.json()).campaign.version).toBe(2);
      const stale = await app.request(`/api/campaigns/${draftBody.campaign.id}`, { method: "PATCH", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: 1, name: "stale" }) });
      expect(stale.status).toBe(409);

      const taggedDraft = await app.request("/api/campaigns", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name: "Tagged offer", gatewayId, templateId, tagNames: ["pilot"] }) });
      const tagged = await taggedDraft.json() as { campaign: { id: string; version: number } };
      const submitted = await app.request(`/api/campaigns/${tagged.campaign.id}/submit`, { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ version: tagged.campaign.version }) });
      expect(submitted.status).toBe(200);
      expect((await submitted.json()).campaign.state).toBe("pending_approval");
    } finally {
      context.dispose();
    }
  });
});

async function csrfFor(app: ReturnType<typeof createApp>, cookie: string): Promise<string> {
  return ((await (await app.request("/api/auth/csrf", { headers: { cookie } })).json()) as { csrfToken: string }).csrfToken;
}

async function createContact(app: ReturnType<typeof createApp>, cookie: string, csrf: string, input: { phone: string; name: string; attributes?: Record<string, string>; tags?: string[] }): Promise<string> {
  const response = await app.request("/api/contacts", { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ ...input, consentSource: "event", consentAt: "2026-01-01T00:00:00.000Z" }) });
  const body = await response.json() as { contact: { id: string } };
  expect(response.status).toBe(201);
  return body.contact.id;
}
