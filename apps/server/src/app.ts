import { healthResponseSchema } from "@wa-blast/contracts";
import { Hono } from "hono";

export function createApp() {
  const app = new Hono();

  app.get("/api/health", (context) => {
    const response = healthResponseSchema.parse({
      status: "ok",
      service: "api",
    });

    return context.json(response);
  });

  return app;
}
