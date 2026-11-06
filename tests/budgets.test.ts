// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "#/db";
import {
  computeBudgetSpend,
  currentUtcMonth,
  listBudgetViews,
  monthRange,
  monthSchema,
} from "#/server/budgets.server";
import { checkBudgetLimit } from "#/server/billing.server";
import { env } from "#/server/env";

const USER_ID = "budgets-test-user";
const OTHER_USER_ID = "budgets-test-other-user";
const ALL_USER_IDS = [USER_ID, OTHER_USER_ID];
const MONTH = "2026-03";

interface CategorySeed {
  id: string;
  name: string;
  parentId?: string | null;
  userId?: string;
}

interface AccountSeed {
  id: string;
  currency: string | null;
  userId?: string;
}

interface TransactionSeed {
  id: string;
  accountId: string;
  amountMinor: number;
  categoryId: string | null;
  date?: string;
  userId?: string;
}

interface BudgetSeed {
  id: string;
  categoryId: string;
  limitMinor: number;
  currency?: string;
  userId?: string;
}

async function insertUser(id: string): Promise<void> {
  await db.insert(schema.users).values({ id, username: id, password_hash: "x" });
}

async function insertCategory(seed: CategorySeed): Promise<void> {
  await db.insert(schema.categories).values({
    id: seed.id,
    user_id: seed.userId ?? USER_ID,
    name: seed.name,
    parent_id: seed.parentId ?? null,
  });
}

async function insertAccount(seed: AccountSeed): Promise<void> {
  await db.insert(schema.accounts).values({
    id: seed.id,
    user_id: seed.userId ?? USER_ID,
    name: seed.id,
    currency: seed.currency,
  });
}

async function insertTransaction(seed: TransactionSeed): Promise<void> {
  await db.insert(schema.transactions).values({
    id: seed.id,
    user_id: seed.userId ?? USER_ID,
    account_id: seed.accountId,
    date: seed.date ?? `${MONTH}-15`,
    amount_minor: seed.amountMinor,
    category_id: seed.categoryId,
  });
}

async function insertBudget(seed: BudgetSeed): Promise<void> {
  await db.insert(schema.budgets).values({
    id: seed.id,
    user_id: seed.userId ?? USER_ID,
    category_id: seed.categoryId,
    currency: seed.currency ?? "PLN",
    limit_minor: seed.limitMinor,
  });
}

function budgetInput(
  id: string,
  categoryId: string,
  currency = "PLN",
): { id: string; category_id: string; currency: string } {
  return { id, category_id: categoryId, currency };
}

describe("budgets: month helpers", () => {
  it("monthRange is half-open and rolls December into the next year", () => {
    expect(monthRange("2026-03")).toEqual({
      start: "2026-03-01",
      end: "2026-04-01",
    });
    expect(monthRange("2026-09")).toEqual({
      start: "2026-09-01",
      end: "2026-10-01",
    });
    expect(monthRange("2026-12")).toEqual({
      start: "2026-12-01",
      end: "2027-01-01",
    });
  });

  it("currentUtcMonth uses the UTC calendar month, not the local one", () => {
    expect(currentUtcMonth(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12");
    expect(currentUtcMonth(new Date("2026-02-01T00:00:00Z"))).toBe("2026-02");
    // 00:30 on March 1st at UTC+2 is still February in UTC.
    expect(currentUtcMonth(new Date("2026-03-01T00:30:00+02:00"))).toBe(
      "2026-02",
    );
  });

  it("monthSchema accepts YYYY-MM only", () => {
    expect(monthSchema.safeParse("2026-01").success).toBe(true);
    expect(monthSchema.safeParse("2026-12").success).toBe(true);
    expect(monthSchema.safeParse("2026-13").success).toBe(false);
    expect(monthSchema.safeParse("2026-00").success).toBe(false);
    expect(monthSchema.safeParse("2026-1").success).toBe(false);
    expect(monthSchema.safeParse("2026-01-01").success).toBe(false);
  });
});

describe("budgets: spend aggregation and plan cap", () => {
  beforeEach(async () => {
    for (const id of ALL_USER_IDS) await insertUser(id);
  });

  afterEach(async () => {
    // Children first: there are no ON DELETE cascades.
    await db
      .delete(schema.budget_alerts)
      .where(inArray(schema.budget_alerts.user_id, ALL_USER_IDS));
    await db
      .delete(schema.budgets)
      .where(inArray(schema.budgets.user_id, ALL_USER_IDS));
    const receiptIds = db
      .select({ id: schema.receipts.id })
      .from(schema.receipts)
      .where(inArray(schema.receipts.user_id, ALL_USER_IDS));
    await db
      .delete(schema.receipt_items)
      .where(inArray(schema.receipt_items.receipt_id, receiptIds));
    await db
      .delete(schema.receipts)
      .where(inArray(schema.receipts.user_id, ALL_USER_IDS));
    await db
      .delete(schema.transactions)
      .where(inArray(schema.transactions.user_id, ALL_USER_IDS));
    await db
      .delete(schema.categories)
      .where(inArray(schema.categories.user_id, ALL_USER_IDS));
    await db
      .delete(schema.accounts)
      .where(inArray(schema.accounts.user_id, ALL_USER_IDS));
    await db
      .delete(schema.subscriptions)
      .where(inArray(schema.subscriptions.user_id, ALL_USER_IDS));
    await db.delete(schema.users).where(inArray(schema.users.id, ALL_USER_IDS));
  });

  it("rolls up spend over the whole subtree (parent > child > grandchild)", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-p", name: "Parent" });
    await insertCategory({ id: "bt-c1", name: "Child", parentId: "bt-p" });
    await insertCategory({ id: "bt-c2", name: "Grandchild", parentId: "bt-c1" });
    await insertCategory({ id: "bt-sibling", name: "Unrelated" });
    await insertTransaction({ id: "t-p", accountId: "bt-acc", amountMinor: -1000, categoryId: "bt-p" });
    await insertTransaction({ id: "t-c1", accountId: "bt-acc", amountMinor: -200, categoryId: "bt-c1" });
    await insertTransaction({ id: "t-c2", accountId: "bt-acc", amountMinor: -30, categoryId: "bt-c2" });
    await insertTransaction({ id: "t-sib", accountId: "bt-acc", amountMinor: -4, categoryId: "bt-sibling" });

    const spend = await computeBudgetSpend(
      USER_ID,
      MONTH,
      [
        budgetInput("b-p", "bt-p"),
        budgetInput("b-c1", "bt-c1"),
        budgetInput("b-c2", "bt-c2"),
      ],
      db,
    );

    expect(spend.get("b-p")).toBe(1230);
    expect(spend.get("b-c1")).toBe(230);
    expect(spend.get("b-c2")).toBe(30);
  });

  it("counts only expenses: income and refunds are ignored, not netted", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-p", name: "Parent" });
    await insertCategory({ id: "bt-c1", name: "Child", parentId: "bt-p" });
    await insertTransaction({ id: "t-exp", accountId: "bt-acc", amountMinor: -5000, categoryId: "bt-p" });
    await insertTransaction({ id: "t-refund", accountId: "bt-acc", amountMinor: 2000, categoryId: "bt-p" });
    await insertTransaction({ id: "t-income", accountId: "bt-acc", amountMinor: 900, categoryId: "bt-c1" });
    await insertTransaction({ id: "t-exp2", accountId: "bt-acc", amountMinor: -100, categoryId: "bt-c1" });

    const spend = await computeBudgetSpend(
      USER_ID,
      MONTH,
      [budgetInput("b-p", "bt-p")],
      db,
    );

    expect(spend.get("b-p")).toBe(5100);
  });

  it("includes the first and last day of the month and nothing outside it", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-p", name: "Parent" });
    await insertTransaction({ id: "t-prev-last", accountId: "bt-acc", amountMinor: -1, categoryId: "bt-p", date: "2026-02-28" });
    await insertTransaction({ id: "t-first", accountId: "bt-acc", amountMinor: -10, categoryId: "bt-p", date: "2026-03-01" });
    await insertTransaction({ id: "t-last", accountId: "bt-acc", amountMinor: -100, categoryId: "bt-p", date: "2026-03-31" });
    await insertTransaction({ id: "t-next-first", accountId: "bt-acc", amountMinor: -1000, categoryId: "bt-p", date: "2026-04-01" });

    const budgets = [budgetInput("b-p", "bt-p")];
    expect((await computeBudgetSpend(USER_ID, "2026-03", budgets, db)).get("b-p")).toBe(110);
    // The same rows seen from the neighbouring months: spend resets monthly.
    expect((await computeBudgetSpend(USER_ID, "2026-02", budgets, db)).get("b-p")).toBe(1);
    expect((await computeBudgetSpend(USER_ID, "2026-04", budgets, db)).get("b-p")).toBe(1000);
  });

  it("counts only accounts in the budget currency; a null currency counts as PLN", async () => {
    await insertAccount({ id: "bt-pln", currency: "PLN" });
    await insertAccount({ id: "bt-eur", currency: "EUR" });
    await insertAccount({ id: "bt-legacy", currency: null });
    await insertCategory({ id: "bt-p", name: "Parent" });
    await insertTransaction({ id: "t-pln", accountId: "bt-pln", amountMinor: -100, categoryId: "bt-p" });
    await insertTransaction({ id: "t-eur", accountId: "bt-eur", amountMinor: -7000, categoryId: "bt-p" });
    await insertTransaction({ id: "t-legacy", accountId: "bt-legacy", amountMinor: -20, categoryId: "bt-p" });

    const spend = await computeBudgetSpend(
      USER_ID,
      MONTH,
      [budgetInput("b-pln", "bt-p", "PLN"), budgetInput("b-eur", "bt-p", "EUR")],
      db,
    );

    expect(spend.get("b-pln")).toBe(120);
    expect(spend.get("b-eur")).toBe(7000);
  });

  it("excludes uncategorized transactions and ignores receipt item categories", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-p", name: "Parent" });
    await insertCategory({ id: "bt-other", name: "Other" });
    await insertTransaction({ id: "t-uncat", accountId: "bt-acc", amountMinor: -999, categoryId: null });
    await insertTransaction({ id: "t-other", accountId: "bt-acc", amountMinor: -500, categoryId: "bt-other" });
    // A receipt split onto the budgeted category must not move the spend:
    // only transactions.category_id counts.
    await db.insert(schema.receipts).values({
      id: "bt-rcpt",
      user_id: USER_ID,
      transaction_id: "t-other",
    });
    await db.insert(schema.receipt_items).values({
      id: "bt-item",
      receipt_id: "bt-rcpt",
      name: "Item",
      total_price_minor: 500,
      category_id: "bt-p",
    });

    const spend = await computeBudgetSpend(
      USER_ID,
      MONTH,
      [budgetInput("b-p", "bt-p")],
      db,
    );

    expect(spend.get("b-p")).toBe(0);
  });

  it("never counts another user's transactions", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-p", name: "Groceries" });
    await insertTransaction({ id: "t-mine", accountId: "bt-acc", amountMinor: -100, categoryId: "bt-p" });

    // Same category name, same currency, same month — different owner.
    await insertAccount({ id: "bt-other-acc", currency: "PLN", userId: OTHER_USER_ID });
    await insertCategory({ id: "bt-other-p", name: "Groceries", userId: OTHER_USER_ID });
    await insertCategory({
      id: "bt-other-child",
      name: "Vegetables",
      parentId: "bt-p",
      userId: OTHER_USER_ID,
    });
    await insertTransaction({ id: "t-theirs", accountId: "bt-other-acc", amountMinor: -40000, categoryId: "bt-other-p", userId: OTHER_USER_ID });
    // Even rows that point at this user's category ids stay out.
    await insertTransaction({ id: "t-theirs-on-mine", accountId: "bt-other-acc", amountMinor: -50000, categoryId: "bt-p", userId: OTHER_USER_ID });
    await insertTransaction({ id: "t-theirs-child", accountId: "bt-other-acc", amountMinor: -60000, categoryId: "bt-other-child", userId: OTHER_USER_ID });

    const spend = await computeBudgetSpend(
      USER_ID,
      MONTH,
      [budgetInput("b-p", "bt-p")],
      db,
    );

    expect(spend.get("b-p")).toBe(100);
  });

  it("terminates on a parent_id cycle and counts each category once", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-a", name: "A", parentId: "bt-b" });
    await insertCategory({ id: "bt-b", name: "B", parentId: "bt-a" });
    await insertTransaction({ id: "t-a", accountId: "bt-acc", amountMinor: -10, categoryId: "bt-a" });
    await insertTransaction({ id: "t-b", accountId: "bt-acc", amountMinor: -5, categoryId: "bt-b" });

    const spend = await computeBudgetSpend(
      USER_ID,
      MONTH,
      [budgetInput("b-a", "bt-a")],
      db,
    );

    expect(spend.get("b-a")).toBe(15);
  });

  it("returns zero for every budget when nothing was spent", async () => {
    await insertCategory({ id: "bt-p", name: "Parent" });

    const spend = await computeBudgetSpend(
      USER_ID,
      MONTH,
      [budgetInput("b-p", "bt-p")],
      db,
    );

    expect(spend.get("b-p")).toBe(0);
  });

  it("listBudgetViews: over_budget is strict and remaining can go negative", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-exact", name: "Exact" });
    await insertCategory({ id: "bt-over", name: "Over" });
    await insertTransaction({ id: "t-exact", accountId: "bt-acc", amountMinor: -5000, categoryId: "bt-exact" });
    await insertTransaction({ id: "t-over", accountId: "bt-acc", amountMinor: -5001, categoryId: "bt-over" });
    await insertBudget({ id: "b-exact", categoryId: "bt-exact", limitMinor: 5000 });
    await insertBudget({ id: "b-over", categoryId: "bt-over", limitMinor: 5000 });

    const views = await listBudgetViews(USER_ID, MONTH, db);

    expect(views.map((v) => v.category_name)).toEqual(["Exact", "Over"]);
    const [exact, over] = views;
    expect(exact).toMatchObject({
      id: "b-exact",
      limit_minor: 5000,
      spent_minor: 5000,
      remaining_minor: 0,
      over_budget: false,
    });
    expect(over).toMatchObject({
      id: "b-over",
      limit_minor: 5000,
      spent_minor: 5001,
      remaining_minor: -1,
      over_budget: true,
    });
  });

  it("listBudgetViews: overlapping parent and child budgets both count the child expense", async () => {
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    await insertCategory({ id: "bt-p", name: "Parent" });
    await insertCategory({ id: "bt-c1", name: "Child", parentId: "bt-p" });
    await insertTransaction({ id: "t-c1", accountId: "bt-acc", amountMinor: -700, categoryId: "bt-c1" });
    await insertBudget({ id: "b-p", categoryId: "bt-p", limitMinor: 1000 });
    await insertBudget({ id: "b-c1", categoryId: "bt-c1", limitMinor: 500 });

    const views = await listBudgetViews(USER_ID, MONTH, db);
    const byId = new Map(views.map((v) => [v.id, v]));

    expect(byId.get("b-p")?.spent_minor).toBe(700);
    expect(byId.get("b-p")?.over_budget).toBe(false);
    expect(byId.get("b-c1")?.spent_minor).toBe(700);
    expect(byId.get("b-c1")?.over_budget).toBe(true);
  });

  it("listBudgetViews never returns another user's budgets", async () => {
    await insertCategory({ id: "bt-p", name: "Groceries" });
    await insertCategory({ id: "bt-other-p", name: "Groceries", userId: OTHER_USER_ID });
    await insertBudget({ id: "b-mine", categoryId: "bt-p", limitMinor: 100 });
    await insertBudget({ id: "b-theirs", categoryId: "bt-other-p", limitMinor: 100, userId: OTHER_USER_ID });

    const views = await listBudgetViews(USER_ID, MONTH, db);

    expect(views.map((v) => v.id)).toEqual(["b-mine"]);
  });

  it("checkBudgetLimit: free allows freeMaxBudgets, then blocks", async () => {
    const max = env.billing.freeMaxBudgets;
    for (let i = 0; i < max; i++) {
      expect((await checkBudgetLimit(USER_ID, db)).allowed).toBe(true);
      await insertCategory({ id: `bt-cap-${i}`, name: `Cap ${i}` });
      await insertBudget({ id: `b-cap-${i}`, categoryId: `bt-cap-${i}`, limitMinor: 100 });
    }

    const blocked = await checkBudgetLimit(USER_ID, db);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.code).toBe("budget_limit_reached");
      expect(blocked.limit).toBe(max);
    }

    // Another user's budgets never count toward this user's cap.
    expect((await checkBudgetLimit(OTHER_USER_ID, db)).allowed).toBe(true);
  });

  it("checkBudgetLimit: pro is unlimited", async () => {
    await db.insert(schema.subscriptions).values({
      user_id: USER_ID,
      stripe_customer_id: `cus_${USER_ID}`,
      stripe_subscription_id: `sub_${USER_ID}`,
      plan: "pro",
      status: "active",
    });
    for (let i = 0; i < env.billing.freeMaxBudgets + 2; i++) {
      await insertCategory({ id: `bt-pro-${i}`, name: `Pro ${i}` });
      await insertBudget({ id: `b-pro-${i}`, categoryId: `bt-pro-${i}`, limitMinor: 100 });
    }

    expect(await checkBudgetLimit(USER_ID, db)).toEqual({ allowed: true });
  });

  it("downgrade keeps existing budgets working but blocks creating more", async () => {
    await db.insert(schema.subscriptions).values({
      user_id: USER_ID,
      stripe_customer_id: `cus_${USER_ID}`,
      stripe_subscription_id: `sub_${USER_ID}`,
      plan: "pro",
      status: "active",
    });
    await insertAccount({ id: "bt-acc", currency: "PLN" });
    const budgetCount = env.billing.freeMaxBudgets + 2;
    for (let i = 0; i < budgetCount; i++) {
      await insertCategory({ id: `bt-dg-${i}`, name: `Downgrade ${i}` });
      await insertBudget({ id: `b-dg-${i}`, categoryId: `bt-dg-${i}`, limitMinor: 100 });
      await insertTransaction({ id: `t-dg-${i}`, accountId: "bt-acc", amountMinor: -50, categoryId: `bt-dg-${i}` });
    }

    // Same transition the Stripe subscription.deleted webhook applies.
    await db
      .update(schema.subscriptions)
      .set({ plan: "free", status: "canceled" })
      .where(eq(schema.subscriptions.user_id, USER_ID));

    const views = await listBudgetViews(USER_ID, MONTH, db);
    expect(views).toHaveLength(budgetCount);
    for (const view of views) {
      expect(view.spent_minor).toBe(50);
    }

    const blocked = await checkBudgetLimit(USER_ID, db);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.code).toBe("budget_limit_reached");
      expect(blocked.limit).toBe(env.billing.freeMaxBudgets);
    }
  });
});
