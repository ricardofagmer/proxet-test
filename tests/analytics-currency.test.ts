// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.
// Running in node environment ensures the real server functions execute against the in-memory DB.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { getDashboardSummaryInternal } from "../src/server/analytics.server.ts";

//
// The dashboard labels its totals with the accounts' currency instead of a
// fixed "PLN"; the summary reports which currencies the totals are made of.

const userId = "currency-user";
const period = { from: "2025-04-01", to: "2025-04-30" };

async function insertAccount(id: string, currency: string | null): Promise<void> {
  await db.insert(schema.accounts).values({ id, user_id: userId, name: id, currency });
}

async function insertTransaction(id: string, accountId: string, date = "2025-04-10"): Promise<void> {
  await db.insert(schema.transactions).values({
    id,
    user_id: userId,
    account_id: accountId,
    date,
    amount_minor: -1000,
    description: id,
  });
}

describe("getDashboardSummaryInternal currencies", () => {
  beforeEach(async () => {
    await db.insert(schema.users).values({ id: userId, username: "currency", password_hash: "x" });
  });

  afterEach(async () => {
    await db.delete(schema.transactions).where(eq(schema.transactions.user_id, userId));
    await db.delete(schema.accounts).where(eq(schema.accounts.user_id, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("reports the single currency of a EUR account", async () => {
    await insertAccount("cur-eur", "EUR");
    await insertTransaction("cur-t1", "cur-eur");

    const summary = await getDashboardSummaryInternal(userId, period);

    expect(summary.currencies).toEqual(["EUR"]);
  });

  it("reports every currency when accounts mix currencies", async () => {
    await insertAccount("cur-eur", "EUR");
    await insertAccount("cur-pln", "PLN");
    await insertTransaction("cur-t1", "cur-eur");
    await insertTransaction("cur-t2", "cur-pln");

    const summary = await getDashboardSummaryInternal(userId, period);

    expect(summary.currencies).toEqual(["EUR", "PLN"]);
  });

  it("uses only the filtered account, and only accounts with transactions in range", async () => {
    await insertAccount("cur-eur", "EUR");
    await insertAccount("cur-usd", "USD");
    await insertAccount("cur-idle", "GBP");
    await insertTransaction("cur-t1", "cur-eur");
    await insertTransaction("cur-t2", "cur-usd");
    await insertTransaction("cur-old", "cur-idle", "2025-01-10");

    expect((await getDashboardSummaryInternal(userId, period)).currencies).toEqual(["EUR", "USD"]);
    expect(
      (await getDashboardSummaryInternal(userId, { ...period, accountId: "cur-usd" })).currencies,
    ).toEqual(["USD"]);
  });

  it("treats a legacy null currency as PLN and reports nothing without data", async () => {
    await insertAccount("cur-legacy", null);
    expect((await getDashboardSummaryInternal(userId, period)).currencies).toEqual([]);

    await insertTransaction("cur-t1", "cur-legacy");
    expect((await getDashboardSummaryInternal(userId, period)).currencies).toEqual(["PLN"]);
  });
});
