import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CampaignEditor } from "./campaign-editor";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  GlobalRegistrator.unregister();
});

describe("CampaignEditor", () => {
  test("walks the four-step workflow and keeps audience counts visible", () => {
    const view = render(<CampaignEditor
      gateways={[{ id: "gw-1", name: "Primary", healthStatus: "healthy", enabled: true }]}
      templates={[{ id: "tpl-1", name: "Offer", body: "Halo {{name}}" }]}
      contacts={[{ id: "contact-1", name: "Ani", phoneE164: "+6281234567890", tags: ["pilot"] }]}
      onCancel={() => undefined}
      onSaved={() => undefined}
    />);

    expect(view.getByRole("heading", { name: "Campaign details" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /2 Audience/ }));
    fireEvent.click(view.getAllByRole("checkbox")[0]!);
    expect(view.getByText(/1 selected/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /3 Message/ }));
    expect(view.getByText("Halo {{name}}" )).toBeTruthy();
  });
});
