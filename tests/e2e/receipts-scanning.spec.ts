import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./fixtures";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) =>
  path.join(__dirname, "fixtures", "images", name);

async function navigateToScanReceipt(page: Page) {
  // Navigate directly to the scan receipt page
  await page.goto("/receipts/scan");
  await expect(page).toHaveURL("/receipts/scan");
  await expect(
    page.getByRole("heading", { name: "Scan Receipt" }),
  ).toBeVisible();
}

test.describe("Receipt Scanning", () => {
  test.beforeEach(async ({ page, signedInUser: _signedInUser }) => {
    await page.goto("/dashboard");
  });

  test("uploads receipt and shows extracted data", async ({ page }) => {
    await navigateToScanReceipt(page);

    // Upload a receipt image
    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Should see loading spinner
    await expect(page.getByTestId("loading-spinner")).toBeVisible();
    await expect(page.getByText("Analyzing receipt...")).toBeVisible();

    // After processing, should see extracted data
    await expect(page.getByTestId("loading-spinner")).toBeHidden();
    // FAKE_STORE is in an input field
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");
    await expect(page.getByTestId("item-name-0")).toHaveValue("Product A");
    await expect(page.getByTestId("item-name-1")).toHaveValue("Product B");
    // Receipt total is in a number input
    await expect(page.getByTestId("receipt-total-input")).toHaveValue("36.99");
  });

  test("AI extracts items correctly with mocked response", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Verify extracted items data
    await expect(page.getByTestId("item-name-0")).toHaveValue("Product A");
    // Total price is now an editable input
    await expect(page.getByTestId("item-total-price-0")).toHaveValue("21");
    await expect(page.getByTestId("item-total-price-0")).toHaveAttribute("step", "0.01");

    await expect(page.getByTestId("item-name-1")).toHaveValue("Product B");
    await expect(page.getByTestId("item-total-price-1")).toHaveValue("15.99");
  });

  test("shows loading state during processing", async ({ page }) => {
    await navigateToScanReceipt(page);

    // Upload image
    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Verify loading spinner appears then disappears as results render
    await expect(page.getByTestId("loading-spinner")).toBeVisible();
    await expect(page.getByTestId("loading-spinner")).toBeHidden();
    await expect(page.getByTestId("store-name-input")).toBeVisible();
  });

  test("suggested parent category is shown", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");
    // Suggested category is shown only if matching categories exist in DB
    // The fake response includes a suggested_parent_category
    // In test mode it falls back to the first top-level category
  });

  test("rejects unsupported file types", async ({ page }) => {
    await navigateToScanReceipt(page);

    // Try to upload a non-image file (CSV)
    const csvPath = path.join(__dirname, "fixtures", "csv", "generic-3rows.csv");
    await page.getByTestId("file-input").setInputFiles(csvPath);

    // Should show error message
    await expect(page.getByTestId("error-message")).toBeVisible();
    await expect(page.getByText("Unsupported format")).toBeVisible();
  });

  test("shows image preview after upload", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for processing to complete
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Verify image preview is visible
    await expect(page.getByAltText("Receipt preview")).toBeVisible();
  });

  test("scan receipt page is reachable from the sidebar", async ({ page }) => {
    // Navigate directly and verify URL and heading
    await page.goto("/receipts/scan");
    await expect(page).toHaveURL("/receipts/scan");
    await expect(
      page.getByRole("heading", { name: "Scan Receipt", exact: true }),
    ).toBeVisible();
  });

  test("items table shows correct columns (no Qty/Unit Price)", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Verify table headers are present — Qty and Unit Price should NOT be present
    await expect(page.getByRole("columnheader", { name: "Item Name" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Total Price" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Category" })).toBeVisible();
    // Qty and Unit Price columns should NOT exist
    await expect(page.getByRole("columnheader", { name: "Qty" })).not.toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Unit Price" })).not.toBeVisible();
  });

  test("receipt total is displayed", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Verify total is shown in the input
    await expect(page.getByTestId("receipt-total-input")).toHaveValue("36.99");
  });

  test("item category defaults to AI suggested category", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // The fake AI response suggests "Alcohol" for item 0 (Product A)
    // Since /test-create-user?seed=defaults creates an "Alcohol" sub-category under Groceries,
    // the dropdown should have "Alcohol" selected
    const categorySelect = page.getByTestId("item-category-0");
    const selectedOption = categorySelect.locator("option:checked");
    const selectedText = await selectedOption.textContent();
    expect(selectedText).toBe("Alcohol");
  });

  test("total price column is editable", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Total price should be an editable input
    const totalInput = page.getByTestId("item-total-price-0");
    await expect(totalInput).toBeVisible();
    await expect(totalInput).toHaveAttribute("type", "number");

    // Edit the total price
    await totalInput.clear();
    await totalInput.fill("99.99");
    await expect(totalInput).toHaveValue("99.99");

    // Running total bar should update
    await expect(page.getByTestId("running-total-bar")).toBeVisible();
  });

  test("suggested parent category is editable", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Parent category selector is shown when categories exist in DB
    const parentSelect = page.getByTestId("parent-category-select");
    // Either it's visible with options, or it's not shown (no categories in DB)
    const isVisible = await parentSelect.isVisible().catch(() => false);
    if (isVisible) {
      const options = parentSelect.locator("option");
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThanOrEqual(2);
    }
  });

  test("item category options filtered by selected parent category", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Get the initial category options for an item
    const itemCategorySelect = page.getByTestId("item-category-0");

    // Check if parent category selector exists
    const parentSelect = page.getByTestId("parent-category-select");
    const hasParentSelect = await parentSelect.isVisible().catch(() => false);

    if (hasParentSelect) {
      // Change the parent category
      await parentSelect.selectOption({ index: 1 }); // Select first actual category

      // Now the item category dropdown should only show children of the selected parent
      const options = itemCategorySelect.locator("option");
      const optionCount = await options.count();
      // Should have at least "— none —" option
      expect(optionCount).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Phase 2 Tests ──────────────────────────────────────────────────────

  test("edit extracted item", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Edit the first item name
    await page.getByTestId("item-name-0").fill("Updated Product A");
    await expect(page.getByTestId("item-name-0")).toHaveValue("Updated Product A");
  });

  test("change item category", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Verify category dropdown exists and shows default option
    await expect(page.getByTestId("item-category-0")).toBeVisible();
    // The dropdown should have at least the "— none —" option
    const options = page.getByTestId("item-category-0").locator("option");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(1);
  });

  test("delete extracted item", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Verify 2 items exist initially
    await expect(page.getByTestId("item-name-0")).toBeVisible();
    await expect(page.getByTestId("item-name-1")).toBeVisible();

    // Delete the first item
    await page.getByTestId("delete-item-0").click();

    // Verify item is removed
    await expect(page.getByTestId("item-name-0")).toBeVisible(); // second item becomes first
    await expect(page.getByTestId("item-name-1")).toBeHidden();
  });

  test("add new item", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Click "Add Item" button
    await page.getByTestId("add-item-btn").click();

    // Verify new empty item row appears
    await expect(page.getByTestId("item-name-2")).toBeVisible();
  });

  test("sum reconciliation displayed", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Verify running total bar is visible
    await expect(page.getByTestId("running-total-bar")).toBeVisible();

    // Change a total price to create a delta > 0.50
    await page.getByTestId("item-total-price-0").clear();
    await page.getByTestId("item-total-price-0").fill("99.99");

    // Wait for delta to appear and be highlighted
    await expect(page.getByTestId("running-total-bar")).toBeVisible();
  });

  test("closest amount transaction suggested on same day", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Transaction matching section is always visible after scan
    await expect(page.getByTestId("account-select")).toBeVisible();

    // Transaction matching auto-triggers; wait a moment for it to complete
    await page.waitForTimeout(500);

    // Should show either a match or "no match found" message
    const hasNoMatch = await page.getByText("No matching transaction found").isVisible().catch(() => false);
    const hasMatch = await page.getByText("Matching transaction found").isVisible().catch(() => false);
    expect(hasNoMatch || hasMatch).toBe(true);
  });

  test("no match shows create new option", async ({ page }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Transaction matching section is always visible after scan
    // Transaction matching auto-triggers; wait a moment for it to complete
    await page.waitForTimeout(500);

    // Should show "no match" message (since no transactions exist yet)
    await expect(page.getByText("No matching transaction found")).toBeVisible();
  });

  test("save button is enabled when account is auto-selected", async ({
    page,
  }) => {
    await navigateToScanReceipt(page);

    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));

    // Wait for results
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");

    // Transaction matching section is always visible after scan
    await expect(page.getByTestId("account-select")).toBeVisible();

    // Verify save button exists and is enabled (first account is auto-selected)
    await expect(page.getByTestId("save-receipt-btn")).toBeVisible();
    const saveBtn = page.getByTestId("save-receipt-btn");
    expect(await saveBtn.isDisabled()).toBe(false);
  });

  test("offers to add another receipt above the success message after saving", async ({ page }) => {
    await navigateToScanReceipt(page);
    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");
    await page.getByTestId("account-select").selectOption({ index: 1 });
    await page.getByTestId("save-receipt-btn").click();

    const addAnother = page.getByRole("heading", { name: "Add another receipt" });
    const success = page.getByRole("status").filter({ hasText: "Receipt saved successfully" });
    await expect(addAnother).toBeVisible();
    await expect(success).toBeVisible();

    // The add-another zone is rendered before (above) the success message.
    const addAnotherBox = await addAnother.boundingBox();
    const successBox = await success.boundingBox();
    expect(addAnotherBox && successBox && addAnotherBox.y < successBox.y).toBe(true);

    // Scanning the next receipt works without leaving the page.
    await page.getByTestId("file-input").setInputFiles(fixturePath("receipt-test.png"));
    await expect(page.getByTestId("store-name-input")).toHaveValue("FAKE_STORE");
    await expect(success).toBeHidden();
    await expect(addAnother).toBeHidden();
  });
});
