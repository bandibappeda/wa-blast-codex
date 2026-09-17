import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { bootstrapAdmin, createAuthService } from "./auth-service";
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
};

describe("authentication API", () => {
  test("logs in, resolves the session, enforces CSRF, and logs out", async () => {
    const context = createTestContext();
    const auth = createAuthService({
      db: context.db,
      clock: context.clock,
      ids: context.ids,
      config,
    });
    await bootstrapAdmin(auth, {
      email: "admin@example.com",
      displayName: "Initial Admin",
      password: "correct horse battery staple",
    });

    const app = createApp({
      db: context.db,
      clock: context.clock,
      ids: context.ids,
      config,
    });

    try {
      const login = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.1",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "correct horse battery staple",
        }),
      });

      expect(login.status).toBe(200);
      const setCookie = login.headers.get("set-cookie");
      expect(setCookie).toContain("session=");
      expect(await login.json()).toEqual({
        user: {
          email: "admin@example.com",
          displayName: "Initial Admin",
          role: "admin",
          mustChangePassword: false,
        },
      });

      const cookie = setCookie?.split(";", 1)[0] ?? "";
      const me = await app.request("/api/auth/me", {
        headers: { cookie },
      });
      expect(me.status).toBe(200);
      expect((await me.json()).user.email).toBe("admin@example.com");

      const csrf = await app.request("/api/auth/csrf", {
        headers: { cookie },
      });
      expect(csrf.status).toBe(200);
      const csrfToken = (await csrf.json()).csrfToken as string;

      const rejectedLogout = await app.request("/api/auth/logout", {
        method: "POST",
        headers: { cookie },
      });
      expect(rejectedLogout.status).toBe(403);

      const logout = await app.request("/api/auth/logout", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrfToken },
      });
      expect(logout.status).toBe(204);

      const expiredSession = await app.request("/api/auth/me", {
        headers: { cookie },
      });
      expect(expiredSession.status).toBe(401);
    } finally {
      context.dispose();
    }
  });
});
