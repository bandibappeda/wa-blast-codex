import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DashboardPage } from "./dashboard-page";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  GlobalRegistrator.unregister();
});

describe("DashboardPage", () => {
  test("renders operational metrics, campaign progress, and recent failures", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      queue: { depth: 4, oldestPendingAt: "2026-01-01T00:00:00.000Z", oldestPendingAgeSeconds: 120 },
      approvals: { pending: 2 },
      activeCampaigns: [{ id: "campaign-1", name: "January update", state: "running", total: 10, pending: 4, sent: 2, delivered: 3, read: 1, failed: 0, progressPercent: 60 }],
      gateways: { total: 2, healthy: 1, unhealthy: 1, unknown: 0 },
      delivery: { total: 10, pending: 4, retrying: 1, sent: 2, delivered: 2, read: 1, failed: 0, successRate: 50 },
      recentFailures: [{ jobId: "job-1", campaignId: "campaign-1", campaignName: "January update", recipientName: "Ada", message: "provider timeout", updatedAt: "2026-01-01T00:00:00.000Z" }],
    }), { status: 200 })) as unknown as typeof fetch;

    const view = render(<DashboardPage />);
    await waitFor(() => expect(view.getByRole("heading", { name: "Dashboard" })).toBeTruthy());
    expect(view.getByText("4")).toBeTruthy();
    expect(view.getByText("2 pending approval")).toBeTruthy();
    expect(view.getAllByText("January update")).toHaveLength(2);
    expect(view.getByText("provider timeout")).toBeTruthy();
    expect(view.getByText("Delivery outcomes")).toBeTruthy();
  });
});
