import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { db, schema } from "#/db";
import { DEFAULT_ACCOUNT_CURRENCY } from "./budgets.server";


// --- Types ---

export interface AnalyticsFilter {
  from?: string;
  to?: string;
  accountId?: string;
}

export interface TopCategory {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  /** Integer minor units (grosze/cents). */
  totalSpent: number;
}

export interface DashboardSummary {
  /** All totals are integer minor units (grosze/cents). */
  totalIncome: number;
  totalExpenses: number;
  net: number;
  topCategories: TopCategory[];
  /**
   * Distinct currencies (sorted) of the accounts behind the totals: the
   * filtered account, or every account with transactions in the range. More
   * than one means the totals add up amounts in different currencies.
   */
  currencies: string[];
}

export interface SankeyNode {
  name: string;
  color?: string;
  /**
   * Category and subcategory nodes: the category id. The uncategorized "Other"
   * node: null. Account nodes: absent.
   */
  categoryId?: string | null;
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

export interface SpendingOverTimeEntry {
  month: string;
  /** Income and per-category amounts are integer minor units (grosze/cents). */
  income: number;
  categories: Array<{
    name: string;
    color: string;
    amount: number;
  }>;
}

interface ReceiptItemRow {
  id: string;
  receiptId: string;
  totalPriceMinor: number;
  categoryId: string | null;
  itemName: string | null;
  itemColor: string | null;
  itemParentId: string | null;
}

// --- Helpers ---

function buildWhereClause(userId: string, filter: AnalyticsFilter) {
  const conditions = [eq(schema.transactions.user_id, userId)];

  if (filter.from) {
    conditions.push(gte(schema.transactions.date, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(schema.transactions.date, filter.to));
  }
  if (filter.accountId) {
    conditions.push(eq(schema.transactions.account_id, filter.accountId));
  }

  return and(...conditions);
}

// --- Server Logic ---

/**
 * Fetches high-level dashboard summary: total income, expenses, net, and top spending categories.
 */
export async function getDashboardSummaryInternal(
  userId: string,
  filter: AnalyticsFilter,
): Promise<DashboardSummary> {
  const whereClause = buildWhereClause(userId, filter);

  // Total income (positive amounts) and expenses (negative amounts)
  const totals = await db
    .select({
      // SUM over integers is bigint in Postgres (returned as a string) — map back to number.
      totalIncome: sql<number>`COALESCE(SUM(CASE WHEN ${schema.transactions.amount_minor} > 0 THEN ${schema.transactions.amount_minor} ELSE 0 END), 0)`.mapWith(Number),
      totalExpenses: sql<number>`COALESCE(SUM(CASE WHEN ${schema.transactions.amount_minor} < 0 THEN ABS(${schema.transactions.amount_minor}) ELSE 0 END), 0)`.mapWith(Number),
    })
    .from(schema.transactions)
    .where(whereClause);

  const { totalIncome, totalExpenses } =
    totals[0] ?? { totalIncome: 0, totalExpenses: 0 };

  // Top spending categories (by absolute expense amount)
  const topCategories = await db
    .select({
      categoryId: schema.categories.id,
      categoryName: schema.categories.name,
      categoryColor: schema.categories.color,
      totalSpent: sql<number>`COALESCE(SUM(ABS(${schema.transactions.amount_minor})), 0)`.mapWith(Number),
    })
    .from(schema.transactions)
    .innerJoin(
      schema.categories,
      eq(schema.transactions.category_id, schema.categories.id),
    )
    .where(
      and(
        whereClause,
        sql`${schema.transactions.amount_minor} < 0`,
      ),
    )
    .groupBy(
      schema.categories.id,
      schema.categories.name,
      schema.categories.color,
    )
    .orderBy(sql`SUM(ABS(${schema.transactions.amount_minor})) DESC`)
    .limit(5);

  return {
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
    topCategories,
    currencies: await getSummaryCurrencies(userId, filter),
  };
}

/** See `DashboardSummary.currencies`. Both branches are scoped to `userId`. */
async function getSummaryCurrencies(userId: string, filter: AnalyticsFilter): Promise<string[]> {
  const currency = sql<string>`COALESCE(${schema.accounts.currency}, ${DEFAULT_ACCOUNT_CURRENCY})`;
  const rows = filter.accountId
    ? await db
        .selectDistinct({ currency })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.id, filter.accountId), eq(schema.accounts.user_id, userId)))
    : await db
        .selectDistinct({ currency })
        .from(schema.transactions)
        .innerJoin(schema.accounts, eq(schema.transactions.account_id, schema.accounts.id))
        .where(and(buildWhereClause(userId, filter), eq(schema.accounts.user_id, userId)));
  return rows.map((row) => row.currency).sort();
}

// --- Expense attribution (shared by the Sankey and the category drill-down) ---

/** Category key of the bucket for spending that has no category at all. */
const OTHER_CATEGORY_KEY = "Other";
const FALLBACK_CATEGORY_COLOR = "#6b7280";

interface ExpenseRow {
  id: string;
  accountId: string;
  date: string;
  description: string | null;
  amountMinor: number;
  categoryId: string | null;
  accountName: string;
}

interface CategoryInfo {
  name: string;
  color: string;
  parentId: string | null;
}

interface ResolvedCategory extends CategoryInfo {
  id: string;
}

interface ExpenseContext {
  accounts: Array<{ id: string; name: string }>;
  transactions: ExpenseRow[];
  receiptIdByTransaction: Map<string, string>;
  itemsByReceipt: Map<string, ReceiptItemRow[]>;
  categoryInfo: Map<string, CategoryInfo>;
}

/** The part of one expense that lands in one top-level category column. */
interface TopCategoryAllocation {
  /** Top-level category id, or OTHER_CATEGORY_KEY for uncategorized spending. */
  categoryKey: string;
  /** Minor units, positive. */
  amount: number;
  /** Subcategories (children of the top category) this part was spent on. */
  subcategoryIds: string[];
}

function addAmount(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Loads every expense (amount < 0) of the user in the filter, with its
 * receipt items and the categories needed to resolve top-level parents.
 * Every query is scoped to `userId` through the transactions or accounts.
 */
async function loadExpenseContext(
  userId: string,
  filter: AnalyticsFilter,
): Promise<ExpenseContext> {
  const whereClause = buildWhereClause(userId, filter);

  const accountWhere = filter.accountId
    ? and(eq(schema.accounts.user_id, userId), eq(schema.accounts.id, filter.accountId))
    : eq(schema.accounts.user_id, userId);
  const accounts = await db
    .select({ id: schema.accounts.id, name: schema.accounts.name })
    .from(schema.accounts)
    .where(accountWhere);

  const rows = await db
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.account_id,
      date: schema.transactions.date,
      description: schema.transactions.description,
      amountMinor: schema.transactions.amount_minor,
      categoryId: schema.transactions.category_id,
      accountName: schema.accounts.name,
      categoryName: schema.categories.name,
      categoryColor: schema.categories.color,
      categoryParentId: schema.categories.parent_id,
    })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.transactions.account_id, schema.accounts.id))
    .leftJoin(schema.categories, eq(schema.transactions.category_id, schema.categories.id))
    .where(and(whereClause, sql`${schema.transactions.amount_minor} < 0`));

  const transactionIds = rows.map((row) => row.id);
  const receipts = transactionIds.length > 0
    ? await db
        .select({ id: schema.receipts.id, transactionId: schema.receipts.transaction_id })
        .from(schema.receipts)
        .where(inArray(schema.receipts.transaction_id, transactionIds))
    : [];

  const receiptIds = receipts.map((r) => r.id);
  const receiptItems: ReceiptItemRow[] = receiptIds.length > 0
    ? (await db
        .select({
          id: schema.receipt_items.id,
          receiptId: schema.receipt_items.receipt_id,
          totalPriceMinor: schema.receipt_items.total_price_minor,
          categoryId: schema.receipt_items.category_id,
          itemName: schema.categories.name,
          itemColor: schema.categories.color,
          itemParentId: schema.categories.parent_id,
        })
        .from(schema.receipt_items)
        .leftJoin(schema.categories, eq(schema.receipt_items.category_id, schema.categories.id))
        .where(inArray(schema.receipt_items.receipt_id, receiptIds))) as ReceiptItemRow[]
    : [];

  const receiptIdByTransaction = new Map<string, string>();
  for (const receipt of receipts) {
    if (receipt.transactionId) receiptIdByTransaction.set(receipt.transactionId, receipt.id);
  }

  const itemsByReceipt = new Map<string, ReceiptItemRow[]>();
  for (const item of receiptItems) {
    itemsByReceipt.set(item.receiptId, [...(itemsByReceipt.get(item.receiptId) ?? []), item]);
  }

  const categoryInfo = new Map<string, CategoryInfo>();
  const remember = (
    id: string,
    found: { name: string | null; color: string | null; parentId: string | null },
  ): void => {
    if (categoryInfo.has(id)) return;
    categoryInfo.set(id, {
      name: found.name ?? "Unknown",
      color: found.color ?? FALLBACK_CATEGORY_COLOR,
      parentId: found.parentId,
    });
  };
  for (const row of rows) {
    if (!row.categoryId) continue;
    remember(row.categoryId, {
      name: row.categoryName,
      color: row.categoryColor,
      parentId: row.categoryParentId,
    });
  }
  for (const item of receiptItems) {
    if (!item.categoryId) continue;
    remember(item.categoryId, {
      name: item.itemName,
      color: item.itemColor,
      parentId: item.itemParentId,
    });
  }

  // Parents not referenced directly by any expense, so top-level resolution works.
  const parentIds = new Set<string>();
  for (const info of categoryInfo.values()) {
    if (info.parentId) parentIds.add(info.parentId);
  }
  if (parentIds.size > 0) {
    const parents = await db
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        color: schema.categories.color,
        parentId: schema.categories.parent_id,
      })
      .from(schema.categories)
      .where(and(eq(schema.categories.user_id, userId), inArray(schema.categories.id, [...parentIds])));
    for (const parent of parents) remember(parent.id, parent);
  }

  const transactions: ExpenseRow[] = rows;
  return { accounts, transactions, receiptIdByTransaction, itemsByReceipt, categoryInfo };
}

/** The parent of a subcategory, or the category itself when it is top-level. */
function getTopCategory(context: ExpenseContext, categoryId: string | null): ResolvedCategory | null {
  if (!categoryId) return null;
  const info = context.categoryInfo.get(categoryId);
  if (!info) return null;
  if (info.parentId) {
    const parent = context.categoryInfo.get(info.parentId);
    // Parent not loaded: treat this category as top-level.
    return parent ? { id: info.parentId, ...parent } : { id: categoryId, ...info };
  }
  return { id: categoryId, ...info };
}

/**
 * How one expense splits across the top-level category column — the single
 * source of truth for what each category's total is made of:
 * - A categorized expense goes whole to its top-level category (receipt items
 *   only refine the subcategory breakdown).
 * - An uncategorized expense with a receipt goes to the top-level category of
 *   each categorized item; the rest (uncategorized items + unitemized delta)
 *   goes to "Other".
 * - An uncategorized expense without a receipt goes whole to "Other".
 */
function allocateToTopCategories(
  context: ExpenseContext,
  transaction: ExpenseRow,
): TopCategoryAllocation[] {
  const absAmount = Math.abs(transaction.amountMinor);
  const receiptId = context.receiptIdByTransaction.get(transaction.id);
  const items = receiptId ? (context.itemsByReceipt.get(receiptId) ?? []) : [];
  const topCategory = getTopCategory(context, transaction.categoryId);

  if (topCategory) {
    const subcategoryIds = new Set<string>();
    if (transaction.categoryId && transaction.categoryId !== topCategory.id) {
      subcategoryIds.add(transaction.categoryId);
    }
    for (const item of items) {
      if (item.categoryId && item.categoryId !== topCategory.id) subcategoryIds.add(item.categoryId);
    }
    return [{ categoryKey: topCategory.id, amount: absAmount, subcategoryIds: [...subcategoryIds] }];
  }

  if (!receiptId) {
    return [{ categoryKey: OTHER_CATEGORY_KEY, amount: absAmount, subcategoryIds: [] }];
  }

  const byCategory = new Map<string, TopCategoryAllocation>();
  for (const item of items) {
    const itemTop = getTopCategory(context, item.categoryId);
    if (!item.categoryId || !itemTop) continue;
    const allocation = byCategory.get(itemTop.id) ?? {
      categoryKey: itemTop.id,
      amount: 0,
      subcategoryIds: [],
    };
    allocation.amount += item.totalPriceMinor ?? 0;
    if (item.categoryId !== itemTop.id && !allocation.subcategoryIds.includes(item.categoryId)) {
      allocation.subcategoryIds.push(item.categoryId);
    }
    byCategory.set(itemTop.id, allocation);
  }
  const itemsTotal = items.reduce((sum, item) => sum + (item.totalPriceMinor ?? 0), 0);
  const uncategorizedItems = items
    .filter((item) => !item.categoryId)
    .reduce((sum, item) => sum + (item.totalPriceMinor ?? 0), 0);
  const remaining = uncategorizedItems + Math.max(0, absAmount - itemsTotal);
  const allocations = [...byCategory.values()];
  if (remaining > 0) {
    allocations.push({ categoryKey: OTHER_CATEGORY_KEY, amount: remaining, subcategoryIds: [] });
  }
  return allocations;
}

/** Category -> subcategory bands of one expense (keys `topCategoryId|subcategoryId`). */
function addSubcategorySpending(
  context: ExpenseContext,
  transaction: ExpenseRow,
  catSubSpending: Map<string, number>,
): void {
  const absAmount = Math.abs(transaction.amountMinor);
  const receiptId = context.receiptIdByTransaction.get(transaction.id);
  const topCategory = getTopCategory(context, transaction.categoryId);

  if (!receiptId) {
    if (!topCategory) return;
    // A transaction on a top-level category flows to a same-name subcategory node.
    const subcategoryId =
      transaction.categoryId && transaction.categoryId !== topCategory.id
        ? transaction.categoryId
        : topCategory.id;
    addAmount(catSubSpending, `${topCategory.id}|${subcategoryId}`, absAmount);
    return;
  }

  const items = context.itemsByReceipt.get(receiptId) ?? [];
  if (topCategory) {
    for (const item of items) {
      const subcategoryId = item.categoryId ?? topCategory.id;
      addAmount(catSubSpending, `${topCategory.id}|${subcategoryId}`, item.totalPriceMinor ?? 0);
    }
    const delta = absAmount - items.reduce((sum, item) => sum + (item.totalPriceMinor ?? 0), 0);
    if (delta > 0) addAmount(catSubSpending, `${topCategory.id}|${topCategory.id}`, delta);
    return;
  }

  for (const item of items) {
    const itemTop = getTopCategory(context, item.categoryId);
    if (item.categoryId && itemTop) {
      addAmount(catSubSpending, `${itemTop.id}|${item.categoryId}`, item.totalPriceMinor ?? 0);
    }
  }
}

/**
 * Fetches spending data formatted for a Sankey diagram: 3-level flow from
 * accounts to categories to subcategories. See `allocateToTopCategories` for
 * how an expense is attributed to categories.
 *
 * The Sankey is balanced: account→category total = sum of category→subcategory totals.
 * Each category gets its own distinct 3rd-level node (e.g., "Groceries" → "Groceries")
 * so that spending from different categories is visually separated.
 * Category and subcategory nodes carry `categoryId`; the "Other" node carries
 * `categoryId: null`, so the dashboard can drill into a category.
 */
export async function getSpendingSankeyInternal(
  userId: string,
  filter: AnalyticsFilter,
): Promise<{ nodes: SankeyNode[]; links: SankeyLink[] }> {
  const context = await loadExpenseContext(userId, filter);

  const accCatSpending = new Map<string, number>(); // account|topCat → total
  const catSubSpending = new Map<string, number>(); // topCat|subCat → total
  for (const transaction of context.transactions) {
    for (const allocation of allocateToTopCategories(context, transaction)) {
      addAmount(accCatSpending, `${transaction.accountId}|${allocation.categoryKey}`, allocation.amount);
    }
    addSubcategorySpending(context, transaction, catSubSpending);
  }

  const accountIndex = new Map<string, number>();
  const categoryIndex = new Map<string, number>();
  const subcategoryIndex = new Map<string, number>();
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  for (const account of context.accounts) {
    accountIndex.set(account.id, nodes.length);
    nodes.push({ name: account.name, color: "#94a3b8" });
  }

  const categoryKeys = new Set<string>();
  for (const key of accCatSpending.keys()) categoryKeys.add(key.split("|")[1]);
  // Real categories first, "Other" last.
  for (const categoryId of categoryKeys) {
    if (categoryId === OTHER_CATEGORY_KEY) continue;
    const info = context.categoryInfo.get(categoryId);
    categoryIndex.set(categoryId, nodes.length);
    nodes.push({ name: info?.name ?? categoryId, color: info?.color ?? FALLBACK_CATEGORY_COLOR, categoryId });
  }
  // Each subcategory gets its own node, even when it shares a name with its
  // category, so the category and subcategory columns stay distinct.
  const subcategoryIds = new Set<string>();
  for (const key of catSubSpending.keys()) subcategoryIds.add(key.split("|")[1]);
  for (const subcategoryId of subcategoryIds) {
    const info = context.categoryInfo.get(subcategoryId);
    subcategoryIndex.set(subcategoryId, nodes.length);
    nodes.push({
      name: info?.name ?? subcategoryId,
      color: info?.color ?? FALLBACK_CATEGORY_COLOR,
      categoryId: subcategoryId,
    });
  }
  if (categoryKeys.has(OTHER_CATEGORY_KEY)) {
    const index = nodes.length;
    categoryIndex.set(OTHER_CATEGORY_KEY, index);
    subcategoryIndex.set(OTHER_CATEGORY_KEY, index);
    nodes.push({ name: "Other", color: "#9ca3af", categoryId: null });
  }

  for (const [key, value] of accCatSpending) {
    const [accountId, categoryId] = key.split("|");
    const source = accountIndex.get(accountId);
    const target = categoryIndex.get(categoryId);
    if (source !== undefined && target !== undefined) links.push({ source, target, value });
  }
  for (const [key, value] of catSubSpending) {
    const [topCategoryId, subcategoryId] = key.split("|");
    const source = categoryIndex.get(topCategoryId);
    const target = subcategoryIndex.get(subcategoryId);
    if (source !== undefined && target !== undefined) links.push({ source, target, value });
  }

  return { nodes, links };
}

// --- Category drill-down ---

export interface CategoryExpense {
  transactionId: string;
  date: string;
  description: string | null;
  accountName: string;
  /** Names of the subcategories this expense was spent on; empty when none. */
  subcategoryNames: string[];
  /** The part of the expense counted in the category, positive minor units. */
  amountMinor: number;
}

export interface CategoryExpenses {
  expenses: CategoryExpense[];
  /** Equals the category's account→category total in the Sankey. */
  totalMinor: number;
}

export interface CategoryExpensesFilter extends AnalyticsFilter {
  /** Top-level category id, or null for the uncategorized "Other" bucket. */
  categoryId: string | null;
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("Category not found");
    this.name = "CategoryNotFoundError";
  }
}

/**
 * Every expense counted in one top-level category of the Sankey for the same
 * filter, using the same attribution, so the rows add up to the chart's amount.
 * A category id the user does not own fails like a missing one.
 */
export async function getCategoryExpensesInternal(
  userId: string,
  filter: CategoryExpensesFilter,
): Promise<CategoryExpenses> {
  if (filter.categoryId !== null) {
    const owned = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(and(eq(schema.categories.id, filter.categoryId), eq(schema.categories.user_id, userId)))
      .limit(1);
    if (owned.length === 0) throw new CategoryNotFoundError();
  }

  const context = await loadExpenseContext(userId, filter);
  // The Sankey only draws bands from the user's own (filtered) accounts.
  const accountIds = new Set(context.accounts.map((account) => account.id));
  const categoryKey = filter.categoryId ?? OTHER_CATEGORY_KEY;

  const expenses: CategoryExpense[] = [];
  for (const transaction of context.transactions) {
    if (!accountIds.has(transaction.accountId)) continue;
    for (const allocation of allocateToTopCategories(context, transaction)) {
      if (allocation.categoryKey !== categoryKey) continue;
      expenses.push({
        transactionId: transaction.id,
        date: transaction.date,
        description: transaction.description,
        accountName: transaction.accountName,
        subcategoryNames: allocation.subcategoryIds.map(
          (id) => context.categoryInfo.get(id)?.name ?? "Unknown",
        ),
        amountMinor: allocation.amount,
      });
    }
  }

  expenses.sort(
    (a, b) => b.date.localeCompare(a.date) || a.transactionId.localeCompare(b.transactionId),
  );
  return {
    expenses,
    totalMinor: expenses.reduce((sum, expense) => sum + expense.amountMinor, 0),
  };
}

/**
 * Fetches monthly spending data broken down by category for bar/line charts.
 */
export async function getSpendingOverTimeInternal(
  userId: string,
  filter: AnalyticsFilter,
): Promise<SpendingOverTimeEntry[]> {
  const whereClause = buildWhereClause(userId, filter);

  // Monthly spending by category (expenses only)
  const monthExpr = sql<string>`to_char(${schema.transactions.date}, 'YYYY-MM')`;
  const monthlyData = await db
    .select({
      month: monthExpr,
      categoryId: schema.categories.id,
      categoryName: schema.categories.name,
      categoryColor: schema.categories.color,
      totalSpent: sql<number>`COALESCE(SUM(ABS(${schema.transactions.amount_minor})), 0)`.mapWith(Number),
    })
    .from(schema.transactions)
    .innerJoin(
      schema.categories,
      eq(schema.transactions.category_id, schema.categories.id),
    )
    .where(
      and(
        whereClause,
        sql`${schema.transactions.amount_minor} < 0`,
      ),
    )
    .groupBy(
      monthExpr,
      schema.categories.id,
      schema.categories.name,
      schema.categories.color,
    )
    .orderBy(monthExpr);

  // Monthly income
  const monthlyIncome = await db
    .select({
      month: monthExpr,
      totalIncome: sql<number>`COALESCE(SUM(${schema.transactions.amount_minor}), 0)`.mapWith(Number),
    })
    .from(schema.transactions)
    .where(
      and(
        whereClause,
        sql`${schema.transactions.amount_minor} > 0`,
      ),
    )
    .groupBy(monthExpr)
    .orderBy(monthExpr);

  // Pivot into monthly buckets
  const months = new Map<
    string,
    {
      month: string;
      income: number;
      categories: Map<
        string,
        { name: string; color: string; amount: number }
      >;
    }
  >();

  for (const row of monthlyIncome) {
    if (!months.has(row.month)) {
      months.set(row.month, {
        month: row.month,
        income: 0,
        categories: new Map(),
      });
    }
    months.get(row.month)!.income = row.totalIncome;
  }

  for (const row of monthlyData) {
    if (!months.has(row.month)) {
      months.set(row.month, {
        month: row.month,
        income: 0,
        categories: new Map(),
      });
    }
    const entry = months.get(row.month)!;
    entry.categories.set(row.categoryId, {
      name: row.categoryName,
      color: row.categoryColor ?? "#6b7280",
      amount: row.totalSpent,
    });
  }

  // Convert to array sorted by month
  const result = Array.from(months.values())
    .map((entry) => ({
      month: entry.month,
      income: entry.income,
      categories: Array.from(entry.categories.values()),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return result;
}
