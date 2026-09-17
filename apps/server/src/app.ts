import { healthResponseSchema } from "@wa-blast/contracts";
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { loadConfig, type AppConfig } from "./config";
import { openDatabase } from "./db/database";
import { migrate } from "./db/migrate";
import { SystemClock, type Clock } from "./shared/clock";
import { UuidGenerator, type IdGenerator } from "./shared/id";
import { createAuthService } from "./modules/auth/auth-service";
import { registerAuthRoutes } from "./modules/auth/auth-routes";
import type { AuthEnv } from "./modules/auth/auth-middleware";
import { ContactService } from "./modules/contacts/contact-service";
import { registerContactRoutes } from "./modules/contacts/contact-routes";

export interface AppDependencies {
  db?: Database;
  clock?: Clock;
  ids?: IdGenerator;
  config?: AppConfig;
}

export function createApp(dependencies: AppDependencies = {}) {
  const config = dependencies.config ?? loadConfig();
  const db = dependencies.db ?? openDatabase(":memory:");
  migrate(db);
  const clock = dependencies.clock ?? new SystemClock();
  const ids = dependencies.ids ?? new UuidGenerator();
  const app = new Hono<AuthEnv>();

  app.get("/api/health", (context) => {
    const response = healthResponseSchema.parse({
      status: "ok",
      service: "api",
    });

    return context.json(response);
  });

  registerAuthRoutes(app, {
    auth: createAuthService({ db, clock, ids, config }),
    config,
  });
  const auth = createAuthService({ db, clock, ids, config });
  registerContactRoutes(app, {
    service: new ContactService({ db, clock, ids, config }),
    auth,
    config,
  });

  return app;
}
