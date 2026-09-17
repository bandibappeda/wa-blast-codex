import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { ApprovalDialog } from "./approval-dialog";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  GlobalRegistrator.unregister();
});

describe("ApprovalDialog", () => {
  test("requires an explicit confirmation before approving", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/auth/csrf")) return new Response(JSON.stringify({ csrfToken: "csrf" }), { status: 200 });
      return new Response(JSON.stringify({ campaign: { state: "queued" }, approval: { jobsCreated: 1, excluded: 0 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const view = render(<ApprovalDialog campaignId="campaign-1" version={2} summary={{ eligible: 1, excluded: 0 }} onClose={() => undefined} onApproved={() => undefined} />);
    expect(view.getByText(/cannot be undone/i)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Approve campaign" }));
    expect(view.getByRole("checkbox", { name: /I understand/i })).toBeTruthy();
    fireEvent.click(view.getByRole("checkbox", { name: /I understand/i }));
    fireEvent.click(view.getByRole("button", { name: "Approve campaign" }));
    await waitFor(() => expect(view.getByText(/approved/i)).toBeTruthy());
  });
});
