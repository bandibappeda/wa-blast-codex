import type { SendMessageResult } from "../gateways/gateway-adapter";

export type ClassifiedGatewayResult =
  | { category: "sent"; providerMessageId: string }
  | { category: "transient" | "permanent"; code: string; message: string };

export function classifyGatewayResult(result: SendMessageResult): ClassifiedGatewayResult {
  if (result.kind === "sent") return { category: "sent", providerMessageId: result.providerMessageId };
  return { category: result.kind === "transient_failure" ? "transient" : "permanent", code: result.code, message: result.message };
}
