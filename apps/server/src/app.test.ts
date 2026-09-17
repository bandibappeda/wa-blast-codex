import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

describe("GET /api/health", () => {
  test("reports the API as healthy", async () => {
    const response = await createApp().request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "api",
    });
  });
});
