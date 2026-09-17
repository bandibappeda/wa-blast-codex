import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.describe("responsive workspace layout", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} has no page overflow or clipped primary controls`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/login");
      await page.getByLabel("Email").fill("operator.e2e@wa-blast.test");
      await page.getByLabel("Password").fill("OperatorPassword!123");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      const consoleErrors: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      const dimensions = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        focusedVisible: !document.activeElement || (() => {
          const rect = document.activeElement.getBoundingClientRect();
          return rect.width > 0 || rect.height > 0;
        })(),
      }));
      expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
      expect(dimensions.focusedVisible).toBe(true);

      await page.goto("/campaigns");
      await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
      const campaignDimensions = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(campaignDimensions.bodyWidth).toBeLessThanOrEqual(campaignDimensions.viewportWidth);
      expect(consoleErrors).toEqual([]);
    });
  }
});
