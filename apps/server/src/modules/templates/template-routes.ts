import { templateCreateRequestSchema, templatePreviewRequestSchema, templateUpdateRequestSchema } from "@wa-blast/contracts";
import type { Context, Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireCsrf, requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import { AttachmentValidationError } from "./attachment-store";
import { TemplateInputError, TemplateService, templateActorFromAuth } from "./template-service";

export function registerTemplateRoutes(app: Hono<AuthEnv>, dependencies: { service: TemplateService; auth: AuthService; config: AppConfig }): void {
  const { service, auth, config } = dependencies;
  const user = requireUser(auth, config);
  const csrf = requireCsrf(auth);

  app.get("/api/templates", user, (context) => context.json(service.listTemplates(templateActorFromAuth(context.get("auth")))));

  app.post("/api/templates/preview", user, csrf, async (context) => {
    const parsed = templatePreviewRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    try { return context.json(service.preview(parsed.data.body, parsed.data.attributes)); } catch (error) { return templateError(context, error); }
  });

  app.post("/api/templates", user, csrf, async (context) => {
    const parsed = templateCreateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try { return context.json({ template: service.createTemplate(parsed.data, templateActorFromAuth(context.get("auth"))) }, 201); } catch (error) { return templateError(context, error); }
  });

  app.patch("/api/templates/:templateId", user, csrf, async (context) => {
    const parsed = templateUpdateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try { return context.json({ template: service.updateTemplate(context.req.param("templateId"), parsed.data, templateActorFromAuth(context.get("auth"))) }); } catch (error) { return templateError(context, error); }
  });

  app.post("/api/templates/attachments", user, csrf, async (context) => {
    const body = await context.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return context.json({ error: "attachment_required" }, 400);
    try { return context.json({ attachment: await service.uploadAttachment(file, templateActorFromAuth(context.get("auth"))) }, 201); } catch (error) { return templateError(context, error); }
  });

  app.get("/api/templates/attachments/:attachmentId", user, async (context) => {
    try {
      const result = await service.downloadAttachment(context.req.param("attachmentId"), templateActorFromAuth(context.get("auth")));
      return context.body(await result.blob.arrayBuffer(), 200, { "Content-Type": result.attachment.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.attachment.originalName)}` });
    } catch (error) { return templateError(context, error); }
  });

  app.delete("/api/templates/attachments/:attachmentId", user, csrf, async (context) => {
    try { await service.deleteAttachment(context.req.param("attachmentId"), templateActorFromAuth(context.get("auth"))); return context.body(null, 204); } catch (error) { return templateError(context, error); }
  });
}

async function readJson(context: Context<AuthEnv>): Promise<unknown> { try { return await context.req.json(); } catch { return null; } }

function templateError(context: { json: (data: unknown, status?: number) => Response }, error: unknown): Response {
  if (error instanceof AttachmentValidationError) return context.json({ error: error.code }, error.code === "attachment_required" ? 400 : 422);
  if (!(error instanceof TemplateInputError)) throw error;
  const status = error.code.endsWith("not_found") ? 404 : error.code === "attachment_in_use" ? 409 : 422;
  return context.json({ error: error.code }, status);
}
