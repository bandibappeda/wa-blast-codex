import type { Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import { DashboardService } from "./dashboard-service";

export function registerDashboardRoutes(app: Hono<AuthEnv>, dependencies: { service: DashboardService; auth: AuthService; config: AppConfig }): void {
  const user = requireUser(dependencies.auth, dependencies.config);
  app.get("/api/dashboard", user, (context) => context.json(dependencies.service.getOverview(context.get("auth").user.organizationId)));
}
