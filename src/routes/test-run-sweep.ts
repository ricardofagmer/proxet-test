import { createFileRoute } from "@tanstack/react-router";
import { runBudgetAlertSweep } from "#/server/budget-alerts.server";
import { runComplianceSweep } from "#/server/compliance.server";

// Test-only endpoint: runs one maintenance pass synchronously — the compliance
// sweep (expired account deletions + ai_raw_response retention) followed by
// the budget-alert sweep — so E2E tests can observe its effects
// deterministically; the real hourly loop is disarmed in TEST_MODE. The
// compliance keys stay at the top level for existing callers; budget-alert
// counts are nested under `budgetAlerts`. Only enabled when TEST_MODE=1.
export const Route = createFileRoute("/test-run-sweep")({
  server: {
    handlers: {
      POST: async () => {
        if (process.env.TEST_MODE !== "1") {
          return new Response("Not available", { status: 404 });
        }
        const compliance = await runComplianceSweep();
        const budgetAlerts = await runBudgetAlertSweep();
        return Response.json({ ...compliance, budgetAlerts });
      },
    },
  },
});
