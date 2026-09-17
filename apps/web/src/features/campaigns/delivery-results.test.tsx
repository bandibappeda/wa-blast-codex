import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DeliveryResults } from "./delivery-results";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  GlobalRegistrator.unregister();
});

describe("DeliveryResults", () => {
  test("renders delivery summary and recipient statuses", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      campaign: { id: "campaign-1", name: "January update", state: "queued" },
      summary: { total: 2, pending: 0, retrying: 0, leased: 0, sent: 0, delivered: 1, read: 1, failed: 0, cancelled: 0 },
      pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      recipients: [
        { id: "job-1", name: "Ada", phone: "+628111111111", status: "delivered", attemptCount: 1, providerMessageId: "provider-1", lastError: null, updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "job-2", name: "Grace", phone: "+628222222222", status: "read", attemptCount: 1, providerMessageId: "provider-2", lastError: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const view = render(<DeliveryResults campaignId="campaign-1" />);

    await waitFor(() => expect(view.getByText("Delivery results")).toBeTruthy());
    expect(view.getByText("Ada")).toBeTruthy();
    expect(view.getAllByText("Delivered").length).toBeGreaterThan(0);
    expect(view.getAllByText("Read").length).toBeGreaterThan(0);
    expect(view.getByText("2 total")).toBeTruthy();
    expect(view.getByRole("textbox", { name: "Search delivery results" })).toBeTruthy();
    expect(view.getByRole("combobox", { name: "Filter delivery status" })).toBeTruthy();
    expect(view.getByRole("link", { name: "Download CSV" }).getAttribute("href")).toBe("/api/campaigns/campaign-1/delivery.csv");
  });
});
