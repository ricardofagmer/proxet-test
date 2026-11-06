import { test, expect, type Page } from "./fixtures";
import type { APIRequestContext } from "@playwright/test";

//
// Over-budget email: going over a category budget sends exactly one email per
// budget per month. Inline evaluation is fire-and-forget, so delivery is
// observed by polling /test-emails; /test-run-sweep (TEST_MODE only) runs the
// hourly sweep on demand to prove repeated evaluations never send a second
// email. Spend is dated today so it lands in the current UTC month.

type CapturedEmail = { to: string; subject: string; text: string };

// Top-level seeded category (see src/server/seed.ts).
const CATEGORY = "Entertainment";
const ACCOUNT_LABEL = "Main (PLN)";

async function budgetEmails(
  request: APIRequestContext,
  to: string,
): Promise<CapturedEmail[]> {
  const res = await request.get(`/test-emails?to=${encodeURIComponent(to)}`);
  expect(res.ok()).toBeTruthy();
  const { emails } = (await res.json()) as { emails: CapturedEmail[] };
  return emails.filter(
    (email) => email.subject.includes("budget") && email.subject.includes(CATEGORY),
  );
}

async function runSweep(request: APIRequestContext): Promise<void> {
  const res = await request.post("/test-run-sweep");
  expect(res.ok()).toBeTruthy();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function createBudget(page: Page, limit: string): Promise<void> {
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Add budget" }).click();
  await page.getByLabel("Category").selectOption({ label: CATEGORY });
  await page.getByLabel("Monthly limit").fill(limit);
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByRole("article", { name: CATEGORY })).toBeVisible();
}

async function addExpense(
  page: Page,
  opts: { description: string; amount: string },
): Promise<void> {
  await page.goto("/transactions");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Add Transaction" })
    .click();
  const modal = page.getByRole("dialog", { name: "New Transaction" });
  // Midday keeps the date inside today's UTC month regardless of runner TZ.
  await modal.getByLabel("Date").fill(`${todayUtc()}T12:00`);
  await modal.getByLabel("Description").fill(opts.description);
  await modal
    .getByRole("spinbutton", { name: "Amount", exact: true })
    .fill(opts.amount);
  await modal.getByLabel("Account").selectOption(ACCOUNT_LABEL);
  await modal.getByLabel("Category").selectOption({ label: CATEGORY });
  await modal.getByRole("button", { name: "Create Transaction" }).click();
  await expect(
    page.getByRole("heading", { name: "New Transaction" }),
  ).toBeHidden();
}

test.describe("Over-budget alerts", () => {
  test("sends exactly one email when spending goes over a budget", async ({
    page,
    signedInUser,
  }) => {
    const email = `${signedInUser.username}@example.com`;
    await createBudget(page, "10");

    await addExpense(page, { description: "Concert tickets", amount: "15.00" });

    // Inline evaluation runs after the mutation responds; poll for delivery.
    await expect
      .poll(async () => (await budgetEmails(page.request, email)).length)
      .toBe(1);
    const [alert] = await budgetEmails(page.request, email);
    expect(alert.subject).toContain(CATEGORY);
    expect(alert.text).toContain("10.00 PLN");
    expect(alert.text).toContain("15.00 PLN");
    expect(alert.text).toContain("/budgets");

    await page.goto("/budgets");
    const card = page.getByRole("article", { name: CATEGORY });
    await expect(card).toBeVisible();
    await expect(card.getByText("Over budget")).toBeVisible();

    // The sweep re-evaluates the same month: still one email.
    await runSweep(page.request);
    expect(await budgetEmails(page.request, email)).toHaveLength(1);

    // Spending further in the same month never sends a second email.
    await addExpense(page, { description: "Cinema", amount: "20.00" });
    await runSweep(page.request);
    expect(await budgetEmails(page.request, email)).toHaveLength(1);
  });

  test("sends nothing while spending stays within the budget", async ({
    page,
    signedInUser,
  }) => {
    const email = `${signedInUser.username}@example.com`;
    await createBudget(page, "10");

    await addExpense(page, { description: "Board game", amount: "10.00" });
    await runSweep(page.request);

    expect(await budgetEmails(page.request, email)).toHaveLength(0);
    await page.goto("/budgets");
    const card = page.getByRole("article", { name: CATEGORY });
    await expect(card).toBeVisible();
    await expect(card.getByText("Over budget")).toBeHidden();
  });

  test("reports budget-alert counts from the sweep route", async ({
    page,
  }) => {
    const res = await page.request.post("/test-run-sweep");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      deletedUsers: number;
      purgedAiResponses: number;
      budgetAlerts: { users: number; sent: number; failed: number };
    };
    expect(typeof body.deletedUsers).toBe("number");
    expect(typeof body.purgedAiResponses).toBe("number");
    expect(typeof body.budgetAlerts.users).toBe("number");
    expect(typeof body.budgetAlerts.sent).toBe("number");
  });
});
