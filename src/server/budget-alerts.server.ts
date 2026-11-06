import { and, eq } from "drizzle-orm";
import { db as defaultDb, schema } from "#/db";
import { formatMoney } from "#/lib/money";
import { m } from "#/paraglide/messages";
import { currentUtcMonth, listBudgetViews, type BudgetView } from "#/server/budgets.server";
import { sendEmail, type EmailMessage } from "#/server/email";
import { env } from "#/server/env";
import { getLogger } from "#/server/logger";

//
// Over-budget alerts: at most one email per (budget, UTC month). Server-only —
// called fire-and-forget after spend-changing mutations, by the hourly
// maintenance loop and by the TEST_MODE sweep route. The budget_alerts row is
// the idempotency ledger: it is claimed with ON CONFLICT DO NOTHING and moved
// to 'sent' BEFORE the provider call, so two interleaved evaluations can never
// both deliver. Log lines carry ids and counts only — never amounts, limits,
// category names or email addresses.

type Db = typeof defaultDb;

export interface BudgetAlertCounts {
  evaluated: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

function emptyCounts(): BudgetAlertCounts {
  return { evaluated: 0, claimed: 0, sent: 0, skipped: 0, failed: 0 };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function buildBudgetAlertEmail(
  to: string,
  view: BudgetView,
  month: string,
): EmailMessage {
  // A retried pending alert may belong to a budget that is no longer over
  // (limit raised since the failed send); never print a negative overage.
  const overMinor = Math.max(0, view.spent_minor - view.limit_minor);
  return {
    to,
    subject: m.email_budget_exceeded_subject({ category: view.category_name }),
    text: m.email_budget_exceeded_body({
      spent: formatMoney(view.spent_minor, view.currency),
      category: view.category_name,
      month,
      limit: formatMoney(view.limit_minor, view.currency),
      over: formatMoney(overMinor, view.currency),
      link: `${env.email.baseUrl}/budgets`,
    }),
  };
}

async function markSkipped(alertId: string, db: Db): Promise<boolean> {
  const skipped = await db
    .update(schema.budget_alerts)
    .set({ status: "skipped" })
    .where(
      and(
        eq(schema.budget_alerts.id, alertId),
        eq(schema.budget_alerts.status, "pending"),
      ),
    )
    .returning({ id: schema.budget_alerts.id });
  return skipped.length > 0;
}

async function loadVerifiedRecipient(
  userId: string,
  db: Db,
): Promise<string | null> {
  const [user] = await db
    .select({
      email: schema.users.email,
      email_verified_at: schema.users.email_verified_at,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.email || !user.email_verified_at) return null;
  return user.email;
}

/**
 * Claim and deliver over-budget alerts for one user and one UTC month. Only
 * the given month is evaluated — callers reacting to a transaction never pass
 * the transaction's own date, so backdated spend cannot alert a past month.
 */
export async function evaluateBudgetAlerts(
  userId: string,
  month: string = currentUtcMonth(),
  db: Db = defaultDb,
): Promise<BudgetAlertCounts> {
  const counts = emptyCounts();
  const views = await listBudgetViews(userId, month, db);
  if (views.length === 0) return counts;
  counts.evaluated = views.length;

  const overViews = views.filter((view) => view.over_budget);
  if (overViews.length > 0) {
    const claimed = await db
      .insert(schema.budget_alerts)
      .values(
        overViews.map(
          (view): typeof schema.budget_alerts.$inferInsert => ({
            id: crypto.randomUUID(),
            budget_id: view.id,
            user_id: userId,
            month,
            status: "pending",
          }),
        ),
      )
      .onConflictDoNothing({
        target: [schema.budget_alerts.budget_id, schema.budget_alerts.month],
      })
      .returning({ id: schema.budget_alerts.id });
    counts.claimed = claimed.length;
  }

  // Pending covers both fresh claims and rows whose earlier send failed.
  const pending = await db
    .select({
      id: schema.budget_alerts.id,
      budget_id: schema.budget_alerts.budget_id,
    })
    .from(schema.budget_alerts)
    .where(
      and(
        eq(schema.budget_alerts.user_id, userId),
        eq(schema.budget_alerts.month, month),
        eq(schema.budget_alerts.status, "pending"),
      ),
    );
  if (pending.length === 0) return counts;

  const log = getLogger().child({ userId, month });
  const recipient = await loadVerifiedRecipient(userId, db);
  const viewsById = new Map(views.map((view) => [view.id, view]));

  for (const alert of pending) {
    const view = viewsById.get(alert.budget_id);
    // Skipped is terminal: an unverified user must not receive this month's
    // alert later just because they verified their address afterwards.
    if (!recipient || !view) {
      if (await markSkipped(alert.id, db)) counts.skipped++;
      continue;
    }

    const marked = await db
      .update(schema.budget_alerts)
      .set({ status: "sent", sent_at: new Date() })
      .where(
        and(
          eq(schema.budget_alerts.id, alert.id),
          eq(schema.budget_alerts.status, "pending"),
        ),
      )
      .returning({ id: schema.budget_alerts.id });
    // Another concurrent evaluation already took this row.
    if (marked.length === 0) continue;

    try {
      await sendEmail(buildBudgetAlertEmail(recipient, view, month));
      counts.sent++;
    } catch (error) {
      // Back to pending so the hourly sweep retries delivery.
      await db
        .update(schema.budget_alerts)
        .set({ status: "pending", sent_at: null })
        .where(eq(schema.budget_alerts.id, alert.id));
      counts.failed++;
      // Provider errors can echo request details; keep the line to ids.
      log.error(
        { alertId: alert.id, budgetId: alert.budget_id, errorName: errorName(error) },
        "budget alert email failed",
      );
    }
  }

  if (counts.claimed + counts.sent + counts.skipped + counts.failed > 0) {
    log.info({ ...counts }, "budget alerts evaluated");
  }
  return counts;
}

/**
 * Fire-and-forget evaluation for the current UTC month after a mutation has
 * succeeded. Never throws and never delays the caller's response.
 */
export function scheduleBudgetAlertEvaluation(userId: string): void {
  void evaluateBudgetAlerts(userId).catch((error: unknown) => {
    getLogger()
      .child({ userId })
      .error({ err: error }, "budget alert evaluation failed");
  });
}

/**
 * Evaluate every user that has at least one budget for the UTC month of
 * `now`. Catches paths without an inline hook (categorization rules,
 * recategorize, category reassignment) and retries failed sends. One user's
 * failure is counted and logged; the sweep continues with the rest.
 */
export async function runBudgetAlertSweep(
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<{ users: number } & BudgetAlertCounts> {
  const month = currentUtcMonth(now);
  const owners = await db
    .selectDistinct({ userId: schema.budgets.user_id })
    .from(schema.budgets);

  const totals = { users: owners.length, ...emptyCounts() };
  for (const { userId } of owners) {
    try {
      const counts = await evaluateBudgetAlerts(userId, month, db);
      totals.evaluated += counts.evaluated;
      totals.claimed += counts.claimed;
      totals.sent += counts.sent;
      totals.skipped += counts.skipped;
      totals.failed += counts.failed;
    } catch (error) {
      totals.failed++;
      getLogger()
        .child({ userId, month })
        .error({ err: error }, "budget alert evaluation failed during sweep");
    }
  }

  if (totals.claimed + totals.sent + totals.skipped + totals.failed > 0) {
    getLogger().info({ month, ...totals }, "budget alert sweep finished");
  }
  return totals;
}
