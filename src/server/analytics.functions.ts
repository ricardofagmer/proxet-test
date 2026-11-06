import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUserId } from "#/server/session";
import {
  CategoryNotFoundError,
  getCategoryExpensesInternal,
  getDashboardSummaryInternal,
  getSpendingSankeyInternal,
  getSpendingOverTimeInternal,
  type CategoryExpenses,
} from "./analytics.server";


// --- Schemas ---

const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;

const periodSchema = z.object({
  from: z.string().regex(dateRegex, "Invalid date format (YYYY-MM-DD)").optional(),
  to: z.string().regex(dateRegex, "Invalid date format (YYYY-MM-DD)").optional(),
  accountId: z.string().optional(),
});

const categoryExpensesSchema = periodSchema.extend({
  /** Top-level category id, or null for the uncategorized "Other" bucket. */
  categoryId: z.string().min(1).max(128).nullable(),
});

// --- Server Functions ---

/**
 * Fetches high-level dashboard summary: total income, expenses, net, and top spending categories.
 */
export const getDashboardSummary = createServerFn({ method: "GET" })
  .inputValidator(periodSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getDashboardSummaryInternal(userId, data);
  });

/**
 * Fetches spending data formatted for a Sankey diagram: 3-level flow from accounts to categories to subcategories.
 */
export const getSpendingSankey = createServerFn({ method: "GET" })
  .inputValidator(periodSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getSpendingSankeyInternal(userId, data);
  });

/**
 * Fetches monthly spending data broken down by category for bar/line charts.
 */
export const getSpendingOverTime = createServerFn({ method: "GET" })
  .inputValidator(periodSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getSpendingOverTimeInternal(userId, data);
  });

/**
 * Lists every expense counted in one top-level category of the spending chart
 * for the same period and account filter, so the rows add up to the chart's
 * amount. A category the user does not own is reported as not found.
 */
export const getCategoryExpenses = createServerFn({ method: "GET" })
  .inputValidator(categoryExpensesSchema)
  .handler(
    async ({ data }): Promise<{ success: true; data: CategoryExpenses } | { error: string }> => {
      const userId = await requireUserId();
      try {
        return { success: true, data: await getCategoryExpensesInternal(userId, data) };
      } catch (error) {
        if (error instanceof CategoryNotFoundError) return { error: "Category not found" };
        throw error;
      }
    },
  );
