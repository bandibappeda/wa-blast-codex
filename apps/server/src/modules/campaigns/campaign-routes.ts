import { campaignCreateRequestSchema, campaignSubmitRequestSchema, campaignUpdateRequestSchema } from "@wa-blast/contracts";
import type { Context, Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireCsrf, requireRole, requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import { CampaignInputError, CampaignService, campaignActorFromAuth } from "./campaign-service";

export function registerCampaignRoutes(app: Hono<AuthEnv>, dependencies: { service: CampaignService; auth: AuthService; config: AppConfig }): void {
  const { service, auth, config } = dependencies;
  const user = requireUser(auth, config);
  const csrf = requireCsrf(auth);

  app.get("/api/campaigns", user, (context) => context.json(service.listCampaigns(campaignActorFromAuth(context.get("auth")))));

  app.post("/api/campaigns", user, csrf, async (context) => {
    const parsed = campaignCreateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try { return context.json({ campaign: service.createDraft(parsed.data, campaignActorFromAuth(context.get("auth"))) }, 201); } catch (error) { return campaignError(context, error); }
  });

  app.patch("/api/campaigns/:campaignId", user, csrf, async (context) => {
    const parsed = campaignUpdateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try { return context.json({ campaign: service.updateDraft(context.req.param("campaignId"), parsed.data, campaignActorFromAuth(context.get("auth"))) }); } catch (error) { return campaignError(context, error); }
  });

  app.post("/api/campaigns/:campaignId/preview", user, csrf, async (context) => {
    try { return context.json(await service.previewDraft(context.req.param("campaignId"), campaignActorFromAuth(context.get("auth")))); } catch (error) { return campaignError(context, error); }
  });

  app.post("/api/campaigns/:campaignId/submit", user, csrf, async (context) => {
    const parsed = campaignSubmitRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    try { return context.json({ campaign: await service.submitForApproval(context.req.param("campaignId"), parsed.data.version, campaignActorFromAuth(context.get("auth"))) }); } catch (error) { return campaignError(context, error); }
  });

  app.post("/api/campaigns/:campaignId/cancel", user, csrf, requireRole("admin"), (context) => {
    try { return context.json({ campaign: service.cancelCampaign(context.req.param("campaignId"), campaignActorFromAuth(context.get("auth"))) }); } catch (error) { return campaignError(context, error); }
  });
}

async function readJson(context: Context<AuthEnv>): Promise<unknown> { try { return await context.req.json(); } catch { return null; } }

function campaignError(context: { json: (data: unknown, status?: number) => Response }, error: unknown): Response {
  if (!(error instanceof CampaignInputError)) throw error;
  const conflictCodes = new Set(["version_conflict", "campaign_not_editable"]);
  const notFoundCodes = new Set(["campaign_not_found", "gateway_not_found", "template_not_found", "contact_not_found"]);
  const status = conflictCodes.has(error.code) ? 409 : notFoundCodes.has(error.code) ? 404 : 422;
  return context.json({ error: error.code, ...(error.details ? { details: error.details } : {}) }, status);
}
