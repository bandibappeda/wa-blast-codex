import { describe, expect, test } from "bun:test";
import { classifyGatewayResult } from "./error-classifier";

describe("gateway delivery error classifier", () => {
  test("preserves transient and permanent categories without provider leakage", () => {
    expect(classifyGatewayResult({ kind: "transient_failure", code: "timeout", message: "request timed out" })).toEqual({ category: "transient", code: "timeout", message: "request timed out" });
    expect(classifyGatewayResult({ kind: "permanent_failure", code: "invalid_number", message: "invalid" })).toEqual({ category: "permanent", code: "invalid_number", message: "invalid" });
    expect(classifyGatewayResult({ kind: "sent", providerMessageId: "provider-1" })).toEqual({ category: "sent", providerMessageId: "provider-1" });
  });
});
