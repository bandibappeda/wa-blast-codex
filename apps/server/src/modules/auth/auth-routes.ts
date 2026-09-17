import {
  changePasswordRequestSchema,
  csrfResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  reauthenticateRequestSchema,
} from "@wa-blast/contracts";
import type { Context, Hono } from "hono";
import type { AppConfig } from "../../config";
import {
  requireCsrf,
  requirePasswordChangeComplete,
  requireUser,
  type AuthEnv,
} from "./auth-middleware";
import { AuthService } from "./auth-service";
import {
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
} from "./session-cookie";

export function registerAuthRoutes(
  app: Hono<AuthEnv>,
  dependencies: { auth: AuthService; config: AppConfig },
): void {
  const { auth, config } = dependencies;
  const user = requireUser(auth, config, { skipPathPrefix: "/api/webhooks/" });
  const csrf = requireCsrf(auth);

  app.post("/api/auth/login", async (context) => {
    const parsed = loginRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    const result = await auth.login(
      parsed.data.email,
      parsed.data.password,
      context.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown",
    );
    if (result.kind === "throttled") {
      return context.json({ error: "invalid_credentials" }, 429, {
        "Retry-After": "900",
      });
    }
    if (result.kind === "invalid") {
      return context.json({ error: "invalid_credentials" }, 401);
    }
    writeSessionCookie(context, config, result.context.session.rawToken);
    return context.json(loginResponseSchema.parse({ user: result.context.user.summary }));
  });

  app.get("/api/auth/me", user, (context) => {
    return context.json({ user: context.get("auth").user.summary });
  });

  app.get("/api/auth/csrf", user, async (context) => {
    return context.json(
      csrfResponseSchema.parse({ csrfToken: await auth.csrfToken(context.get("auth")) }),
    );
  });

  app.post("/api/auth/logout", user, csrf, async (context) => {
    await auth.logout(context.get("auth"));
    clearSessionCookie(context, config);
    return context.body(null, 204);
  });

  app.post("/api/auth/change-password", user, csrf, async (context) => {
    const parsed = changePasswordRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    const next = await auth.changePassword(
      context.get("auth"),
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (!next) return context.json({ error: "invalid_credentials" }, 401);
    writeSessionCookie(context, config, next.session.rawToken);
    return context.json({ user: next.user.summary });
  });

  app.post("/api/auth/reauthenticate", user, csrf, async (context) => {
    const parsed = reauthenticateRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return context.json({ error: "invalid_request" }, 400);
    const next = await auth.reauthenticate(context.get("auth"), parsed.data.password);
    if (!next) return context.json({ error: "invalid_credentials" }, 401);
    writeSessionCookie(context, config, next.session.rawToken);
    return context.json({ user: next.user.summary });
  });

  app.use("/api/*", user, requirePasswordChangeComplete());
}

async function readJson(context: Context<AuthEnv>): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}
