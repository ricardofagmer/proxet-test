// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.
// Running in node environment ensures the real server functions execute against the in-memory DB.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { inArray } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import {
  CategoryNotFoundError,
  getCategoryExpensesInternal,
  getSpendingSankeyInternal,
} from "../src/server/analytics.server.ts";
import { prepareSpendingFlow } from "../src/lib/spending-flow.ts";

//
// The dashboard drill-down lists the expenses behind one category of the
// spending chart. Its total must equal the chart's category total, so every
// case compares against getSpendingSankeyInternal for the same filter.

const userId = "drilldown-user";
const otherUserId = "drilldown-other-user";
const period = { from: "2025-03-01", to: "2025-03-31" };

async function insertTransaction(row: {
  id: string;
  date: string;
  amountMinor: number;
  categoryId: string | null;
  description?: string;
  accountId?: string;
  ownerId?: string;
}): Promise<void> {
  await db.insert(schema.transactions).values({
    id: row.id,
    user_id: row.ownerId ?? userId,
    account_id: row.accountId ?? "dd-acc",
    date: row.date,
    amount_minor: row.amountMinor,
    description: row.description ?? row.id,
    category_id: row.categoryId,
  });
}

/** The category column of the chart, keyed by category id (null = "Other"). */
async function chartTotals(filter = period): Promise<Map<string | null, number>> {
  const sankey = await getSpendingSankeyInternal(userId, filter);
  const flow = prepareSpendingFlow(sankey.nodes, sankey.links);
  return new Map(
    flow.nodes
      .filter((node) => node.depth === 1)
      .map((node) => [node.categoryId ?? null, node.total]),
  );
}

describe("getCategoryExpensesInternal", () => {
  beforeEach(async () => {
    await db.insert(schema.users).values([
      { id: userId, username: "drilldown", password_hash: "x" },
      { id: otherUserId, username: "drilldown-other", password_hash: "x" },
    ]);
    await db.insert(schema.accounts).values([
      { id: "dd-acc", user_id: userId, name: "Main" },
      { id: "dd-other-acc", user_id: otherUserId, name: "Theirs" },
    ]);
    await db.insert(schema.categories).values([
      { id: "dd-food", user_id: userId, name: "Food", color: "#ef4444" },
      { id: "dd-veg", user_id: userId, name: "Vegetables", color: "#22c55e", parent_id: "dd-food" },
      { id: "dd-fun", user_id: userId, name: "Fun", color: "#3b82f6" },
      { id: "dd-theirs", user_id: otherUserId, name: "Secret", color: "#000000" },
    ]);
  });

  afterEach(async () => {
    const users = [userId, otherUserId];
    await db.delete(schema.receipt_items);
    await db.delete(schema.receipts);
    await db.delete(schema.transactions).where(inArray(schema.transactions.user_id, users));
    await db.delete(schema.categories).where(inArray(schema.categories.user_id, users));
    await db.delete(schema.accounts).where(inArray(schema.accounts.user_id, users));
    await db.delete(schema.users).where(inArray(schema.users.id, users));
  });

  it("lists expenses of the category and its subcategories, never income", async () => {
    await insertTransaction({ id: "dd-t1", date: "2025-03-05", amountMinor: -4000, categoryId: "dd-food" });
    await insertTransaction({ id: "dd-t2", date: "2025-03-10", amountMinor: -2550, categoryId: "dd-veg" });
    await insertTransaction({ id: "dd-refund", date: "2025-03-12", amountMinor: 1500, categoryId: "dd-food" });
    await insertTransaction({ id: "dd-fun1", date: "2025-03-07", amountMinor: -900, categoryId: "dd-fun" });
    await insertTransaction({ id: "dd-old", date: "2025-02-20", amountMinor: -700, categoryId: "dd-food" });

    const result = await getCategoryExpensesInternal(userId, { ...period, categoryId: "dd-food" });

    expect(result.expenses.map((expense) => expense.transactionId)).toEqual(["dd-t2", "dd-t1"]);
    expect(result.expenses[0]?.subcategoryNames).toEqual(["Vegetables"]);
    expect(result.expenses[1]?.subcategoryNames).toEqual([]);
    expect(result.expenses[0]?.accountName).toBe("Main");
    expect(result.totalMinor).toBe(6550);
    expect((await chartTotals()).get("dd-food")).toBe(result.totalMinor);
  });

  it("attributes receipt items of an uncategorized expense like the chart does", async () => {
    await insertTransaction({ id: "dd-receipt-txn", date: "2025-03-15", amountMinor: -5000, categoryId: null });
    await db.insert(schema.receipts).values({ id: "dd-receipt", user_id: userId, transaction_id: "dd-receipt-txn" });
    await db.insert(schema.receipt_items).values([
      { id: "dd-item-1", receipt_id: "dd-receipt", name: "Carrots", total_price_minor: 1200, category_id: "dd-veg" },
      { id: "dd-item-2", receipt_id: "dd-receipt", name: "Mystery", total_price_minor: 800, category_id: null },
    ]);

    const food = await getCategoryExpensesInternal(userId, { ...period, categoryId: "dd-food" });
    const other = await getCategoryExpensesInternal(userId, { ...period, categoryId: null });
    const totals = await chartTotals();

    expect(food.totalMinor).toBe(1200);
    expect(food.expenses[0]?.subcategoryNames).toEqual(["Vegetables"]);
    expect(totals.get("dd-food")).toBe(food.totalMinor);
    // Uncategorized item (800) + unitemized remainder (3000) land in "Other".
    expect(other.totalMinor).toBe(3800);
    expect(totals.get(null)).toBe(other.totalMinor);
  });

  it("respects the account filter", async () => {
    await db.insert(schema.accounts).values({ id: "dd-acc-2", user_id: userId, name: "Savings" });
    await insertTransaction({ id: "dd-main", date: "2025-03-05", amountMinor: -1000, categoryId: "dd-fun" });
    await insertTransaction({ id: "dd-savings", date: "2025-03-06", amountMinor: -2000, categoryId: "dd-fun", accountId: "dd-acc-2" });

    const filter = { ...period, accountId: "dd-acc-2" };
    const result = await getCategoryExpensesInternal(userId, { ...filter, categoryId: "dd-fun" });

    expect(result.expenses.map((expense) => expense.transactionId)).toEqual(["dd-savings"]);
    expect((await chartTotals(filter)).get("dd-fun")).toBe(result.totalMinor);
  });

  it("rejects a category owned by another user without revealing its data", async () => {
    await insertTransaction({
      id: "dd-their-txn",
      date: "2025-03-05",
      amountMinor: -9999,
      categoryId: "dd-theirs",
      accountId: "dd-other-acc",
      ownerId: otherUserId,
    });

    await expect(
      getCategoryExpensesInternal(userId, { ...period, categoryId: "dd-theirs" }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("returns an empty list when the category has no expenses in the period", async () => {
    const result = await getCategoryExpensesInternal(userId, { ...period, categoryId: "dd-fun" });

    expect(result).toEqual({ expenses: [], totalMinor: 0 });
  });
});
