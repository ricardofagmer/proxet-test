import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useId, useState, useMemo } from "react";
import { m } from "#/paraglide/messages";
import { Select, SelectItem } from "#/components/ui/select";
import {
  getDashboardSummary,
  getSpendingSankey,
} from "#/server/analytics.functions";
import { getAccounts } from "#/server/accounts.functions";
import { SpendingByCategoryCard } from "#/components/spending-charts/spending-by-category-card";
import { formatAmount, type CurrencyLabel } from "#/components/spending-charts/category-data";
import { format } from "date-fns";


export const Route = createFileRoute("/_authed/dashboard")({
  component: Dashboard,
});

// --- Period presets ---

type PeriodPreset = "current_month" | "last_3_months" | "last_6_months" | "last_year";

function getPeriodDates(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date();
  const to = format(now, "yyyy-MM-dd");

  let from: string;
  switch (preset) {
    case "current_month":
      from = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
      break;
    case "last_3_months":
      from = format(new Date(now.getFullYear(), now.getMonth() - 2, 1), "yyyy-MM-dd");
      break;
    case "last_6_months":
      from = format(new Date(now.getFullYear(), now.getMonth() - 5, 1), "yyyy-MM-dd");
      break;
    case "last_year":
      from = format(new Date(now.getFullYear() - 1, now.getMonth(), 1), "yyyy-MM-dd");
      break;
  }

  return { from, to };
}

/**
 * The one currency code the totals are in. With no data the default account
 * currency is shown; with several currencies no code is truthful, so null.
 */
function toCurrencyLabel(currencies: string[]): CurrencyLabel {
  if (currencies.length === 0) return m.analytics_currency();
  return currencies.length === 1 ? (currencies[0] ?? null) : null;
}

// --- Summary Card Component ---

function SummaryCard({
  title,
  value,
  accent,
}: {
  title: string;
  value: string;
  accent: "income" | "expense" | "net";
}) {
  const colorMap = {
    income: "text-emerald-600 dark:text-emerald-400",
    expense: "text-red-600 dark:text-red-400",
    net: "text-blue-600 dark:text-blue-400",
  };

  const bgMap = {
    income: "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20",
    expense: "border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20",
    net: "border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20",
  };

  return (
    <div
      className={`rounded-xl border p-4 ${bgMap[accent]} transition-colors`}
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
        {title}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${colorMap[accent]}`}>
        {value}
      </p>
    </div>
  );
}

// --- Period Selector ---

function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodPreset;
  onChange: (preset: PeriodPreset) => void;
}) {
  const presets: { key: PeriodPreset; label: string }[] = [
    { key: "current_month", label: m.analytics_current_month() },
    { key: "last_3_months", label: m.analytics_last_3_months() },
    { key: "last_6_months", label: m.analytics_last_6_months() },
    { key: "last_year", label: m.analytics_last_year() },
  ];

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-muted-foreground">
        {m.analytics_period()}:
      </label>
      <div className="flex gap-1">
        {presets.map((preset) => (
          <button
            key={preset.key}
            onClick={() => onChange(preset.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              value === preset.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Account Filter ---

function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: Array<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const selectId = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="text-sm font-medium text-muted-foreground">
        {m.account_filter()}:
      </label>
      <Select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-auto px-2 text-xs"
      >
        <SelectItem value="">{m.analytics_all_accounts()}</SelectItem>
        {accounts.map((acc) => (
          <SelectItem key={acc.id} value={acc.id}>
            {acc.name}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}

// --- Top Categories List ---

function TopCategoriesList({
  categories,
  currency,
}: {
  currency: CurrencyLabel;
  categories: Array<{
    categoryId: string;
    categoryName: string;
    categoryColor: string | null;
    totalSpent: number;
  }>;
}) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="island-shell rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">{m.analytics_top_categories()}</h3>
      <div className="space-y-2">
        {categories.map((cat, idx) => (
          <div key={cat.categoryId} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-4 text-right tabular-nums">
              {idx + 1}
            </span>
            <span
              className="size-3 rounded-full shrink-0"
              style={{ backgroundColor: cat.categoryColor ?? "#6b7280" }}
            />
            <span className="flex-1 text-sm truncate">{cat.categoryName}</span>
            <span className="text-sm font-medium tabular-nums">
              {formatAmount(cat.totalSpent, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main Dashboard ---

function Dashboard() {
  const [period, setPeriod] = useState<PeriodPreset>("current_month");
  const [accountId, setAccountId] = useState<string>("");

  const periodDates = useMemo(() => getPeriodDates(period), [period]);

  const filterParams = useMemo(
    () => ({
      from: periodDates.from,
      to: periodDates.to,
      accountId: accountId || undefined,
    }),
    [periodDates, accountId],
  );

  const getSummaryFn = useServerFn(getDashboardSummary);
  const getSankeyFn = useServerFn(getSpendingSankey);
  const getAccountsFn = useServerFn(getAccounts);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["dashboard-summary", filterParams],
    queryFn: () => getSummaryFn({ data: filterParams }),
  });

  const { data: sankeyData, isLoading: sankeyLoading } = useQuery({
    queryKey: ["dashboard-sankey", filterParams],
    queryFn: () => getSankeyFn({ data: filterParams }),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => getAccountsFn(),
  });

  const isLoading = summaryLoading || sankeyLoading;
  const currencies = summary?.currencies ?? [];
  const currencyLabel = toCurrencyLabel(currencies);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-line/50 bg-header-bg/80 backdrop-blur-sm">
        <div className="page-wrap py-4">
          <h1 className="text-xl font-bold display-title mb-3">
            {m.dashboard_heading()}
          </h1>
          <div className="flex flex-wrap items-center gap-4">
            <PeriodSelector value={period} onChange={setPeriod} />
            <AccountFilter
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="page-wrap py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">
                {m.loading()}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard
                title={m.analytics_total_income()}
                value={formatAmount(summary?.totalIncome ?? 0, currencyLabel)}
                accent="income"
              />
              <SummaryCard
                title={m.analytics_total_expenses()}
                value={formatAmount(summary?.totalExpenses ?? 0, currencyLabel)}
                accent="expense"
              />
              <SummaryCard
                title={m.analytics_net()}
                value={formatAmount(summary?.net ?? 0, currencyLabel)}
                accent="net"
              />
            </div>
            {currencies.length > 1 ? (
              <p role="note" className="-mt-4 text-sm text-muted-foreground">
                {m.analytics_mixed_currencies({ currencies: currencies.join(", ") })}
              </p>
            ) : null}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <SpendingByCategoryCard
                className="lg:col-span-2"
                nodes={sankeyData?.nodes ?? []}
                links={sankeyData?.links ?? []}
                filter={filterParams}
                currency={currencyLabel}
              />

              {/* Top Categories */}
              <div>
                <TopCategoriesList
                  categories={summary?.topCategories ?? []}
                  currency={currencyLabel}
                />
              </div>
            </div>

            {/* Outlet for nested routes */}
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}
