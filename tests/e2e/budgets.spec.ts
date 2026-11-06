import { test, expect, type Page } from "./fixtures";

//
// Budgets page: navigation, CRUD, validation and live spend display. Every
// test runs as a fresh `signedInUser` (seeded default categories such as
// "Groceries" > "Vegetables" and a "Main" PLN account), so budgets and
// transactions never leak between parallel tests.

/** Today in UTC — budgets count the current UTC calendar month. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function openAddBudgetDialog(page: Page) {
  await page.getByRole("button", { name: "Add budget" }).click();
  const dialog = page.getByRole("dialog", { name: "Add budget" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function addBudget(
  page: Page,
  opts: { category: string; limit: string },
): Promise<void> {
  const dialog = await openAddBudgetDialog(page);
  await dialog.getByLabel("Category").selectOption({ label: opts.category });
  await dialog.getByLabel("Monthly limit").fill(opts.limit);
  await dialog.getByRole("button", { name: "Save budget" }).click();
  await expect(dialog).toBeHidden();
}

function budgetCard(page: Page, category: string) {
  return page.getByRole("article", { name: category, exact: true });
}

async function createTransaction(
  page: Page,
  opts: {
    description: string;
    amount: string;
    category: string;
    isIncome?: boolean;
  },
): Promise<void> {
  await page.goto("/transactions");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Add Transaction" })
    .click();
  const modal = page.getByRole("dialog", { name: "New Transaction" });
  // Midday keeps the date inside the current UTC month in any timezone.
  await modal.getByLabel("Date").fill(`${todayUtc()}T12:00`);
  await modal.getByLabel("Description").fill(opts.description);
  await modal
    .getByRole("spinbutton", { name: "Amount", exact: true })
    .fill(opts.amount);
  await modal.getByLabel("Account").selectOption("Main (PLN)");
  await modal.getByLabel("Category").selectOption({ label: opts.category });
  if (opts.isIncome) {
    await modal.getByLabel("Income").check();
  }
  await modal.getByRole("button", { name: "Create Transaction" }).click();
  await expect(modal).toBeHidden();
  await expect(
    page.getByRole("table").getByText(opts.description),
  ).toBeVisible();
}

test.describe("Budgets page", () => {
  test.beforeEach(async ({ page, signedInUser: _signedInUser }) => {
    await page.goto("/budgets");
    await expect(page).toHaveURL("/budgets");
  });

  test("is reachable from the sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Budgets" }).click();
    await expect(page).toHaveURL("/budgets");
    await expect(
      page.getByRole("heading", { name: "Budgets", exact: true, level: 1 }),
    ).toBeVisible();
  });

  test("shows an empty state with the add action when there are no budgets", async ({
    page,
  }) => {
    await expect(page.getByText("No budgets yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add budget" }),
    ).toBeEnabled();
    await expect(page.getByText("0 of 3 budgets used")).toBeVisible();
    await expect(
      page.getByText(/counts spending only from accounts in its currency/),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
  });

  test("asks for an account first when the user has none", async ({ page }) => {
    await page.goto("/accounts");
    await page.getByTestId("delete-account").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByTestId("delete-account")).toHaveCount(0);

    await page.goto("/budgets");
    await expect(page.getByText("Add an account first")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Go to accounts" }),
    ).toHaveAttribute("href", "/accounts");
    await expect(page.getByRole("button", { name: "Add budget" })).toHaveCount(
      0,
    );
  });

  test("adds a budget and shows limit, spent and left", async ({ page }) => {
    await addBudget(page, { category: "Groceries", limit: "500" });

    const card = budgetCard(page, "Groceries");
    await expect(card).toBeVisible();
    await expect(card.getByText("Limit")).toBeVisible();
    await expect(card.getByText("Spent")).toBeVisible();
    await expect(card.getByText("Left")).toBeVisible();
    await expect(card.getByText("500.00 PLN")).toHaveCount(2);
    await expect(card.getByText("0.00 PLN", { exact: true })).toBeVisible();
    await expect(
      card.getByRole("progressbar", { name: "Groceries budget used" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(card.getByText("Over budget")).toHaveCount(0);
    await expect(page.getByText("1 of 3 budgets used")).toBeVisible();
  });

  test("adds a budget for a newly created category", async ({ page }) => {
    const categoryName = uniqueName("Budget Cat");
    await page.goto("/categories");
    await page.getByRole("button", { name: "Add Category" }).click();
    await page.getByLabel("Name").fill(categoryName);
    await page.getByRole("button", { name: "Create Category" }).click();
    await expect(page.getByText(categoryName)).toBeVisible();

    await page.goto("/budgets");
    await addBudget(page, { category: categoryName, limit: "12,50" });

    const card = budgetCard(page, categoryName);
    await expect(card.getByText("12.50 PLN")).toHaveCount(2);
  });

  test("edits a budget limit", async ({ page }) => {
    await addBudget(page, { category: "Groceries", limit: "500" });
    const card = budgetCard(page, "Groceries");
    await card.getByRole("button", { name: "Edit budget" }).click();

    const dialog = page.getByRole("dialog", { name: "Edit budget" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Category")).toBeDisabled();
    await expect(dialog.getByLabel("Currency")).toBeDisabled();
    await expect(dialog.getByLabel("Monthly limit")).toHaveValue("500");

    await dialog.getByLabel("Monthly limit").fill("750.25");
    await dialog.getByRole("button", { name: "Save budget" }).click();
    await expect(dialog).toBeHidden();

    await expect(card.getByText("750.25 PLN")).toHaveCount(2);
    await expect(card.getByText("500.00 PLN")).toHaveCount(0);
  });

  test("removes a budget after confirmation", async ({ page }) => {
    await addBudget(page, { category: "Groceries", limit: "500" });
    const card = budgetCard(page, "Groceries");
    await card.getByRole("button", { name: "Remove budget" }).click();

    const confirm = page.getByRole("alertdialog", {
      name: "Remove this budget?",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete" }).click();

    await expect(confirm).toBeHidden();
    await expect(card).toHaveCount(0);
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("keeps the budget when removal is cancelled", async ({ page }) => {
    await addBudget(page, { category: "Groceries", limit: "500" });
    const card = budgetCard(page, "Groceries");
    await card.getByRole("button", { name: "Remove budget" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Remove this budget?",
    });
    await confirm.getByRole("button", { name: "Cancel" }).click();

    await expect(confirm).toBeHidden();
    await expect(card).toBeVisible();
  });

  test("validates the category and limit before submitting", async ({
    page,
  }) => {
    const dialog = await openAddBudgetDialog(page);
    const save = dialog.getByRole("button", { name: "Save budget" });

    await dialog.getByLabel("Monthly limit").fill("100");
    await save.click();
    await expect(dialog.getByText("Select a category.")).toBeVisible();

    await dialog.getByLabel("Category").selectOption({ label: "Groceries" });

    await dialog.getByLabel("Monthly limit").fill("");
    await save.click();
    await expect(
      dialog.getByText("Enter an amount greater than zero."),
    ).toBeVisible();

    await dialog.getByLabel("Monthly limit").fill("0");
    await save.click();
    await expect(
      dialog.getByText("Enter an amount greater than zero."),
    ).toBeVisible();

    await dialog.getByLabel("Monthly limit").fill("-5");
    await save.click();
    await expect(
      dialog.getByText("Enter an amount greater than zero."),
    ).toBeVisible();

    await dialog.getByLabel("Monthly limit").fill("abc");
    await save.click();
    await expect(
      dialog.getByText("Enter an amount greater than zero."),
    ).toBeVisible();

    // 30,000,000.00 = 3,000,000,000 minor units, above the int4 maximum.
    await dialog.getByLabel("Monthly limit").fill("30000000");
    await save.click();
    await expect(dialog.getByText("The limit is too large.")).toBeVisible();

    // Nothing was submitted: the dialog is still open and no card exists.
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("does not offer a category that already has a budget", async ({
    page,
  }) => {
    await addBudget(page, { category: "Groceries", limit: "500" });

    const dialog = await openAddBudgetDialog(page);
    const categorySelect = dialog.getByLabel("Category");
    await expect(
      categorySelect.locator("option", { hasText: /^Groceries$/ }),
    ).toHaveCount(0);
    // Its subcategories can still get their own budget.
    await expect(
      categorySelect.locator("option", { hasText: "— Vegetables" }),
    ).toHaveCount(1);
    // Uncategorized spending can never be budgeted.
    await expect(
      categorySelect.locator("option", { hasText: /uncategorized/i }),
    ).toHaveCount(0);
  });

  test("shows spent and the over-budget state when spending exceeds the limit", async ({
    page,
  }) => {
    await addBudget(page, { category: "Groceries", limit: "100" });
    await createTransaction(page, {
      description: uniqueName("Big shop"),
      amount: "150.00",
      category: "Groceries",
    });

    await page.goto("/budgets");
    const card = budgetCard(page, "Groceries");
    await expect(card.getByText("150.00 PLN")).toBeVisible();
    await expect(card.getByText("Over by 50.00 PLN")).toBeVisible();
    await expect(card.getByText("Over budget")).toBeVisible();
    await expect(
      card.getByRole("progressbar", { name: "Groceries budget used" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  test("is not over budget when spending equals the limit", async ({ page }) => {
    await addBudget(page, { category: "Groceries", limit: "80" });
    await createTransaction(page, {
      description: uniqueName("Exact shop"),
      amount: "80.00",
      category: "Groceries",
    });

    await page.goto("/budgets");
    const card = budgetCard(page, "Groceries");
    await expect(card.getByText("0.00 PLN", { exact: true })).toBeVisible();
    await expect(card.getByText("Over budget")).toHaveCount(0);
    await expect(
      card.getByRole("progressbar", { name: "Groceries budget used" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  test("a parent budget includes spending in its subcategories", async ({
    page,
  }) => {
    await addBudget(page, { category: "Groceries", limit: "500" });
    await createTransaction(page, {
      description: uniqueName("Veg"),
      amount: "40.00",
      category: "— Vegetables",
    });
    await createTransaction(page, {
      description: uniqueName("Groceries"),
      amount: "60.00",
      category: "Groceries",
    });

    await page.goto("/budgets");
    const card = budgetCard(page, "Groceries");
    await expect(card.getByText("100.00 PLN")).toBeVisible();
    await expect(card.getByText("400.00 PLN")).toBeVisible();
    await expect(card.getByText("Includes subcategories")).toBeVisible();
    await expect(
      card.getByRole("progressbar", { name: "Groceries budget used" }),
    ).toHaveAttribute("aria-valuenow", "20");
  });

  test("income does not reduce the spent amount", async ({ page }) => {
    await addBudget(page, { category: "Groceries", limit: "500" });
    await createTransaction(page, {
      description: uniqueName("Shop"),
      amount: "100.00",
      category: "Groceries",
    });
    await createTransaction(page, {
      description: uniqueName("Refund"),
      amount: "80.00",
      category: "Groceries",
      isIncome: true,
    });

    await page.goto("/budgets");
    const card = budgetCard(page, "Groceries");
    await expect(card.getByText("100.00 PLN")).toBeVisible();
    await expect(card.getByText("400.00 PLN")).toBeVisible();
  });
});
