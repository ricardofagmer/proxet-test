// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.

import { describe, it, expect, afterEach, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import {
  evaluateBudgetAlerts,
  runBudgetAlertSweep,
} from "../src/server/budget-alerts.server.ts";
import { getCapturedEmails, sendEmail } from "../src/server/email.ts";

// Pass-through wrapper around the real sender (TEST_MODE captures in memory)
// so a single test can make one delivery fail without touching email.ts.
vi.mock("../src/server/email.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/email.ts")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

const MONTH = "2026-03";
const PREVIOUS_MONTH_DATE = "2026-02-27";
const IN_MONTH_DATE = "2026-03-10";
const SWEEP_NOW = new Date("2026-03-15T12:00:00Z");
const SUBJECT_PART = "budget";

const createdUserIds: string[] = [];

interface SeededUser {
  userId: string;
  email: string;
  accountId: string;
  categoryId: string;
}

async function seedUser(options: { verified?: boolean } = {}): Promise<SeededUser> {
  const userId = `alerts-${crypto.randomUUID()}`;
  const email = `${userId}@example.com`;
  createdUserIds.push(userId);
  await db.insert(schema.users).values({
    id: userId,
    username: userId,
    email,
    email_verified_at: options.verified === false ? null : new Date(),
    password_hash: "x",
  });
  const accountId = `${userId}-acc`;
  await db.insert(schema.accounts).values({
    id: accountId,
    user_id: userId,
    name: "Main",
    currency: "PLN",
  });
  const categoryId = `${userId}-groceries`;
  await db.insert(schema.categories).values({
    id: categoryId,
    user_id: userId,
    name: "Groceries",
  });
  return { userId, email, accountId, categoryId };
}

async function addTransaction(options: {
  userId: string;
  accountId: string;
  categoryId: string;
  amountMinor: number;
  date?: string;
}): Promise<void> {
  await db.insert(schema.transactions).values({
    id: crypto.randomUUID(),
    user_id: options.userId,
    account_id: options.accountId,
    category_id: options.categoryId,
    amount_minor: options.amountMinor,
    date: options.date ?? IN_MONTH_DATE,
  });
}

async function addBudget(options: {
  userId: string;
  categoryId: string;
  limitMinor: number;
  currency?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.budgets).values({
    id,
    user_id: options.userId,
    category_id: options.categoryId,
    currency: options.currency ?? "PLN",
    limit_minor: options.limitMinor,
  });
  return id;
}

async function setLimit(budgetId: string, limitMinor: number): Promise<void> {
  await db
    .update(schema.budgets)
    .set({ limit_minor: limitMinor })
    .where(eq(schema.budgets.id, budgetId));
}

async function alertRows(budgetId: string) {
  return db
    .select()
    .from(schema.budget_alerts)
    .where(eq(schema.budget_alerts.budget_id, budgetId));
}

function budgetEmails(email: string) {
  return getCapturedEmails(email).filter((message) =>
    message.subject.includes(SUBJECT_PART),
  );
}

afterEach(async () => {
  vi.mocked(sendEmail).mockClear();
  if (createdUserIds.length === 0) return;
  const userIds = createdUserIds.splice(0);
  await db
    .delete(schema.budget_alerts)
    .where(inArray(schema.budget_alerts.user_id, userIds));
  await db.delete(schema.budgets).where(inArray(schema.budgets.user_id, userIds));
  await db
    .delete(schema.transactions)
    .where(inArray(schema.transactions.user_id, userIds));
  await db.delete(schema.accounts).where(inArray(schema.accounts.user_id, userIds));
  await db
    .delete(schema.categories)
    .where(inArray(schema.categories.user_id, userIds));
  await db.delete(schema.users).where(inArray(schema.users.id, userIds));
});

describe("budget alerts: delivery", () => {
  it("sends exactly one email when spend goes over the limit and marks the row sent", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -12_550 });

    const counts = await evaluateBudgetAlerts(user.userId, MONTH);

    expect(counts).toEqual({ evaluated: 1, claimed: 1, sent: 1, skipped: 0, failed: 0 });
    const emails = budgetEmails(user.email);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("Groceries");
    expect(emails[0].text).toContain("125.50 PLN");
    expect(emails[0].text).toContain("100.00 PLN");
    expect(emails[0].text).toContain("25.50 PLN");
    expect(emails[0].text).toContain(MONTH);
    expect(emails[0].text).toContain("/budgets");

    const [row] = await alertRows(budgetId);
    expect(row.status).toBe("sent");
    expect(row.month).toBe(MONTH);
    expect(row.user_id).toBe(user.userId);
    expect(row.sent_at).toBeInstanceOf(Date);
  });

  it("sends nothing on a second evaluation in the same month, even as spend grows", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -15_000 });
    await evaluateBudgetAlerts(user.userId, MONTH);

    await addTransaction({ ...user, amountMinor: -5_000 });
    const counts = await evaluateBudgetAlerts(user.userId, MONTH);

    expect(counts.claimed).toBe(0);
    expect(counts.sent).toBe(0);
    expect(budgetEmails(user.email)).toHaveLength(1);
    expect(await alertRows(budgetId)).toHaveLength(1);
  });

  it("sends nothing when spend is exactly at the limit", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -10_000 });

    const counts = await evaluateBudgetAlerts(user.userId, MONTH);

    expect(counts.claimed).toBe(0);
    expect(budgetEmails(user.email)).toHaveLength(0);
    expect(await alertRows(budgetId)).toHaveLength(0);
  });

  it("sends nothing more after the limit is raised and exceeded again", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -15_000 });
    await evaluateBudgetAlerts(user.userId, MONTH);

    await setLimit(budgetId, 20_000);
    await addTransaction({ ...user, amountMinor: -10_000 });
    await evaluateBudgetAlerts(user.userId, MONTH);

    expect(budgetEmails(user.email)).toHaveLength(1);
  });

  it("alerts once when the limit is lowered below current spend", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -5_000 });
    await evaluateBudgetAlerts(user.userId, MONTH);
    expect(budgetEmails(user.email)).toHaveLength(0);

    await setLimit(budgetId, 4_000);
    await evaluateBudgetAlerts(user.userId, MONTH);
    await evaluateBudgetAlerts(user.userId, MONTH);

    expect(budgetEmails(user.email)).toHaveLength(1);
    const [row] = await alertRows(budgetId);
    expect(row.status).toBe("sent");
  });

  it("ignores a backdated transaction that only pushes the previous month over", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -50_000, date: PREVIOUS_MONTH_DATE });

    await evaluateBudgetAlerts(user.userId, MONTH);

    expect(budgetEmails(user.email)).toHaveLength(0);
    expect(await alertRows(budgetId)).toHaveLength(0);
  });
});

describe("budget alerts: suppression and retries", () => {
  it("claims the row as skipped for an unverified user and never sends, even after verification", async () => {
    const user = await seedUser({ verified: false });
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -15_000 });

    const counts = await evaluateBudgetAlerts(user.userId, MONTH);
    expect(counts).toEqual({ evaluated: 1, claimed: 1, sent: 0, skipped: 1, failed: 0 });
    const [skipped] = await alertRows(budgetId);
    expect(skipped.status).toBe("skipped");
    expect(skipped.sent_at).toBeNull();

    await db
      .update(schema.users)
      .set({ email_verified_at: new Date() })
      .where(eq(schema.users.id, user.userId));
    await evaluateBudgetAlerts(user.userId, MONTH);
    await runBudgetAlertSweep(SWEEP_NOW);

    expect(budgetEmails(user.email)).toHaveLength(0);
    const [after] = await alertRows(budgetId);
    expect(after.status).toBe("skipped");
  });

  it("reverts a failed send to pending and the sweep delivers it", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -15_000 });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("provider unavailable"));

    const failedRun = await evaluateBudgetAlerts(user.userId, MONTH);
    expect(failedRun).toEqual({ evaluated: 1, claimed: 1, sent: 0, skipped: 0, failed: 1 });
    const [pending] = await alertRows(budgetId);
    expect(pending.status).toBe("pending");
    expect(pending.sent_at).toBeNull();
    expect(budgetEmails(user.email)).toHaveLength(0);

    const sweep = await runBudgetAlertSweep(SWEEP_NOW);
    expect(sweep.sent).toBeGreaterThanOrEqual(1);
    expect(budgetEmails(user.email)).toHaveLength(1);
    const [sent] = await alertRows(budgetId);
    expect(sent.status).toBe("sent");
    expect(sent.sent_at).toBeInstanceOf(Date);
  });

  it("retries a pending row left behind by an earlier failure when the sweep runs", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -15_000 });
    await db.insert(schema.budget_alerts).values({
      id: crypto.randomUUID(),
      budget_id: budgetId,
      user_id: user.userId,
      month: MONTH,
      status: "pending",
    });

    await runBudgetAlertSweep(SWEEP_NOW);

    expect(budgetEmails(user.email)).toHaveLength(1);
    const rows = await alertRows(budgetId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
  });

  it("sweep evaluates only the UTC month of `now`", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: -15_000 });

    await runBudgetAlertSweep(new Date("2026-04-01T00:30:00Z"));

    expect(budgetEmails(user.email)).toHaveLength(0);
    expect(await alertRows(budgetId)).toHaveLength(0);
  });
});

describe("budget alerts: spend semantics", () => {
  it("alerts a parent-category budget for spend on a child category", async () => {
    const user = await seedUser();
    const childId = `${user.userId}-vegetables`;
    await db.insert(schema.categories).values({
      id: childId,
      user_id: user.userId,
      name: "Vegetables",
      parent_id: user.categoryId,
    });
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, categoryId: childId, amountMinor: -12_000 });

    await evaluateBudgetAlerts(user.userId, MONTH);

    const emails = budgetEmails(user.email);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("Groceries");
    const [row] = await alertRows(budgetId);
    expect(row.status).toBe("sent");
  });

  it("does not alert on income", async () => {
    const user = await seedUser();
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, amountMinor: 50_000 });

    await evaluateBudgetAlerts(user.userId, MONTH);

    expect(budgetEmails(user.email)).toHaveLength(0);
    expect(await alertRows(budgetId)).toHaveLength(0);
  });

  it("does not alert on spend from an account in another currency", async () => {
    const user = await seedUser();
    const euroAccountId = `${user.userId}-eur`;
    await db.insert(schema.accounts).values({
      id: euroAccountId,
      user_id: user.userId,
      name: "Euro",
      currency: "EUR",
    });
    const budgetId = await addBudget({ ...user, limitMinor: 10_000 });
    await addTransaction({ ...user, accountId: euroAccountId, amountMinor: -50_000 });

    await evaluateBudgetAlerts(user.userId, MONTH);

    expect(budgetEmails(user.email)).toHaveLength(0);
    expect(await alertRows(budgetId)).toHaveLength(0);
  });

  it("never alerts a user for another user's spend", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const budgetId = await addBudget({ ...owner, limitMinor: 10_000 });
    // Even a foreign row pointing at the owner's category must not count:
    // spend is scoped by the transaction's user_id.
    await addTransaction({
      userId: other.userId,
      accountId: other.accountId,
      categoryId: owner.categoryId,
      amountMinor: -50_000,
    });
    await addTransaction({ ...other, amountMinor: -50_000 });

    await runBudgetAlertSweep(SWEEP_NOW);

    expect(budgetEmails(owner.email)).toHaveLength(0);
    expect(budgetEmails(other.email)).toHaveLength(0);
    expect(await alertRows(budgetId)).toHaveLength(0);
    const otherAlerts = await db
      .select()
      .from(schema.budget_alerts)
      .where(
        and(
          eq(schema.budget_alerts.user_id, other.userId),
          eq(schema.budget_alerts.month, MONTH),
        ),
      );
    expect(otherAlerts).toHaveLength(0);
  });
});
