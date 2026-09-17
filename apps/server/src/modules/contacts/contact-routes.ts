import { contactCreateRequestSchema, contactImportPreviewRequestSchema, suppressionRequestSchema } from "@wa-blast/contracts";
import type { Context, Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireCsrf, requireRole, requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import { ContactInputError, ContactService, actorFromAuth } from "./contact-service";

export function registerContactRoutes(app: Hono<AuthEnv>, dependencies: { service: ContactService; auth: AuthService; config: AppConfig }): void {
  const { service, auth, config } = dependencies;
  const user = requireUser(auth, config);
  const csrf = requireCsrf(auth);
  const json = async (context: Context<AuthEnv>): Promise<unknown> => {
    try { return await context.req.json(); } catch { return null; }
  };

  app.get("/api/contacts", user, (context) => {
    const search = context.req.query("search");
    const result = service.listContacts(actorFromAuth(context.get("auth")), { ...(search ? { search } : {}), limit: Number(context.req.query("limit") ?? 50) });
    return context.json(result);
  });

  app.post("/api/contacts", user, csrf, async (context) => {
    const parsed = contactCreateRequestSchema.safeParse(await json(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try { return context.json({ contact: service.createContact(parsed.data, actorFromAuth(context.get("auth"))) }, 201); } catch (error) { return contactError(context, error); }
  });

  app.post("/api/contacts/import/preview", user, csrf, async (context) => {
    const parsed = contactImportPreviewRequestSchema.safeParse(await json(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    try { return context.json(service.previewContactImport(parsed.data, actorFromAuth(context.get("auth")))); } catch (error) { return contactError(context, error); }
  });

  app.post("/api/contacts/import/:previewId/commit", user, csrf, (context) => {
    try { return context.json(service.commitContactImport(context.req.param("previewId"), actorFromAuth(context.get("auth")))); } catch (error) { return contactError(context, error); }
  });

  app.post("/api/contacts/:contactId/suppression", user, csrf, requireRole("admin"), async (context) => {
    const parsed = suppressionRequestSchema.safeParse(await json(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    try { service.suppressContact(context.req.param("contactId"), parsed.data.reason, actorFromAuth(context.get("auth"))); return context.body(null, 204); } catch (error) { return contactError(context, error); }
  });

  app.post("/api/contacts/:contactId/suppression/lift", user, csrf, requireRole("admin"), async (context) => {
    const parsed = suppressionRequestSchema.safeParse(await json(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    try { service.liftSuppression(context.req.param("contactId"), parsed.data.reason, actorFromAuth(context.get("auth"))); return context.body(null, 204); } catch (error) { return contactError(context, error); }
  });
}

function contactError(context: { json: (data: unknown, status?: number) => Response }, error: unknown): Response {
  if (!(error instanceof ContactInputError)) throw error;
  const status = error.code === "forbidden" ? 403 : error.code.endsWith("not_found") ? 404 : 422;
  return context.json({ error: error.code }, status);
}
