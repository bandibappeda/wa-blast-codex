import { userCreateRequestSchema, userResetPasswordRequestSchema, userUpdateRequestSchema } from "@wa-blast/contracts";
import type { Context, Hono } from "hono";
import type { AppConfig } from "../../config";
import { requireCsrf, requireRecentAuthentication, requireRole, requireUser, type AuthEnv } from "../auth/auth-middleware";
import type { AuthService } from "../auth/auth-service";
import { UserInputError, UserService, userActorFromAuth } from "./user-service";

export function registerUserRoutes(app: Hono<AuthEnv>, dependencies: { service: UserService; auth: AuthService; config: AppConfig }): void {
  const { service, auth, config } = dependencies;
  const user = requireUser(auth, config);
  const csrf = requireCsrf(auth);
  const admin = requireRole("admin");
  const recent = requireRecentAuthentication(auth, 10);

  app.get("/api/users", user, admin, (context) => context.json(service.listUsers(userActorFromAuth(context.get("auth")))));

  app.post("/api/users", user, csrf, admin, recent, async (context) => {
    const parsed = userCreateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try { return context.json(await service.createUser(parsed.data, userActorFromAuth(context.get("auth"))), 201); } catch (error) { return userError(context, error); }
  });

  app.patch("/api/users/:userId", user, csrf, admin, recent, async (context) => {
    const parsed = userUpdateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try { return context.json({ user: service.updateUser(context.req.param("userId"), parsed.data, userActorFromAuth(context.get("auth"))) }); } catch (error) { return userError(context, error); }
  });

  app.post("/api/users/:userId/reset-password", user, csrf, admin, recent, async (context) => {
    const parsed = userResetPasswordRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    try { return context.json(await service.resetPassword(context.req.param("userId"), userActorFromAuth(context.get("auth")))); } catch (error) { return userError(context, error); }
  });
}

async function readJson(context: Context<AuthEnv>): Promise<unknown> { try { return await context.req.json(); } catch { return null; } }

function userError(context: { json: (data: unknown, status?: number) => Response }, error: unknown): Response {
  if (!(error instanceof UserInputError)) throw error;
  const status = error.code === "forbidden" ? 403 : error.code === "user_not_found" ? 404 : error.code === "last_active_admin" ? 409 : 422;
  return context.json({ error: error.code }, status);
}
