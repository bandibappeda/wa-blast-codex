import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  attachmentMaxBytes: 1024 * 1024,
};

describe("templates API", () => {
  test("validates variables, stores one safe attachment, and enforces ownership/reference rules", async () => {
    const context = createTestContext();
    const uploadsPath = mkdtempSync(join(tmpdir(), "wa-blast-uploads-"));
    const app = await createAuthenticatedApp(context, { ...config, uploadsPath });

    try {
      const login = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "correct horse battery staple" }),
      });
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      const csrf = (await (await app.request("/api/auth/csrf", { headers: { cookie } })).json()).csrfToken as string;

      const form = new FormData();
      form.set("file", new File(["%PDF-1.7\nmock pdf"], "offer.pdf", { type: "application/pdf" }));
      const uploaded = await app.request("/api/templates/attachments", { method: "POST", headers: { cookie, "x-csrf-token": csrf }, body: form });
      expect(uploaded.status).toBe(201);
      const attachment = await uploaded.json() as { attachment: { id: string; mimeType: string } };
      expect(attachment.attachment.mimeType).toBe("application/pdf");
      expect("storageKey" in attachment.attachment).toBe(false);

      const created = await app.request("/api/templates", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({ name: "Offer", body: "Halo {{name}}, lihat penawaran.", attachmentId: attachment.attachment.id }),
      });
      expect(created.status).toBe(201);
      const template = await created.json() as { template: { id: string } };

      const preview = await app.request("/api/templates/preview", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({ body: "Halo {{name}}, {{order_id}}", attributes: { name: "Ani" } }),
      });
      expect(preview.status).toBe(200);
      expect((await preview.json()).missing).toEqual(["order_id"]);

      const downloaded = await app.request(`/api/templates/attachments/${attachment.attachment.id}`, { headers: { cookie } });
      expect(downloaded.status).toBe(200);
      expect(await downloaded.text()).toContain("%PDF-1.7");

      const reused = await app.request("/api/templates", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
        body: JSON.stringify({ name: "Offer copy", body: "Copy", attachmentId: attachment.attachment.id }),
      });
      expect(reused.status).toBe(409);

      const deleted = await app.request(`/api/templates/attachments/${attachment.attachment.id}`, { method: "DELETE", headers: { cookie, "x-csrf-token": csrf } });
      expect(deleted.status).toBe(409);

      const listed = await app.request("/api/templates", { headers: { cookie } });
      expect((await listed.json()).templates).toHaveLength(1);
      expect(template.template.id).toBeTruthy();
    } finally {
      context.dispose();
      rmSync(uploadsPath, { recursive: true, force: true });
    }
  });
});

async function createAuthenticatedApp(context: ReturnType<typeof createTestContext>, configWithUploads: typeof config & { uploadsPath: string }) {
  const auth = createAuthService({ db: context.db, clock: context.clock, ids: context.ids, config: configWithUploads });
  await bootstrapAdmin(auth, { email: "admin@example.com", displayName: "Initial Admin", password: "correct horse battery staple" });
  return createApp({ db: context.db, clock: context.clock, ids: context.ids, config: configWithUploads });
}
