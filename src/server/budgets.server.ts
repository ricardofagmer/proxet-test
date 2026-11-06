import { and, asc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, schema } from "#/db";

//
// Budget domain logic: month helpers and live spend aggregation. Server-only —
// imported by budgets.functions.ts handlers, budget-alerts.server.ts and unit
// tests. Spend is never stored; it is recomputed per UTC calendar month, which
// is how budgets "reset every month" without a rollover job.

type Db = typeof defaultDb;

/** Fallback for legacy accounts with a null currency — the column default. */
export const DEFAULT_ACCOUNT_CURRENCY = "PLN";

/** 'YYYY-MM' — a UTC calendar month. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

export function currentUtcMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Half-open calendar-date range [start, end) covering `month`. Transaction
 * dates are plain 'YYYY-MM-DD' strings, so string comparison is exact. */
export function monthRange(month: string): { start: string; end: string } {
  const [yearPart, monthPart] = month.split("-");
  const year = Number.parseInt(yearPart, 10);
  const monthIndex = Number.parseInt(monthPart, 10);
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  return {
    start: `${month}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

export interface BudgetSpendInput {
  id: string;
  category_id: string;
  currency: string;
}

/**
 * The category itself plus every descendant at any depth. Guarded by a
 * visited set so a corrupt parent_id cycle cannot loop forever (same
 * approach as the ancestry walk in updateCategory).
 */
export function collectCategorySubtree(
  rootId: string,
  childrenByParent: Map<string, string[]>,
): Set<string> {
  const subtree = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || subtree.has(current)) continue;
    subtree.add(current);
    for (const child of childrenByParent.get(current) ?? []) {
      stack.push(child);
    }
  }
  return subtree;
}

/**
 * Spent amount per budget for `month`, in positive minor units. Only
 * expenses count (amount_minor < 0); income and refunds are excluded rather
 * than netted. A budget on a parent includes all its subcategories, and only
 * transactions on accounts in the budget's currency count.
 */
export async function computeBudgetSpend(
  userId: string,
  month: string,
  budgets: BudgetSpendInput[],
  db: Db = defaultDb,
): Promise<Map<string, number>> {
  const spendByBudget = new Map<string, number>(
    budgets.map((budget) => [budget.id, 0]),
  );
  if (budgets.length === 0) return spendByBudget;

  const categoryRows = await db
    .select({
      id: schema.categories.id,
      parent_id: schema.categories.parent_id,
    })
    .from(schema.categories)
    .where(eq(schema.categories.user_id, userId));
  const childrenByParent = new Map<string, string[]>();
  for (const row of categoryRows) {
    if (!row.parent_id) continue;
    const siblings = childrenByParent.get(row.parent_id) ?? [];
    siblings.push(row.id);
    childrenByParent.set(row.parent_id, siblings);
  }

  const { start, end } = monthRange(month);
  // The fallback is inlined as a literal, not bound: the same expression is
  // used in SELECT and GROUP BY, and two separately bound parameters make
  // Postgres treat them as different expressions ("must appear in GROUP BY").
  const currencyExpression = sql<string>`COALESCE(${schema.accounts.currency}, ${sql.raw(`'${DEFAULT_ACCOUNT_CURRENCY}'`)})`;
  const spendRows = await db
    .select({
      categoryId: schema.transactions.category_id,
      currency: currencyExpression,
      // SUM over integers is bigint in Postgres (returned as a string).
      spent: sql<number>`COALESCE(SUM(ABS(${schema.transactions.amount_minor})), 0)`.mapWith(
        Number,
      ),
    })
    .from(schema.transactions)
    .innerJoin(
      schema.accounts,
      eq(schema.transactions.account_id, schema.accounts.id),
    )
    .where(
      and(
        eq(schema.transactions.user_id, userId),
        sql`${schema.transactions.amount_minor} < 0`,
        isNotNull(schema.transactions.category_id),
        gte(schema.transactions.date, start),
        lt(schema.transactions.date, end),
      ),
    )
    .groupBy(schema.transactions.category_id, currencyExpression);

  for (const budget of budgets) {
    const subtree = collectCategorySubtree(budget.category_id, childrenByParent);
    let spent = 0;
    for (const row of spendRows) {
      if (
        row.categoryId !== null &&
        row.currency === budget.currency &&
        subtree.has(row.categoryId)
      ) {
        spent += row.spent;
      }
    }
    spendByBudget.set(budget.id, spent);
  }
  return spendByBudget;
}

export interface BudgetView {
  id: string;
  category_id: string;
  category_name: string;
  category_color: string | null;
  currency: string;
  limit_minor: number;
  spent_minor: number;
  /** limit - spent; negative when over budget. */
  remaining_minor: number;
  /** Strictly spent > limit — spending exactly the limit is not over. */
  over_budget: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Every budget of the user with its live spend for `month`, ordered by
 * category name. Shared by the Budgets page and alert evaluation so both
 * agree on what "over budget" means. */
export async function listBudgetViews(
  userId: string,
  month: string,
  db: Db = defaultDb,
): Promise<BudgetView[]> {
  const rows = await db
    .select({
      id: schema.budgets.id,
      category_id: schema.budgets.category_id,
      category_name: schema.categories.name,
      category_color: schema.categories.color,
      currency: schema.budgets.currency,
      limit_minor: schema.budgets.limit_minor,
      created_at: schema.budgets.created_at,
      updated_at: schema.budgets.updated_at,
    })
    .from(schema.budgets)
    .innerJoin(
      schema.categories,
      eq(schema.budgets.category_id, schema.categories.id),
    )
    .where(eq(schema.budgets.user_id, userId))
    .orderBy(asc(schema.categories.name));

  const spendByBudget = await computeBudgetSpend(userId, month, rows, db);
  return rows.map((row) => {
    const spent = spendByBudget.get(row.id) ?? 0;
    return {
      ...row,
      spent_minor: spent,
      remaining_minor: row.limit_minor - spent,
      over_budget: spent > row.limit_minor,
    };
  });
}
