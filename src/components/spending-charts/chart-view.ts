import { useEffect, useState } from "react";
import { m } from "#/paraglide/messages";

export const CHART_VIEWS = ["bars", "columns", "donut", "pie", "treemap", "table"] as const;

export type ChartView = (typeof CHART_VIEWS)[number];

/** The horizontal bar chart stays the default; users found the old flow chart hard to read. */
const DEFAULT_CHART_VIEW: ChartView = "bars";
const STORAGE_KEY = "dashboard.spendingByCategory.view";

export function isChartView(value: unknown): value is ChartView {
  return typeof value === "string" && CHART_VIEWS.some((view) => view === value);
}

export function chartViewLabel(view: ChartView): string {
  switch (view) {
    case "bars":
      return m.analytics_chart_view_bars();
    case "columns":
      return m.analytics_chart_view_columns();
    case "donut":
      return m.analytics_chart_view_donut();
    case "pie":
      return m.analytics_chart_view_pie();
    case "treemap":
      return m.analytics_chart_view_treemap();
    case "table":
      return m.analytics_chart_view_table();
  }
}

/**
 * The chosen chart view, remembered in localStorage. The first render always
 * uses the default so server and client markup match during hydration; the
 * stored choice is applied after mount. Storage can be unavailable (private
 * mode, blocked cookies, quota) — then the choice simply is not remembered,
 * which is not worth surfacing to the user.
 */
export function useStoredChartView(): [ChartView, (view: ChartView) => void] {
  const [view, setView] = useState<ChartView>(DEFAULT_CHART_VIEW);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isChartView(stored)) setView(stored);
    } catch {
      // Storage unavailable: keep the default view.
    }
  }, []);

  const chooseView = (next: ChartView): void => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice lasts for this page view only.
    }
  };

  return [view, chooseView];
}
