import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TemplateEditor } from "./template-editor";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  GlobalRegistrator.unregister();
});

describe("TemplateEditor", () => {
  test("shows a live preview, missing variables, and character count", () => {
    const view = render(<TemplateEditor initialBody="Halo {{name}}" onCancel={() => undefined} onSaved={() => undefined} />);
    expect(view.getByText("name")).toBeTruthy();
    expect(view.getByText(/characters/i)).toBeTruthy();
    expect(view.getByText(/sample value/i)).toBeTruthy();
  });
});
