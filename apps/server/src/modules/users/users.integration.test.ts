import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { bootstrapAdmin, createAuthService } from "../auth/auth-service";
import { AuditService } from "../audit/audit-service";
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

describe("users and audit API", () => {
  test("creates temporary-password users, protects the final admin, invalidates sessions, and redacts audit details", async () => {
    const context = createTestContext();
    const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
    const admin = await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Admin", password: "correct horse battery staple" });
    const app = createApp({ db: context.db, clock: context.clock, ids: context.ids, config });

    try {
      let adminCookie = await login(app, "admin@example.com", "correct horse battery staple");
      let csrf = await csrfFor(app, adminCookie);
      const reauth = await app.request("/api/auth/reauthenticate", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery staple" }) });
      adminCookie = reauth.headers.get("set-cookie")?.split(";", 1)[0] ?? adminCookie;
      csrf = await csrfFor(app, adminCookie);

      const created = await app.request("/api/users", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ email: "operator@example.com", displayName: "Operator", role: "operator" }) });
      expect(created.status).toBe(201);
      const createdBody = await created.json() as { user: { id: string; mustChangePassword: boolean }; temporaryPassword: string };
      expect(createdBody.user.mustChangePassword).toBe(true);
      expect(createdBody.temporaryPassword.length).toBeGreaterThanOrEqual(12);
      const storedAudit = context.db.query<{ details_json: string }, []>("SELECT details_json FROM audit_entries WHERE action = 'user.created'").get();
      expect(storedAudit?.details_json).not.toContain(createdBody.temporaryPassword);

      const operatorCookie = await login(app, "operator@example.com", createdBody.temporaryPassword);
      const operatorMe = await app.request("/api/auth/me", { headers: { cookie: operatorCookie } });
      expect(operatorMe.status).toBe(200);
      expect((await operatorMe.json()).user.mustChangePassword).toBe(true);
      const operatorCsrf = await csrfFor(app, operatorCookie);
      const changed = await app.request("/api/auth/change-password", { method: "POST", headers: { cookie: operatorCookie, "x-csrf-token": operatorCsrf, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: createdBody.temporaryPassword, newPassword: "operator-secure-password" }) });
      expect(changed.status).toBe(200);

      const finalAdminDisable = await app.request(`/api/users/${admin.id}`, { method: "PATCH", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ status: "disabled" }) });
      expect(finalAdminDisable.status).toBe(409);

      const secondAdmin = await app.request("/api/users", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ email: "second-admin@example.com", displayName: "Second Admin", role: "admin" }) });
      expect(secondAdmin.status).toBe(201);
      const secondAdminBody = await secondAdmin.json() as { user: { id: string }; temporaryPassword: string };
      const disabled = await app.request(`/api/users/${createdBody.user.id}`, { method: "PATCH", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ status: "disabled" }) });
      expect(disabled.status).toBe(200);
      expect((await app.request("/api/auth/me", { headers: { cookie: operatorCookie } })).status).toBe(401);

      const finalAdmin = await app.request(`/api/users/${admin.id}`, { method: "PATCH", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ status: "disabled" }) });
      expect(finalAdmin.status).toBe(200);
      let secondAdminCookie = await login(app, "second-admin@example.com", secondAdminBody.temporaryPassword);
      let secondAdminCsrf = await csrfFor(app, secondAdminCookie);
      const secondAdminPassword = await app.request("/api/auth/change-password", { method: "POST", headers: { cookie: secondAdminCookie, "x-csrf-token": secondAdminCsrf, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: secondAdminBody.temporaryPassword, newPassword: "second-admin-secure-password" }) });
      expect(secondAdminPassword.status).toBe(200);
      secondAdminCookie = secondAdminPassword.headers.get("set-cookie")?.split(";", 1)[0] ?? secondAdminCookie;
      secondAdminCsrf = await csrfFor(app, secondAdminCookie);
      const reauthenticatedSecondAdmin = await app.request("/api/auth/reauthenticate", { method: "POST", headers: { cookie: secondAdminCookie, "x-csrf-token": secondAdminCsrf, "content-type": "application/json" }, body: JSON.stringify({ password: "second-admin-secure-password" }) });
      const finalAdminCookie = reauthenticatedSecondAdmin.headers.get("set-cookie")?.split(";", 1)[0] ?? secondAdminCookie;
      const finalAdminCsrf = await csrfFor(app, finalAdminCookie);

      const audit = new AuditService({ db: context.db, clock: context.clock, ids: context.ids });
      audit.record({ organizationId: admin.organizationId, actorUserId: secondAdminBody.user.id, action: "security.test", subjectType: "session", subjectId: "session-1", details: { password: "secret-password", encrypted_config: "ciphertext", nested: { sessionToken: "secret-token" } } });
      const filteredAudit = await app.request(`/api/audit?actorId=${encodeURIComponent(admin.id)}&action=user.created&subjectType=user&from=2025-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z`, { headers: { cookie: finalAdminCookie } });
      expect(filteredAudit.status).toBe(200);
      expect((await filteredAudit.json()).entries.length).toBeGreaterThan(0);
      const securityAudit = await app.request("/api/audit?action=security.test", { headers: { cookie: finalAdminCookie } });
      const securityBody = await securityAudit.json() as { entries: Array<{ details: Record<string, unknown> }> };
      expect(securityBody.entries[0]?.details).toEqual({ password: "[REDACTED]", encrypted_config: "[REDACTED]", nested: { sessionToken: "[REDACTED]" } });

      const lastAdminDisable = await app.request(`/api/users/${secondAdminBody.user.id}`, { method: "PATCH", headers: { cookie: finalAdminCookie, "x-csrf-token": finalAdminCsrf, "content-type": "application/json" }, body: JSON.stringify({ status: "disabled" }) });
      expect(lastAdminDisable.status).toBe(409);

      expect((await app.request("/api/users", { headers: { cookie: operatorCookie } })).status).toBe(401);
    } finally { context.dispose(); }
  });

  test("allows an operator to view dashboard but not users or audit history", async () => {
    const context = createTestContext();
    const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config });
    await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Admin", password: "correct horse battery staple" });
    const app = createApp({ db: context.db, clock: context.clock, ids: context.ids, config });
    try {
      let adminCookie = await login(app, "admin@example.com", "correct horse battery staple");
      let csrf = await csrfFor(app, adminCookie);
      const reauth = await app.request("/api/auth/reauthenticate", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery staple" }) });
      adminCookie = reauth.headers.get("set-cookie")?.split(";", 1)[0] ?? adminCookie;
      csrf = await csrfFor(app, adminCookie);
      const created = await app.request("/api/users", { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ email: "operator@example.com", displayName: "Operator", role: "operator" }) });
      const body = await created.json() as { temporaryPassword: string };
      let operatorCookie = await login(app, "operator@example.com", body.temporaryPassword);
      const operatorCsrf = await csrfFor(app, operatorCookie);
      const changed = await app.request("/api/auth/change-password", { method: "POST", headers: { cookie: operatorCookie, "x-csrf-token": operatorCsrf, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: body.temporaryPassword, newPassword: "operator-secure-password" }) });
      operatorCookie = changed.headers.get("set-cookie")?.split(";", 1)[0] ?? operatorCookie;
      expect((await app.request("/api/dashboard", { headers: { cookie: operatorCookie } })).status).toBe(200);
      expect((await app.request("/api/users", { headers: { cookie: operatorCookie } })).status).toBe(403);
      expect((await app.request("/api/audit", { headers: { cookie: operatorCookie } })).status).toBe(403);
    } finally { context.dispose(); }
  });
});

async function login(app: ReturnType<typeof createApp>, email: string, password: string): Promise<string> {
  const response = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function csrfFor(app: ReturnType<typeof createApp>, cookie: string): Promise<string> {
  const response = await app.request("/api/auth/csrf", { headers: { cookie } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}
