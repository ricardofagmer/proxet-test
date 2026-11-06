import { m } from "#/paraglide/messages";
import { formatMinor } from "#/lib/money";
import { prepareSpendingFlow, type FlowLink, type FlowNode } from "#/lib/spending-flow";

//
// Shared data shape and formatting for every "Spending by category" view, so
// each chart shows the same numbers, colors and wording.

const FALLBACK_COLOR = "#6b7280";

// A type alias rather than an interface: recharts' Treemap requires data
// assignable to an index-signature type, which interfaces never are.
export type CategoryDatum = {
  name: string;
  /**
   * Top-level category id; null for the uncategorized "Other" bucket; absent
   * when the server sent no id, in which case the category cannot be opened.
   */
  categoryId?: string | null;
  /** The category's own color; it follows the category, never its rank. */
  color: string;
  /** Spending in minor units. */
  total: number;
  /** total / all spending, 0..1. */
  share: number;
};

/**
 * Top-level categories with spending, largest first. Built from the
 * dashboard's spending-flow data (account -> category -> subcategory) by
 * keeping only the category column.
 */
export function toCategoryData(nodes: FlowNode[], links: FlowLink[]): CategoryDatum[] {
  return prepareSpendingFlow(nodes, links)
    .nodes.filter((node) => node.depth === 1 && node.total > 0)
    .map((node) => ({
      name: node.name,
      ...(node.categoryId === undefined ? {} : { categoryId: node.categoryId }),
      color: node.color ?? FALLBACK_COLOR,
      total: node.total,
      share: node.share,
    }))
    .sort((a, b) => b.total - a.total);
}

export function isCategoryDatum(value: unknown): value is CategoryDatum {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "color" in value &&
    typeof value.color === "string" &&
    "total" in value &&
    typeof value.total === "number" &&
    "share" in value &&
    typeof value.share === "number"
  );
}

/**
 * The currency code shown after amounts, or null when the amounts mix
 * currencies and no single code is truthful.
 */
export type CurrencyLabel = string | null;

export function formatAmount(totalMinor: number, currency: CurrencyLabel): string {
  const amount = formatMinor(totalMinor);
  return currency ? `${amount} ${currency}` : amount;
}

export function formatPercent(share: number): string {
  const percent = Math.round(share * 100);
  return percent < 1
    ? m.analytics_chart_percent_small()
    : m.analytics_chart_percent({ percent: String(percent) });
}

/** "123.45 PLN · 12%" — the direct label next to a bar. */
export function formatAmountAndShare(datum: CategoryDatum, currency: CurrencyLabel): string {
  const amount = formatAmount(datum.total, currency);
  const percent = Math.round(datum.share * 100);
  return percent < 1
    ? m.analytics_category_share_small({ amount })
    : m.analytics_category_share({ amount, percent: String(percent) });
}

/** Whether the datum carries enough to list its expenses. */
export function canOpenCategory(datum: CategoryDatum): boolean {
  return datum.categoryId !== undefined;
}
