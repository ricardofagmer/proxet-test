import { test, expect, type Page } from "./fixtures";

//
// Plan gating for budgets: free users are capped (BILLING_FREE_MAX_BUDGETS,
// default 3), Pro is unlimited, and a downgrade keeps existing budgets while
// blocking new ones. Plans are switched through the TEST_MODE-only
// /test-set-plan route, which writes the same row a verified webhook would.

// Seeded top-level categories, one budget each.
const SEEDED_CATEGORIES = ["Groceries", "Housing", "Transport", "Entertainment"];

async function addBudget(
  page: Page,
  opts: { category: string; limit: string },
): Promise<void> {
  await page.getByRole("button", { name: "Add budget" }).click();
  const dialog = page.getByRole("dialog", { name: "Add budget" });
  await dialog.getByLabel("Category").selectOption({ label: opts.category });
  await dialog.getByLabel("Monthly limit").fill(opts.limit);
  await dialog.getByRole("button", { name: "Save budget" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("article", { name: opts.category, exact: true }),
  ).toBeVisible();
}

async function setPlan(page: Page, plan: "free" | "pro"): Promise<void> {
  const res = await page.request.post(`/test-set-plan?plan=${plan}`);
  expect(res.ok()).toBe(true);
}

test.describe("Budgets plan limits", () => {
  test.beforeEach(async ({ page, signedInUser: _signedInUser }) => {
    await page.goto("/budgets");
    await expect(page).toHaveURL("/budgets");
  });

  test("free plan blocks the fourth budget and shows the upsell", async ({
    page,
  }) => {
    for (const [index, category] of SEEDED_CATEGORIES.slice(0, 3).entries()) {
      await addBudget(page, { category, limit: "100" });
      await expect(
        page.getByText(`${index + 1} of 3 budgets used`),
      ).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "Add budget" })).toBeDisabled();
    await expect(page.getByText("3 of 3 budgets used")).toBeVisible();
    await expect(
      page.getByText(
        "The free plan is limited to 3 budgets. Upgrade to Pro for unlimited budgets.",
      ),
    ).toBeVisible();
    const upgrade = page.getByRole("link", { name: "Upgrade to Pro" });
    await expect(upgrade).toHaveAttribute("href", "/billing");

    await upgrade.click();
    await expect(page).toHaveURL("/billing");
  });

  test("pro plan allows more than three budgets without a usage cap", async ({
    page,
  }) => {
    await setPlan(page, "pro");
    await page.goto("/budgets");

    for (const category of SEEDED_CATEGORIES) {
      await addBudget(page, { category, limit: "100" });
    }

    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Add budget" })).toBeEnabled();
    await expect(page.getByText(/budgets used/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Upgrade to Pro" })).toHaveCount(
      0,
    );
  });

  test("downgrading keeps existing budgets but blocks new ones", async ({
    page,
  }) => {
    await setPlan(page, "pro");
    await page.goto("/budgets");
    for (const category of SEEDED_CATEGORIES) {
      await addBudget(page, { category, limit: "100" });
    }

    await setPlan(page, "free");
    await page.goto("/budgets");

    await expect(page.getByRole("article")).toHaveCount(4);
    for (const category of SEEDED_CATEGORIES) {
      await expect(
        page.getByRole("article", { name: category, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Add budget" })).toBeDisabled();
    await expect(page.getByText("4 of 3 budgets used")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Upgrade to Pro" }),
    ).toHaveAttribute("href", "/billing");

    // Existing budgets stay fully editable after the downgrade.
    const card = page.getByRole("article", { name: "Groceries", exact: true });
    await card.getByRole("button", { name: "Edit budget" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit budget" });
    await dialog.getByLabel("Monthly limit").fill("250");
    await dialog.getByRole("button", { name: "Save budget" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText("250.00 PLN")).toHaveCount(2);
  });
});
