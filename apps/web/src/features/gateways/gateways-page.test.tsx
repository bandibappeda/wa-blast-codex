import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { GatewaysPage } from "./gateways-page";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  GlobalRegistrator.unregister();
});

describe("GatewaysPage", () => {
  test("lists connections and opens a secret-safe create dialog", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/gateways") && !init?.method) {
        return new Response(JSON.stringify({ gateways: [{ id: "gw-1", name: "Primary Mock", adapterType: "mock", senderIdentity: "628111111111", messagesPerMinute: 60, enabled: true, healthStatus: "healthy", lastHealthCheckedAt: null, consecutiveFailures: 0, unhealthyUntil: null }] }), { status: 200 });
      }
      if (path.endsWith("/api/auth/csrf")) return new Response(JSON.stringify({ csrfToken: "csrf" }), { status: 200 });
      return new Response(JSON.stringify({ gateway: { id: "gw-2" } }), { status: 201 });
    }) as unknown as typeof fetch;

    const view = render(<GatewaysPage />);
    expect(await view.findByText("Primary Mock")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Add gateway" }));
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(view.getByLabelText("Credential token")).toBeTruthy();
    expect(view.getByLabelText("Credential token").getAttribute("value")).toBe("");
    await waitFor(() => expect(view.getByText("Gateway connections")).toBeTruthy());
  });
});
