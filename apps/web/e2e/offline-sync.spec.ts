import { expect, test } from "@playwright/test";

test("edits stay visible offline and show unsynced state", async ({ page, context }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));

  const body = page.getByRole("textbox", { name: "Note body" });
  await body.fill("Offline draft");

  await context.setOffline(true);
  await page.reload();

  await expect(body).toHaveValue("Offline draft");
  await expect(page.getByText("Unsynced")).toBeVisible();
});
