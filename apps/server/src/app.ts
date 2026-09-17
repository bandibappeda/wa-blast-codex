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
import { CredentialVault } from "./modules/gateways/credential-vault";
import { GatewayRegistry } from "./modules/gateways/gateway-registry";
import { MockGatewayAdapter } from "./modules/gateways/mock-gateway-adapter";
import { GatewayService } from "./modules/gateways/gateway-service";
import { registerGatewayRoutes } from "./modules/gateways/gateway-routes";

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

  const auth = createAuthService({ db, clock, ids, config });
  registerAuthRoutes(app, { auth, config });
  registerContactRoutes(app, {
    service: new ContactService({ db, clock, ids, config }),
    auth,
    config,
  });
  const registry = new GatewayRegistry();
  registry.register(new MockGatewayAdapter());
  registerGatewayRoutes(app, {
    service: new GatewayService({ db, clock, ids, config, registry, vault: new CredentialVault(config.gatewayEncryptionKey) }),
    auth,
    config,
  });

  return app;
}
