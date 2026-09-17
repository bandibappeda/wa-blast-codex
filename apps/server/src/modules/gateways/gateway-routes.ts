import { gatewayCreateRequestSchema, gatewayTestMessageRequestSchema, gatewayUpdateRequestSchema } from "@wa-blast/contracts";
import type { Context, Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireCsrf, requireRecentAuthentication, requireRole, requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import { GatewayInputError, GatewayService, gatewayActorFromAuth } from "./gateway-service";

export function registerGatewayRoutes(app: Hono<AuthEnv>, dependencies: { service: GatewayService; auth: AuthService; config: AppConfig }): void {
  const { service, auth, config } = dependencies;
  const user = requireUser(auth, config);
  const csrf = requireCsrf(auth);
  const admin = requireRole("admin");
  const recent = requireRecentAuthentication(auth, 10);

  app.get("/api/gateways", user, (context) => context.json(service.listConnections(gatewayActorFromAuth(context.get("auth")))));

  app.post("/api/gateways", user, csrf, admin, recent, async (context) => {
    const parsed = gatewayCreateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try {
      return context.json({ gateway: await service.createConnection(parsed.data, gatewayActorFromAuth(context.get("auth"))) }, 201);
    } catch (error) {
      return gatewayError(context, error);
    }
  });

  app.patch("/api/gateways/:gatewayId", user, csrf, admin, recent, async (context) => {
    const parsed = gatewayUpdateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try {
      return context.json({ gateway: await service.updateConnection(context.req.param("gatewayId"), parsed.data, gatewayActorFromAuth(context.get("auth"))) });
    } catch (error) {
      return gatewayError(context, error);
    }
  });

  app.post("/api/gateways/:gatewayId/health", user, csrf, admin, recent, async (context) => {
    try {
      return context.json(await service.checkHealth(context.req.param("gatewayId"), gatewayActorFromAuth(context.get("auth"))));
    } catch (error) {
      return gatewayError(context, error);
    }
  });

  app.post("/api/gateways/:gatewayId/test", user, csrf, admin, recent, async (context) => {
    const parsed = gatewayTestMessageRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try {
      const result = await service.sendTestMessage(context.req.param("gatewayId"), parsed.data.recipientPhone, parsed.data.body, gatewayActorFromAuth(context.get("auth")));
      return context.json({ result });
    } catch (error) {
      return gatewayError(context, error);
    }
  });
}

async function readJson(context: Context<AuthEnv>): Promise<unknown> {
  try { return await context.req.json(); } catch { return null; }
}

function gatewayError(context: { json: (data: unknown, status?: number) => Response }, error: unknown): Response {
  if (!(error instanceof GatewayInputError)) throw error;
  const status = error.code === "gateway_not_found" ? 404 : error.code === "gateway_disabled" ? 409 : 422;
  return context.json({ error: error.code }, status);
}
