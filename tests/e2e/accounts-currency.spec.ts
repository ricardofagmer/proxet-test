import { test, expect } from "./fixtures";

// Currency is picked from a list of supported ISO codes (with flags) instead
// of being typed, so an account can never get an invalid currency.

test.describe("Account currency picker", () => {
  test("creates an account with a currency chosen from the dropdown", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const accountName = `Euro Savings ${Date.now()}`;
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Add Account" }).click();

    const dialog = page.getByRole("dialog", { name: "Add Account" });
    await dialog.getByLabel("Account Name").fill(accountName);

    const currency = dialog.getByLabel("Currency");
    // A dropdown, not a free-text field, defaulting to PLN.
    await expect(currency).toHaveJSProperty("tagName", "SELECT");
    await expect(currency).toHaveValue("PLN");
    await expect(currency.locator("option[value='EUR']")).toHaveText(/EUR — Euro/);

    await currency.selectOption("EUR");
    await dialog.getByRole("button", { name: "Create Account" }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator("div").filter({ hasText: accountName }).last();
    await expect(row.getByText("EUR", { exact: true })).toBeVisible();
  });

  test("keeps the current currency when editing an account", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    const accountName = `Dollar Account ${Date.now()}`;
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Add Account" }).click();
    const createDialog = page.getByRole("dialog", { name: "Add Account" });
    await createDialog.getByLabel("Account Name").fill(accountName);
    await createDialog.getByLabel("Currency").selectOption("USD");
    await createDialog.getByRole("button", { name: "Create Account" }).click();
    await expect(createDialog).toBeHidden();

    const row = page.locator("div").filter({ hasText: accountName }).last();
    await row.getByTestId("edit-account").click();
    const editDialog = page.getByRole("dialog", { name: "Edit" });
    await expect(editDialog.getByLabel("Currency")).toHaveValue("USD");
  });
});
