import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { LoginPage } from "./login-page";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  GlobalRegistrator.unregister();
});

describe("LoginPage", () => {
  test("shows a generic error for invalid credentials", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ error: "invalid_credentials" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const view = render(<LoginPage onAuthenticated={() => undefined} />);

    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "operator@example.com" },
    });
    fireEvent.change(view.getByLabelText("Password"), {
      target: { value: "not-the-password" },
    });
    fireEvent.click(view.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(view.getByRole("alert").textContent).toContain(
        "Email atau password tidak valid.",
      );
    });
  });
});
