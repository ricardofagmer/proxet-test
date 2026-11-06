import { test, expect, type Page } from "./fixtures";
import { strFromU8, unzipSync } from "fflate";

//
// Budgets as user-owned data: deleting a category removes its budget, and
// the GDPR export includes budgets. Every test creates its own uniquely named
// subcategory under the seeded "Groceries" so parallel runs never collide.

// The empty state repeats the header's "Add budget" action, so a user with
// no budgets can show two matching buttons.
function addBudgetButton(page: Page) {
  return page.getByRole("button", { name: "Add budget" }).first();
}

function uniqueName(prefix: string): string {
  return `${prefix} ${crypto.randomUUID().slice(0, 8)}`;
}

async function createSubcategory(page: Page, name: string): Promise<void> {
  await page.goto("/categories");
  await page.getByRole("button", { name: "Add Category" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Parent Category").selectOption("Groceries");
  await page.getByRole("button", { name: "Create Category" }).click();
  await expect(
    page.getByRole("heading", { name: "Create Category" }),
  ).toBeHidden();
  await expect(
    page.getByTestId("category-row").filter({ hasText: name }),
  ).toBeVisible();
}

async function addBudget(
  page: Page,
  categoryName: string,
  limit: string,
): Promise<void> {
  await page.goto("/budgets");
  await addBudgetButton(page).click();
  // Nested categories are rendered with one "— " per depth level; the
  // subcategory sits one level below its seeded parent.
  await page
    .getByLabel("Category")
    .selectOption({ label: `— ${categoryName}` });
  await page.getByLabel("Monthly limit").fill(limit);
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(
    page.getByRole("article", { name: categoryName }),
  ).toBeVisible();
}

test.describe("Budgets lifecycle", () => {
  test("deleting a category removes its budget", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const categoryName = uniqueName("Budgeted Sub");
    await createSubcategory(page, categoryName);
    await addBudget(page, categoryName, "250");

    await page.goto("/categories");
    const row = page
      .getByTestId("category-row")
      .filter({ hasText: categoryName });
    await row.getByTestId("delete-category").click();
    const confirm = page.getByRole("alertdialog", { name: "Delete Category" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.getByTestId("category-row").filter({ hasText: categoryName }),
    ).toBeHidden();

    // Fresh navigation so the budgets list is refetched from the server.
    await page.goto("/budgets");
    await expect(addBudgetButton(page)).toBeVisible();
    await expect(
      page.getByRole("article", { name: categoryName }),
    ).toHaveCount(0);

    // The category no longer exists, so it cannot be offered for a budget.
    await addBudgetButton(page).click();
    await expect(
      page.getByLabel("Category").locator("option", { hasText: categoryName }),
    ).toHaveCount(0);
  });

  test("data export includes budgets", async ({ page, signedInUser }) => {
    const categoryName = uniqueName("Exported Sub");
    await createSubcategory(page, categoryName);
    await addBudget(page, categoryName, "250");

    const res = await page.request.get("/api/export-data");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.body()));

    const json = JSON.parse(strFromU8(files["export.json"]));
    expect(json.user.id).toBe(signedInUser.userId);
    expect(json.budgets).toHaveLength(1);
    expect(json.budgets[0].limit_minor).toBe(25000);
    expect(json.budgetAlerts).toEqual([]);

    expect(files["budgets.csv"]).toBeDefined();
    const budgetsCsv = strFromU8(files["budgets.csv"]);
    expect(budgetsCsv).toContain(`"${categoryName}"`);
    expect(budgetsCsv).toContain('"250.00","25000"');
  });
});
