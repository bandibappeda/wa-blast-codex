import { describe, expect, test } from "bun:test";
import { projectDeliveryStatus } from "./status-projector";

describe("delivery status projector", () => {
  test("keeps the highest observed status and protects terminal failures", () => {
    expect(projectDeliveryStatus("delivered", "sent")).toBe("delivered");
    expect(projectDeliveryStatus("delivered", "read")).toBe("read");
    expect(projectDeliveryStatus("failed", "sent", "provider-1", "provider-2")).toBe("failed");
    expect(projectDeliveryStatus("failed", "sent", "provider-1", "provider-1")).toBe("sent");
    expect(projectDeliveryStatus("sent", "failed")).toBe("failed");
  });
});
