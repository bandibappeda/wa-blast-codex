import type { MiddlewareHandler } from "hono";
import type { AppConfig } from "../../config";
import { readSessionCookie } from "./session-cookie";
import type { AuthContext, AuthService } from "./auth-service";
import type { UserRole } from "@wa-blast/contracts";

export type AuthEnv = {
  Variables: {
    auth: AuthContext;
  };
};

export function requireUser(
  auth: AuthService,
  config: AppConfig,
  options: { skipPathPrefix?: string } = {},
): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    if (options.skipPathPrefix && context.req.path.startsWith(options.skipPathPrefix)) {
      await next();
      return;
    }
    const session = await auth.resolveSession(readSessionCookie(context, config));
    if (!session) return context.json({ error: "unauthorized" }, 401);
    context.set("auth", session);
    await next();
  };
}

export function requireRole(
  role: UserRole,
): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    if (context.get("auth").user.summary.role !== role) {
      return context.json({ error: "forbidden" }, 403);
    }
    await next();
  };
}

export function requireCsrf(auth: AuthService): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    const valid = await auth.verifyCsrf(
      context.get("auth"),
      context.req.header("X-CSRF-Token"),
    );
    if (!valid) return context.json({ error: "csrf_required" }, 403);
    await next();
  };
}

export function requireRecentAuthentication(
  auth: AuthService,
  maxAgeMinutes: number,
): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    if (!(await auth.hasRecentAuthentication(context.get("auth"), maxAgeMinutes))) {
      return context.json({ error: "reauthentication_required" }, 403);
    }
    await next();
  };
}

export function requirePasswordChangeComplete(): MiddlewareHandler<AuthEnv> {
  return async (context, next) => {
    const auth = context.get("auth");
    if (auth?.user.summary.mustChangePassword) {
      return context.json({ error: "password_change_required" }, 403);
    }
    await next();
  };
}
