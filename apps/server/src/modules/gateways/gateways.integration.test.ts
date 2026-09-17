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

describe("gateways API", () => {
  test("requires recent authentication, masks credentials, and supports health/test sends", async () => {
    const context = createTestContext();
    const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
    await bootstrapAdmin(auth, {
      email: "admin@example.com",
      displayName: "Initial Admin",
      password: "correct horse battery staple",
    });
    const app = createApp({ db: context.db, clock: context.clock, ids: context.ids, config });

    try {
      const login = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "correct horse battery staple" }),
      });
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      const csrf = (await (await app.request("/api/auth/csrf", { headers: { cookie } })).json()).csrfToken as string;

      const recentRequired = await app.request("/api/gateways", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({ name: "Primary Mock", adapterType: "mock", senderIdentity: "628111111111", credentials: { token: "secret" }, messagesPerMinute: 60 }),
      });
      expect(recentRequired.status).toBe(403);

      const reauth = await app.request("/api/auth/reauthenticate", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({ password: "correct horse battery staple" }),
      });
      expect(reauth.status).toBe(200);
      const rotatedCookie = reauth.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      const rotatedCsrf = (await (await app.request("/api/auth/csrf", { headers: { cookie: rotatedCookie } })).json()).csrfToken as string;

      const created = await app.request("/api/gateways", {
        method: "POST",
        headers: { cookie: rotatedCookie, "x-csrf-token": rotatedCsrf, "content-type": "application/json" },
        body: JSON.stringify({ name: "Primary Mock", adapterType: "mock", senderIdentity: "628111111111", credentials: { token: "secret" }, messagesPerMinute: 60 }),
      });
      expect(created.status).toBe(201);
      const gateway = await created.json() as { gateway: { id: string; encryptedConfig?: string; credentials?: unknown; healthStatus: string } };
      expect(gateway.gateway.encryptedConfig).toBeUndefined();
      expect(gateway.gateway.credentials).toBeUndefined();
      expect(gateway.gateway.healthStatus).toBe("unknown");

      const listed = await app.request("/api/gateways", { headers: { cookie: rotatedCookie } });
      expect(listed.status).toBe(200);
      expect((await listed.json()).gateways).toHaveLength(1);

      const health = await app.request(`/api/gateways/${gateway.gateway.id}/health`, {
        method: "POST",
        headers: { cookie: rotatedCookie, "x-csrf-token": rotatedCsrf },
      });
      expect(health.status).toBe(200);
      expect((await health.json()).gateway.healthStatus).toBe("healthy");

      const send = await app.request(`/api/gateways/${gateway.gateway.id}/test`, {
        method: "POST",
        headers: { cookie: rotatedCookie, "x-csrf-token": rotatedCsrf, "content-type": "application/json" },
        body: JSON.stringify({ recipientPhone: "+6281234567890", body: "Test message" }),
      });
      expect(send.status).toBe(200);
      expect((await send.json()).result.kind).toBe("sent");

      const auditCount = context.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM audit_entries WHERE action LIKE 'gateway.%'").get()?.count;
      expect(auditCount).toBeGreaterThanOrEqual(3);
    } finally {
      context.dispose();
    }
  });
});
