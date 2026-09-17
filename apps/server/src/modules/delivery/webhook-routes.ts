import { deliveryResultsQuerySchema, gatewayWebhookRequestSchema } from "@wa-blast/contracts";
import type { Context, Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import type { GatewayWebhookRequest } from "../gateways/gateway-adapter";
import { WebhookAuthError, WebhookInputError, WebhookService } from "./webhook-service";

export function registerWebhookRoutes(app: Hono<AuthEnv>, dependencies: { service: WebhookService; auth: AuthService; config: AppConfig }): void {
  const { service, auth, config } = dependencies;
  const user = requireUser(auth, config);

  app.post("/api/webhooks/gateways/:gatewayId", async (context) => {
    const parsed = gatewayWebhookRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const token = context.req.header("X-Gateway-Token") ?? bearerToken(context.req.header("Authorization"));
    const request: GatewayWebhookRequest = {
      idempotencyKey: parsed.data.idempotencyKey,
      status: parsed.data.status,
      ...(parsed.data.eventId === undefined ? {} : { eventId: parsed.data.eventId }),
      ...(parsed.data.providerMessageId === undefined ? {} : { providerMessageId: parsed.data.providerMessageId }),
      ...(parsed.data.raw === undefined ? {} : { raw: parsed.data.raw }),
    };
    try {
      return context.json(await service.processWebhook(context.req.param("gatewayId"), token, request));
    } catch (error) {
      return webhookError(context, error);
    }
  });

  app.get("/api/campaigns/:campaignId/delivery", user, (context) => {
    const query = deliveryResultsQuerySchema.safeParse(context.req.query());
    if (!query.success) return context.json({ error: "invalid_request", issues: query.error.issues }, 400);
    try {
      return context.json(service.getDeliveryResults(context.req.param("campaignId"), context.get("auth"), query.data));
    } catch (error) {
      return webhookError(context, error);
    }
  });

  app.get("/api/campaigns/:campaignId/delivery.csv", user, (context) => {
    const query = deliveryResultsQuerySchema.safeParse(context.req.query());
    if (!query.success) return context.json({ error: "invalid_request", issues: query.error.issues }, 400);
    try {
      const csv = service.getDeliveryCsv(context.req.param("campaignId"), context.get("auth"), query.data);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=campaign-delivery.csv",
        },
      });
    } catch (error) {
      return webhookError(context, error);
    }
  });
}

async function readJson(context: Context<AuthEnv>): Promise<unknown> {
  try { return await context.req.json(); } catch { return null; }
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function webhookError(context: { json: (data: unknown, status?: number) => Response }, error: unknown): Response {
  if (error instanceof WebhookAuthError) return context.json({ error: "invalid_webhook_auth" }, 401);
  if (error instanceof WebhookInputError) return context.json({ error: error.code }, error.code.endsWith("not_found") ? 404 : 422);
  throw error;
}
