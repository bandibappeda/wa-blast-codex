import { expect, test } from "@playwright/test";

test("operator cannot navigate to admin-only modules", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("operator.e2e@wa-blast.test");
  await page.getByLabel("Password").fill("OperatorPassword!123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await expect(page.getByRole("link", { name: "Gateways" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);

  for (const path of ["/gateways", "/users", "/audit"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible();
  }
});
