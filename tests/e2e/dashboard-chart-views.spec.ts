import { test, expect, type Page } from "./fixtures";

//
// Dashboard "Spending by category" card: the chart-type dropdown switches
// between six views of the same data, defaults to horizontal bars, and the
// choice survives a reload. Every test runs as a fresh `signedInUser` with
// the seeded default categories and the "Main" PLN account, and seeds its
// own uniquely named transactions, so parallel tests never share data.

/** Today in UTC; midday keeps the date inside the current month in any timezone. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createExpense(
  page: Page,
  opts: { description: string; amount: string; category: string },
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
  await modal.getByLabel("Account").selectOption("Main (PLN)");
  await modal.getByLabel("Category").selectOption({ label: opts.category });
  await modal.getByRole("button", { name: "Create Transaction" }).click();
  await expect(modal).toBeHidden();
  await expect(
    page.getByRole("table").getByText(opts.description),
  ).toBeVisible();
}

function chartTypeSelect(page: Page) {
  return page.getByRole("combobox", { name: "Chart type" });
}

function chartFigure(page: Page, view: string) {
  return page.getByRole("figure", {
    name: `Spending by category, ${view} view`,
  });
}

test.describe("Dashboard chart views", () => {
  test.beforeEach(async ({ page, signedInUser: _signedInUser }) => {
    await createExpense(page, {
      description: uniqueName("Chart groceries"),
      amount: "120.50",
      category: "Groceries",
    });
    await createExpense(page, {
      description: uniqueName("Chart transport"),
      amount: "45.00",
      category: "Transport",
    });
    await page.goto("/dashboard");
    await expect(chartTypeSelect(page)).toBeVisible();
  });

  test("defaults to the horizontal bar chart", async ({ page }) => {
    await expect(chartTypeSelect(page)).toHaveValue("bars");
    await expect(chartFigure(page, "Bars")).toBeVisible();
  });

  test("offers six chart types", async ({ page }) => {
    await expect(chartTypeSelect(page).getByRole("option")).toHaveText([
      "Bars",
      "Columns",
      "Donut",
      "Pie",
      "Treemap",
      "Table",
    ]);
  });

  test("switches to the column chart", async ({ page }) => {
    await chartTypeSelect(page).selectOption({ label: "Columns" });
    await expect(chartFigure(page, "Columns")).toBeVisible();
    await expect(chartFigure(page, "Bars")).toHaveCount(0);
  });

  test("switches to the donut chart with the total in the centre", async ({
    page,
  }) => {
    await chartTypeSelect(page).selectOption({ label: "Donut" });
    const figure = chartFigure(page, "Donut");
    await expect(figure).toBeVisible();
    await expect(figure.getByText("Total spent")).toBeVisible();
    await expect(figure.getByText("165.50 PLN")).toBeVisible();
    await expect(
      figure.getByRole("list", { name: "Categories" }).getByText("Groceries"),
    ).toBeVisible();
  });

  test("switches to the pie chart with a legend", async ({ page }) => {
    await chartTypeSelect(page).selectOption({ label: "Pie" });
    const figure = chartFigure(page, "Pie");
    await expect(figure).toBeVisible();
    const legend = figure.getByRole("list", { name: "Categories" });
    await expect(legend.getByRole("listitem")).toHaveCount(2);
    await expect(legend.getByText("Transport")).toBeVisible();
    await expect(figure.getByText("Total spent")).toHaveCount(0);
  });

  test("switches to the treemap", async ({ page }) => {
    await chartTypeSelect(page).selectOption({ label: "Treemap" });
    await expect(chartFigure(page, "Treemap")).toBeVisible();
  });

  test("switches to an accessible table of categories", async ({ page }) => {
    await chartTypeSelect(page).selectOption({ label: "Table" });
    const table = chartFigure(page, "Table").getByRole("table");
    await expect(table).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Category" }),
    ).toBeVisible();
    const groceriesRow = table.getByRole("row", { name: /Groceries/ });
    await expect(groceriesRow).toBeVisible();
    await expect(groceriesRow).toContainText("120.50 PLN");
  });

  test("remembers the chosen view across a reload", async ({ page }) => {
    await chartTypeSelect(page).selectOption({ label: "Table" });
    await expect(chartFigure(page, "Table")).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(chartTypeSelect(page)).toHaveValue("table");
    await expect(chartFigure(page, "Table").getByRole("table")).toBeVisible();
  });
});
