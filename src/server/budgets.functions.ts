import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "#/db";
import { scheduleBudgetAlertEvaluation } from "#/server/budget-alerts.server";
import { checkBudgetLimit, getEntitlements } from "#/server/billing.server";
import {
  currentUtcMonth,
  listBudgetViews,
  monthSchema,
} from "#/server/budgets.server";
import { ownedEntityExists } from "#/server/ownership.server";
import { requireUserId } from "#/server/session";

//
// Budget server functions. Domain logic (spend roll-up, month helpers) lives in
// budgets.server.ts; these wrappers only validate input, scope every statement
// by user_id and map outcomes to the repo's `row | { success } | { error }`
// return convention.

// Postgres `integer` upper bound — limit_minor is an int4 column.
const MAX_LIMIT_MINOR = 2147483647;

const limitMinorSchema = z.number().int().positive().max(MAX_LIMIT_MINOR);

const getBudgetsSchema = z
  .object({
    month: monthSchema.optional(),
  })
  .optional();

const createBudgetSchema = z.object({
  categoryId: z.string().min(1),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code (e.g. PLN, USD)"),
  limitMinor: limitMinorSchema,
});

const updateBudgetSchema = z.object({
  id: z.string().min(1),
  limitMinor: limitMinorSchema,
});

const deleteBudgetSchema = z.object({
  id: z.string().min(1),
});

export const getBudgets = createServerFn({ method: "GET" })
  .inputValidator(getBudgetsSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const month = data?.month ?? currentUtcMonth();
    const [entitlements, budgets] = await Promise.all([
      getEntitlements(userId),
      listBudgetViews(userId, month),
    ]);
    return {
      month,
      limit: entitlements.maxBudgets,
      plan: entitlements.plan,
      budgets,
    };
  });

export const createBudget = createServerFn({ method: "POST" })
  .inputValidator(createBudgetSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    if (!(await ownedEntityExists("category", userId, data.categoryId))) {
      return { error: "Category not found" };
    }

    const limit = await checkBudgetLimit(userId);
    if (!limit.allowed) {
      return { error: limit.error, code: limit.code, limit: limit.limit };
    }

    const id = crypto.randomUUID();
    // ON CONFLICT DO NOTHING turns the unique (user_id, category_id) violation
    // into an empty RETURNING set, so a concurrent duplicate is reported the
    // same way as a sequential one without parsing driver error codes.
    const inserted = await db
      .insert(schema.budgets)
      .values({
        id,
        user_id: userId,
        category_id: data.categoryId,
        currency: data.currency,
        limit_minor: data.limitMinor,
      })
      .onConflictDoNothing()
      .returning({ id: schema.budgets.id });
    if (inserted.length === 0) {
      return { error: "A budget already exists for this category" };
    }

    scheduleBudgetAlertEvaluation(userId);

    return {
      id,
      category_id: data.categoryId,
      currency: data.currency,
      limit_minor: data.limitMinor,
    };
  });

export const updateBudget = createServerFn({ method: "POST" })
  .inputValidator(updateBudgetSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const updated = await db
      .update(schema.budgets)
      .set({ limit_minor: data.limitMinor, updated_at: new Date() })
      .where(
        and(eq(schema.budgets.id, data.id), eq(schema.budgets.user_id, userId)),
      )
      .returning({ id: schema.budgets.id });
    if (updated.length === 0) {
      return { error: "Budget not found" };
    }

    scheduleBudgetAlertEvaluation(userId);

    return { success: true };
  });

export const deleteBudget = createServerFn({ method: "POST" })
  .inputValidator(deleteBudgetSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    // budget_alerts references budgets without a cascade, so the ledger rows
    // go first; both statements carry user_id so a foreign id deletes nothing.
    const deletedCount = await db.transaction(async (tx) => {
      await tx
        .delete(schema.budget_alerts)
        .where(
          and(
            eq(schema.budget_alerts.budget_id, data.id),
            eq(schema.budget_alerts.user_id, userId),
          ),
        );
      const deleted = await tx
        .delete(schema.budgets)
        .where(
          and(
            eq(schema.budgets.id, data.id),
            eq(schema.budgets.user_id, userId),
          ),
        )
        .returning({ id: schema.budgets.id });
      return deleted.length;
    });
    if (deletedCount === 0) {
      return { error: "Budget not found" };
    }
    return { success: true };
  });
