import { auditQuerySchema } from "@wa-blast/contracts";
import type { Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireRole, requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import { AuditService } from "./audit-service";

export function registerAuditRoutes(app: Hono<AuthEnv>, dependencies: { service: AuditService; auth: AuthService; config: AppConfig }): void {
  const user = requireUser(dependencies.auth, dependencies.config);
  app.get("/api/audit", user, requireRole("admin"), (context) => {
    const parsed = auditQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    return context.json(dependencies.service.listEntries({ organizationId: context.get("auth").user.organizationId, query: parsed.data }));
  });
}
