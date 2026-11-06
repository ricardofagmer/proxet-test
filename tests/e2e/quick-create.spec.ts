import { test, expect, type Page } from "./fixtures";

//
// Quick-create: the Add budget and transaction modals can create a category
// (and, for transactions, an account) in a nested dialog, then select it
// without closing the parent modal. Every test runs as a fresh
// `signedInUser` (seeded default categories such as "Groceries" and a "Main"
// PLN account on the free plan, which allows 2 accounts).

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function openAddBudgetDialog(page: Page) {
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Add budget" }).click();
  const dialog = page.getByRole("dialog", { name: "Add budget" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openNewTransactionDialog(page: Page) {
  await page.goto("/transactions");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Add Transaction" })
    .click();
  const dialog = page.getByRole("dialog", { name: "New Transaction" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Quick-create from the Add budget modal", () => {
  test("creates a category, selects it and keeps the entered limit", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const categoryName = uniqueName("Quick Budget Cat");
    const budgetDialog = await openAddBudgetDialog(page);
    await budgetDialog.getByLabel("Monthly limit").fill("250");

    await budgetDialog.getByRole("button", { name: "New category" }).click();
    const categoryDialog = page.getByRole("dialog", { name: "New category" });
    await expect(categoryDialog).toBeVisible();
    await categoryDialog
      .getByLabel("Name", { exact: true })
      .fill(categoryName);
    await categoryDialog
      .getByLabel("Parent Category")
      .selectOption({ label: "Groceries" });
    await categoryDialog
      .getByRole("button", { name: "Create Category" })
      .click();

    await expect(categoryDialog).toBeHidden();
    await expect(budgetDialog).toBeVisible();
    await expect(
      budgetDialog.getByLabel("Category").locator("option:checked"),
    ).toContainText(categoryName);
    await expect(budgetDialog.getByLabel("Monthly limit")).toHaveValue("250");

    await budgetDialog.getByRole("button", { name: "Save budget" }).click();
    await expect(budgetDialog).toBeHidden();
    await expect(
      page.getByRole("article", { name: categoryName, exact: true }),
    ).toBeVisible();
  });

  test("shows a validation error in the nested dialog and Escape closes only it", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const budgetDialog = await openAddBudgetDialog(page);
    await budgetDialog.getByLabel("Monthly limit").fill("125");

    await budgetDialog.getByRole("button", { name: "New category" }).click();
    const categoryDialog = page.getByRole("dialog", { name: "New category" });
    await expect(categoryDialog).toBeVisible();
    await categoryDialog
      .getByRole("button", { name: "Create Category" })
      .click();

    await expect(
      categoryDialog.getByRole("alert").filter({ hasText: "Name is required" }),
    ).toBeVisible();
    await expect(categoryDialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(categoryDialog).toBeHidden();
    await expect(budgetDialog).toBeVisible();
    await expect(budgetDialog.getByLabel("Monthly limit")).toHaveValue("125");
    await expect(
      budgetDialog.getByLabel("Category").locator("option:checked"),
    ).toHaveText("Select a category");
  });
});

test.describe("Quick-create from the transaction modal", () => {
  test("creates a category and an account, selects both and saves the transaction", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const categoryName = uniqueName("Quick Tx Cat");
    const accountName = uniqueName("Quick Tx Acc");
    const description = uniqueName("Quick Tx");
    const txDialog = await openNewTransactionDialog(page);
    await txDialog.getByLabel("Date").fill(`${todayUtc()}T12:00`);
    await txDialog.getByLabel("Description").fill(description);
    await txDialog
      .getByRole("spinbutton", { name: "Amount", exact: true })
      .fill("42.50");

    await txDialog.getByRole("button", { name: "New category" }).click();
    const categoryDialog = page.getByRole("dialog", { name: "New category" });
    await expect(categoryDialog).toBeVisible();
    await categoryDialog
      .getByLabel("Name", { exact: true })
      .fill(categoryName);
    await categoryDialog
      .getByRole("button", { name: "Create Category" })
      .click();
    await expect(categoryDialog).toBeHidden();
    await expect(txDialog).toBeVisible();
    await expect(
      txDialog.getByLabel("Category").locator("option:checked"),
    ).toHaveText(categoryName);

    await txDialog.getByRole("button", { name: "New account" }).click();
    const accountDialog = page.getByRole("dialog", { name: "New account" });
    await expect(accountDialog).toBeVisible();
    await accountDialog.getByLabel("Account Name").fill(accountName);
    await accountDialog.getByLabel("Bank").fill("Quick Bank");
    await accountDialog.getByLabel("Currency").selectOption("EUR");
    await accountDialog
      .getByRole("button", { name: "Create Account" })
      .click();
    await expect(accountDialog).toBeHidden();
    await expect(txDialog).toBeVisible();
    await expect(
      txDialog.getByLabel("Account").locator("option:checked"),
    ).toHaveText(`${accountName} (EUR)`);

    // The rest of the form survived both nested dialogs.
    await expect(txDialog.getByLabel("Description")).toHaveValue(description);
    await expect(
      txDialog.getByLabel("Category").locator("option:checked"),
    ).toHaveText(categoryName);

    await txDialog.getByRole("button", { name: "Create Transaction" }).click();
    await expect(txDialog).toBeHidden();
    await expect(page.getByRole("table").getByText(description)).toBeVisible();
  });

  test("shows validation errors in the nested dialogs without touching the transaction form", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const description = uniqueName("Quick Tx Invalid");
    const txDialog = await openNewTransactionDialog(page);
    await txDialog.getByLabel("Description").fill(description);

    await txDialog.getByRole("button", { name: "New category" }).click();
    const categoryDialog = page.getByRole("dialog", { name: "New category" });
    await categoryDialog.getByLabel("Name", { exact: true }).fill("   ");
    await categoryDialog
      .getByRole("button", { name: "Create Category" })
      .click();
    await expect(
      categoryDialog.getByRole("alert").filter({ hasText: "Name is required" }),
    ).toBeVisible();
    await categoryDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(categoryDialog).toBeHidden();

    await txDialog.getByRole("button", { name: "New account" }).click();
    const accountDialog = page.getByRole("dialog", { name: "New account" });
    await accountDialog
      .getByRole("button", { name: "Create Account" })
      .click();
    await expect(
      accountDialog
        .getByRole("alert")
        .filter({ hasText: "Account name is required" }),
    ).toBeVisible();
    await accountDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(accountDialog).toBeHidden();

    // Submitting a nested form never submitted the transaction form.
    await expect(txDialog).toBeVisible();
    await expect(txDialog.getByLabel("Description")).toHaveValue(description);
    await expect(txDialog.getByRole("alert")).toHaveCount(0);
  });

  test("shows the free-plan account limit inside the nested dialog", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const secondAccount = uniqueName("Quick Second");
    const thirdAccount = uniqueName("Quick Third");
    const txDialog = await openNewTransactionDialog(page);

    // The fixture seeds "Main", so one more account fits the free plan.
    await txDialog.getByRole("button", { name: "New account" }).click();
    const accountDialog = page.getByRole("dialog", { name: "New account" });
    await accountDialog.getByLabel("Account Name").fill(secondAccount);
    await accountDialog
      .getByRole("button", { name: "Create Account" })
      .click();
    await expect(accountDialog).toBeHidden();
    await expect(
      txDialog.getByLabel("Account").locator("option:checked"),
    ).toHaveText(`${secondAccount} (PLN)`);

    await txDialog.getByRole("button", { name: "New account" }).click();
    await expect(accountDialog).toBeVisible();
    await accountDialog.getByLabel("Account Name").fill(thirdAccount);
    await accountDialog
      .getByRole("button", { name: "Create Account" })
      .click();
    await expect(
      accountDialog
        .getByRole("alert")
        .filter({ hasText: /free plan is limited to 2 accounts/i }),
    ).toBeVisible();
    await expect(accountDialog).toBeVisible();

    await accountDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(accountDialog).toBeHidden();
    await expect(
      txDialog.getByLabel("Account").locator("option:checked"),
    ).toHaveText(`${secondAccount} (PLN)`);
    await expect(
      txDialog.getByLabel("Account").getByRole("option", { name: thirdAccount }),
    ).toHaveCount(0);
  });
});
