import { test, expect, type Page } from "./fixtures";

//
// Dashboard "Spending by category" drill-down: selecting a category opens a
// dialog listing the expenses behind it (subcategories included, income
// never), with a total that matches the chart. Also covers the currency label
// following the accounts' currency. Every test runs as a fresh `signedInUser`
// with the seeded default categories and the "Main" PLN account, and seeds its
// own uniquely named transactions, so parallel tests never share data.

/** Today in UTC; midday keeps the date inside the current month in any timezone. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTransaction(
  page: Page,
  opts: {
    description: string;
    amount: string;
    category: string;
    account?: string;
    isIncome?: boolean;
  },
): Promise<void> {
  await page.goto("/transactions");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Add Transaction" })
    .click();
  const modal = page.getByRole("dialog", { name: "New Transaction" });
  await modal.getByLabel("Date").fill(`${todayUtc()}T12:00`);
  await modal.getByLabel("Description").fill(opts.description);
  await modal
    .getByRole("spinbutton", { name: "Amount", exact: true })
    .fill(opts.amount);
  await modal.getByLabel("Account").selectOption(opts.account ?? "Main (PLN)");
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

function chartFigure(page: Page, view: string) {
  return page.getByRole("figure", {
    name: `Spending by category, ${view} view`,
  });
}

function categoryButton(page: Page, view: string, category: string) {
  return chartFigure(page, view).getByRole("button", {
    name: `Show expenses for ${category}`,
  });
}

test.describe("Dashboard category drill-down", () => {
  let shop = "";
  let veg = "";
  let refund = "";

  test.beforeEach(async ({ page, signedInUser: _signedInUser }) => {
    shop = uniqueName("Drill shop");
    veg = uniqueName("Drill veg");
    refund = uniqueName("Drill refund");
    await createTransaction(page, { description: shop, amount: "100.00", category: "Groceries" });
    // A subcategory expense rolls up into its parent category.
    await createTransaction(page, { description: veg, amount: "65.50", category: "— Vegetables" });
    await createTransaction(page, {
      description: refund,
      amount: "80.00",
      category: "Groceries",
      isIncome: true,
    });
    await page.goto("/dashboard");
    await expect(chartFigure(page, "Bars")).toBeVisible();
  });

  test("clicking a bar lists only that category's expenses with the chart's total", async ({
    page,
  }) => {
    await expect(chartFigure(page, "Bars").getByText("165.50 PLN · 100%")).toBeVisible();

    await categoryButton(page, "Bars", "Groceries").click();

    const dialog = page.getByRole("dialog", { name: "Groceries" });
    await expect(dialog).toBeVisible();
    const rows = dialog.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(3); // header + two expenses
    await expect(dialog.getByRole("row", { name: new RegExp(shop) })).toContainText("100.00 PLN");
    const vegRow = dialog.getByRole("row", { name: new RegExp(veg) });
    await expect(vegRow).toContainText("Vegetables");
    await expect(vegRow).toContainText("65.50 PLN");
    await expect(dialog.getByText(refund)).toHaveCount(0);

    await expect(dialog.getByLabel("Total", { exact: true })).toHaveText("165.50 PLN");
    await expect(dialog.getByLabel("Expenses", { exact: true })).toHaveText("2");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("opens from the keyboard and closes with the Close button", async ({ page }) => {
    const bar = categoryButton(page, "Bars", "Groceries");
    await bar.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Groceries" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Total", { exact: true })).toHaveText("165.50 PLN");

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(bar).toBeFocused();
  });

  test("opens from a table row", async ({ page }) => {
    await page.getByRole("combobox", { name: "Chart type" }).selectOption({ label: "Table" });
    await categoryButton(page, "Table", "Groceries").click();

    const dialog = page.getByRole("dialog", { name: "Groceries" });
    await expect(dialog.getByRole("table").getByRole("row")).toHaveCount(3);
    await expect(dialog.getByLabel("Total", { exact: true })).toHaveText("165.50 PLN");
  });
});

test.describe("Dashboard currency label", () => {
  test("shows the filtered account's currency instead of PLN", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const accountName = uniqueName("Euro wallet");
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Add Account" }).click();
    const accountDialog = page.getByRole("dialog", { name: "Add Account" });
    await accountDialog.getByLabel("Account Name").fill(accountName);
    await accountDialog.getByLabel("Currency").selectOption("EUR");
    await accountDialog.getByRole("button", { name: "Create Account" }).click();
    await expect(accountDialog).toBeHidden();

    await createTransaction(page, {
      description: uniqueName("Euro coffee"),
      amount: "12.00",
      category: "Groceries",
      account: `${accountName} (EUR)`,
    });

    await page.goto("/dashboard");
    await page
      .getByRole("combobox", { name: "Account" })
      .selectOption({ label: accountName });

    const figure = chartFigure(page, "Bars");
    await expect(figure.getByText("12.00 EUR · 100%")).toBeVisible();
    await expect(figure.getByText(/PLN/)).toHaveCount(0);

    await categoryButton(page, "Bars", "Groceries").click();
    const dialog = page.getByRole("dialog", { name: "Groceries" });
    await expect(dialog.getByLabel("Total", { exact: true })).toHaveText("12.00 EUR");
  });
});
