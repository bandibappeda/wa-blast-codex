import { describe, expect, test } from "bun:test";
import { retryDecision } from "./retry-policy";

describe("delivery retry policy", () => {
  test("uses bounded exponential delays and stops after three attempts", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(retryDecision(1, now, () => 0)).toEqual({ shouldRetry: true, availableAt: "2026-01-01T00:00:30.000Z" });
    expect(retryDecision(2, now, () => 500)).toEqual({ shouldRetry: true, availableAt: "2026-01-01T00:02:00.500Z" });
    expect(retryDecision(3, now, () => 0)).toEqual({ shouldRetry: false, availableAt: null });
  });
});
