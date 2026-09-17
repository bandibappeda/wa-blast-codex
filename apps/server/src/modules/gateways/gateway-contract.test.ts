import { describe, expect, test } from "bun:test";
import { MockGatewayAdapter } from "./mock-gateway-adapter";

describe("gateway adapter contract", () => {
  test("is idempotent and normalizes mock delivery events", async () => {
    const adapter = new MockGatewayAdapter();
    const connection = {
      id: "gateway-1",
      type: "mock",
      senderIdentity: "628111111111",
      config: {},
    };

    expect(await adapter.validateConnection(connection)).toEqual({ valid: true });
    expect((await adapter.checkHealth(connection)).status).toBe("healthy");

    const command = {
      connection,
      idempotencyKey: "job-1",
      recipientPhone: "+6281234567890",
      body: "Halo Ani",
      attachment: { storageKey: "attachments/a.pdf", mimeType: "application/pdf" },
    };
    const first = await adapter.sendMessage(command);
    const second = await adapter.sendMessage(command);
    expect(first.kind).toBe("sent");
    expect(second).toEqual(first);
    expect(adapter.sentCount).toBe(1);

    if (first.kind !== "sent") throw new Error("expected sent result");

    const events = await adapter.normalizeWebhook({
      eventId: "evt-1",
      idempotencyKey: "job-1",
      status: "delivered",
      providerMessageId: first.providerMessageId,
    });
    expect(events).toEqual([{ eventId: "evt-1", idempotencyKey: "job-1", status: "delivered", providerMessageId: first.providerMessageId }]);
  });

  test("supports scripted transient and permanent failures", async () => {
    const adapter = new MockGatewayAdapter();
    const connection = { id: "gateway-1", type: "mock", senderIdentity: "sender", config: {} };
    adapter.script("transient-job", { kind: "transient_failure", code: "timeout", message: "timeout" });
    adapter.script("permanent-job", { kind: "permanent_failure", code: "invalid_number", message: "invalid" });

    expect((await adapter.sendMessage({ connection, idempotencyKey: "transient-job", recipientPhone: "+1", body: "x" })).kind).toBe("transient_failure");
    expect((await adapter.sendMessage({ connection, idempotencyKey: "permanent-job", recipientPhone: "+1", body: "x" })).kind).toBe("permanent_failure");
  });
});
