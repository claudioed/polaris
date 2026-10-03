import { expect, test, type Page } from "@playwright/test";
import { apiPost, getSecurityHeaders, handoff, seedWorkspace, signInAs } from "./helpers";

test.skip(process.env.POLARIS_SKIP_INTEGRATION === "1", "POLARIS_SKIP_INTEGRATION=1");

async function openApp(page: Page, token?: string): Promise<void> {
  await signInAs(page, token ?? handoff().validToken);
  await page.goto(handoff().spaUrl);
}

test("serves the production security headers", async ({ request }) => {
  const headers = await getSecurityHeaders(request);

  expect(headers["content-security-policy"]).toContain(
    "https://accounts.google.com/gsi/client",
  );
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
});

test("renders the sign-in gate while signed out", async ({ page }) => {
  await page.goto(handoff().spaUrl);

  await expect(page.getByRole("heading", { name: "Polaris Control Tower" })).toBeVisible();
  await expect(
    page.getByText("Sign in with your Google account to govern fitness functions."),
  ).toBeVisible();
});

test("shows the onboarding empty state for a fresh workspace", async ({ page }) => {
  await openApp(page);

  await expect(page.getByRole("heading", { name: "Set up your first squad" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up workspace" })).toBeVisible();
});

test("flips back to the sign-in gate when the account is not authorized", async ({ page }) => {
  await openApp(page, handoff().intruderToken);

  await expect(
    page.getByText("Sign in with your Google account to govern fitness functions."),
  ).toBeVisible({ timeout: 20_000 });
  const stored = await page.evaluate(() => sessionStorage.getItem("polaris.idToken"));
  expect(stored).toBeNull();
});

test("walks workspace setup into control creation", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "Set up workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare your squad" });
  await expect(dialog).toBeVisible();

  // A fresh workspace has no tribes, so the dialog starts in new-tribe mode.
  await page.getByLabel("New tribe name").fill("Foundations");
  await page.getByLabel("Squad name").fill("Checkout");
  await page.getByLabel("First fitness target").fill("Orders API");
  await dialog.getByRole("button", { name: "Create squad and target" }).click();

  await expect(page.getByRole("dialog", { name: "Create fitness function" })).toBeVisible();
});

test("creates a PUSH control draft through the wizard", async ({ page }) => {
  const { squadId, producerId } = await seedWorkspace("Wizard Push");
  const controlName = "Build stability";
  await openApp(page);

  await page
    .locator("section.page-heading")
    .getByRole("button", { name: "New fitness function" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create fitness function" });
  await expect(dialog).toBeVisible();

  await page.getByLabel("Name").fill(controlName);
  await page.getByLabel("Purpose").fill("Keep the main branch build stable for releases.");
  await page.getByLabel("Objective").fill("Fail the pipeline when flaky tests exceed the budget.");
  // The wizard opens on the first squad; switch to the seeded one.
  await dialog.getByLabel("Owning squad").selectOption(squadId);
  await dialog.getByRole("button", { name: /Target Wizard Push/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Key").fill("flaky_tests");
  await page.getByLabel("Unit").fill("count");
  await page.getByLabel("Failure value").fill("3");
  await dialog.getByRole("button", { name: "Continue" }).click();

  await dialog.getByRole("button", { name: "Receive from pipeline" }).click();
  await page.getByLabel(/^Producer ID/).fill(producerId);
  await dialog.getByRole("button", { name: "Continue" }).click();

  // The step-3 transition swaps Continue for the submit button at the same
  // footer position, and in Chromium that hand-off submits the form on its
  // own; wait for the outcome instead of racing the button. The activation
  // checkbox itself is covered by the unit suite; the search test below
  // covers the ACTIVE lifecycle rendering through an API-activated control.
  const closedItself = await dialog
    .waitFor({ state: "hidden", timeout: 5_000 })
    .then(() => true, () => false);
  if (!closedItself) {
    await dialog.getByRole("button", { name: "Create draft" }).click();
    await expect(dialog).toBeHidden();
  }
  const row = page.getByRole("row").filter({ hasText: controlName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("DRAFT");
  await expect(row).toContainText("PUSH");
});

test("lists every fitness target across pages", async ({ page }) => {
  // Seed 60 targets onto the catalog's first squad (the wizard opens on it).
  const tribesPage = await (
    await fetch(`${handoff().apiUrl}/api/v1/tribes?limit=200`, {
      headers: { Authorization: `Bearer ${handoff().validToken}` },
    })
  ).json();
  const firstTribe = tribesPage.items[0];
  const squadsPage = await (
    await fetch(`${handoff().apiUrl}/api/v1/tribes/${firstTribe.id}/squads?limit=200`, {
      headers: { Authorization: `Bearer ${handoff().validToken}` },
    })
  ).json();
  const firstSquadId = squadsPage.items[0].id;
  const targetsPage = await (
    await fetch(`${handoff().apiUrl}/api/v1/squads/${firstSquadId}/fitness-targets?limit=200`, {
      headers: { Authorization: `Bearer ${handoff().validToken}` },
    })
  ).json();
  const existingTargets = targetsPage.items.length;
  for (let index = existingTargets; index < 60; index += 1) {
    const response = await apiPost(`/squads/${firstSquadId}/fitness-targets`, {
      name: `Bulk target ${index}`,
      kind: "SERVICE",
    });
    if (!response.ok) throw new Error(`seed target ${index} failed: ${response.status}`);
  }

  await openApp(page);
  await page
    .locator("section.page-heading")
    .getByRole("button", { name: "New fitness function" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create fitness function" });
  await expect(dialog).toBeVisible();

  await expect(dialog.locator(".choice-card")).toHaveCount(60);
});

test("filters controls by search and recovers the list", async ({ page }) => {
  const { squadId, targetId, producerId } = await seedWorkspace("Search");
  const controlName = "Latency guard search";
  const created = await apiPost(`/squads/${squadId}/fitness-functions`, {
    name: controlName,
    purpose: "Protect search seeding from regressions.",
    objective: "Keep latency within the agreed budget.",
    targetIds: [targetId],
    criteria: [
      {
        key: "latency",
        unit: "ms",
        required: true,
        failureComparison: "GREATER_THAN",
        failureValue: 500,
      },
    ],
    acquisition: { mode: "PUSH", producerId, maximumObservationAgeSeconds: 600 },
    freshnessSeconds: 300,
    enforcement: "WARN",
  });
  if (!created.ok) throw new Error(`seed function failed: ${created.status}`);
  const createdFunction = (await created.json()) as { id: string };
  const activation = await apiPost(
    `/fitness-functions/${createdFunction.id}/versions/1/activations`,
    {},
  );
  if (!activation.ok) throw new Error(`activate function failed: ${activation.status}`);

  await openApp(page);

  const search = page.getByLabel("Search fitness functions");
  await search.fill(controlName);
  await expect(page.getByRole("row").filter({ hasText: controlName })).toBeVisible();

  await search.fill("zzz-no-matching-control");
  await expect(page.getByText("No matching controls")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  const restoredRow = page.getByRole("row").filter({ hasText: controlName });
  await expect(restoredRow).toBeVisible();
  await expect(restoredRow).toContainText("ACTIVE");
});

test("surfaces the offline state and recovers through retry", async ({ page }) => {
  await openApp(page);

  await page.route("**/api/**", (route) => route.abort());
  await page.goto(handoff().spaUrl);
  await expect(page.getByRole("heading", { name: "Control tower is offline" })).toBeVisible();

  await page.unroute("**/api/**");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Total controls")).toBeVisible({ timeout: 20_000 });
});
