import { expect, test, type Page } from "@playwright/test";

const admin = { email: "admin.e2e@wa-blast.test", password: "AdminPassword!123" };
const operator = { email: "operator.e2e@wa-blast.test", password: "OperatorPassword!123" };
const gatewayId = "gateway-e2e-mock";
const webhookSecret = "e2e-webhook-secret";

test("campaign lifecycle: import, draft, approve, deliver, and audit", async ({ page, request }) => {
  await signIn(page, operator.email, operator.password);

  await page.goto("/contacts");
  await page.locator("#contacts-csv").fill([
    "phone,name,consent_source,consent_at",
    "081234567890,Rina,e2e,2026-01-01T00:00:00.000Z",
    "+628111111111,Suppressed duplicate,e2e,2026-01-01T00:00:00.000Z",
    "not-a-phone,Invalid row,e2e,2026-01-01T00:00:00.000Z",
  ].join("\n"));
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("status")).toContainText("Accepted 1");
  await page.getByRole("button", { name: /Commit 1 accepted/ }).click();
  await expect(page.getByRole("status")).toContainText("1 contact diimpor");

  await page.goto("/templates");
  await page.getByRole("button", { name: "Add template" }).click();
  await page.getByLabel("Template name").fill("E2E greeting");
  await page.getByLabel("Template body").fill("Halo {{name}}, ini pesan pengujian.");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  await expect(page.getByText("E2E greeting")).toBeVisible();

  await page.goto("/campaigns");
  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByLabel("Campaign name").fill("E2E campaign");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator(".audience-row").filter({ hasText: "Rina" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Message template").selectOption({ label: "E2E greeting" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  const campaignLink = page.getByRole("link", { name: /E2E campaign/ });
  await expect(campaignLink).toBeVisible();
  const campaignPath = await campaignLink.getAttribute("href");
  if (!campaignPath) throw new Error("campaign link did not expose a URL");
  await campaignLink.click();
  await expect(page.getByRole("heading", { name: "E2E campaign" })).toBeVisible();
  await expect(page.getByText("1 eligible", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByRole("status")).toContainText("submitted for admin approval");
  await expect(page.locator(".page-heading p")).toContainText("pending_approval");

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, admin.email, admin.password);
  await page.goto(campaignPath);
  await page.getByRole("button", { name: "Review approval" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Approve campaign" }).click();
  await dialog.getByLabel("I understand this action").check();
  await dialog.getByRole("button", { name: "Approve campaign" }).click();
  await expect(dialog.getByLabel("Current password")).toBeVisible();
  await dialog.getByLabel("Current password").fill(admin.password);
  await dialog.getByRole("button", { name: "Approve campaign" }).click();
  await expect(page.locator(".page-heading p")).toContainText(/queued|running/);

  const campaignId = readCampaignId(campaignPath);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/campaigns/${campaignId}/delivery?page=1&pageSize=25`);
    const payload = await response.json() as { recipients: Array<{ idempotencyKey: string; providerMessageId: string | null }> };
    return payload.recipients[0] ?? null;
  }, { timeout: 30_000 }).toMatchObject({ providerMessageId: expect.any(String), idempotencyKey: expect.any(String) });
  const deliveryResponse = await page.request.get(`/api/campaigns/${campaignId}/delivery?page=1&pageSize=25`);
  const deliveryPayload = await deliveryResponse.json() as { recipients: Array<{ idempotencyKey: string; providerMessageId: string | null }> };
  const currentJob = deliveryPayload.recipients[0];
  if (!currentJob || !currentJob.providerMessageId) throw new Error("worker did not send the campaign job");

  const webhookUrl = `/api/webhooks/gateways/${gatewayId}`;
  const delivered = await request.post(webhookUrl, {
    headers: { "X-Gateway-Token": webhookSecret },
    data: { idempotencyKey: currentJob.idempotencyKey, status: "delivered", eventId: "e2e-delivered", providerMessageId: currentJob.providerMessageId },
  });
  expect(delivered.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("cell", { name: "Delivered" })).toBeVisible();

  const read = await request.post(webhookUrl, {
    headers: { "X-Gateway-Token": webhookSecret },
    data: { idempotencyKey: currentJob.idempotencyKey, status: "read", eventId: "e2e-read", providerMessageId: currentJob.providerMessageId },
  });
  expect(read.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("cell", { name: "Read" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Delivery outcomes" })).toBeVisible();
  await page.goto("/audit");
  await page.getByLabel("Action").fill("campaign.approved");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("campaign.approved", { exact: true })).toBeVisible();
});

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

function readCampaignId(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}
