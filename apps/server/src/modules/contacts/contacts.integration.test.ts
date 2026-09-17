import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { createAuthService, bootstrapAdmin } from "../auth/auth-service";
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

describe("contacts API", () => {
  test("normalizes consent, keeps suppression authoritative, and imports atomically", async () => {
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
        headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
        body: JSON.stringify({ email: "admin@example.com", password: "correct horse battery staple" }),
      });
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      const csrf = (await (await app.request("/api/auth/csrf", { headers: { cookie } })).json()).csrfToken as string;

      const created = await app.request("/api/contacts", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({ phone: "081234567890", name: "Ani", consentSource: "event-registration", consentAt: "2026-09-01T09:00:00+07:00", tags: ["vip"] }),
      });
      expect(created.status).toBe(201);
      const contact = await created.json() as { contact: { id: string; phoneE164: string } };
      expect(contact.contact.phoneE164).toBe("+6281234567890");

      const suppressed = await app.request(`/api/contacts/${contact.contact.id}/suppression`, {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({ reason: "manual opt-out" }),
      });
      expect(suppressed.status).toBe(204);

      const preview = await app.request("/api/contacts/import/preview", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({
          filename: "contacts.csv",
          content: [
            "phone,name,consent_source,consent_at",
            "081234567890,Ani Updated,event-registration,2026-09-01T09:00:00+07:00",
            "081298765432,Budi,event-registration,2026-09-02T09:00:00+07:00",
            "not-a-phone,Bad,event-registration,2026-09-02T09:00:00+07:00",
          ].join("\n"),
        }),
      });
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as { previewId: string; summary: { accepted: number; suppressed: number; invalid: number; duplicate: number } };
      expect(previewBody.summary).toEqual({ accepted: 1, suppressed: 1, invalid: 1, duplicate: 0 });

      const committed = await app.request(`/api/contacts/import/${previewBody.previewId}/commit`, {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf },
      });
      expect(committed.status).toBe(200);
      expect((await committed.json()).accepted).toBe(1);

      const listed = await app.request("/api/contacts?search=Budi", { headers: { cookie } });
      expect(listed.status).toBe(200);
      expect((await listed.json()).contacts).toHaveLength(1);
    } finally {
      context.dispose();
    }
  });
});
