import { useId, useRef, useState } from "react";
import { m } from "#/paraglide/messages";
import { cn } from "#/lib/utils";
import { Select, SelectItem } from "#/components/ui/select";
import type { FlowLink, FlowNode } from "#/lib/spending-flow";
import { toCategoryData, type CategoryDatum, type CurrencyLabel } from "./category-data";
import { EmptyChartState, type SelectCategory } from "./chart-parts";
import { CategoryExpensesDialog, type SpendingFilter } from "./category-expenses-dialog";
import { CHART_VIEWS, chartViewLabel, isChartView, useStoredChartView, type ChartView } from "./chart-view";
import { BarsView } from "./bars-view";
import { ColumnsView } from "./columns-view";
import { PieView } from "./pie-view";
import { TreemapView } from "./treemap-view";
import { TableView } from "./table-view";

interface ViewProps {
  data: CategoryDatum[];
  currency: CurrencyLabel;
  onSelect: SelectCategory;
}

function renderView(view: ChartView, props: ViewProps): React.JSX.Element {
  switch (view) {
    case "bars":
      return <BarsView {...props} />;
    case "columns":
      return <ColumnsView {...props} />;
    case "donut":
      return <PieView {...props} variant="donut" />;
    case "pie":
      return <PieView {...props} variant="pie" />;
    case "treemap":
      return <TreemapView {...props} />;
    case "table":
      return <TableView {...props} />;
  }
}

/**
 * Dashboard card: spending per top-level category, shown in the chart type
 * the user picks. Every view draws the same data with the category's own
 * color, so switching views never changes what a color means. Selecting a
 * category (bar, column, slice, legend row, tile or table row) opens a dialog
 * listing its expenses for the same `filter` the chart was drawn with.
 */
export function SpendingByCategoryCard({
  nodes,
  links,
  filter,
  currency,
  className,
}: {
  nodes: FlowNode[];
  links: FlowLink[];
  filter: SpendingFilter;
  /** Code shown after amounts; null when the amounts mix currencies. */
  currency: CurrencyLabel;
  className?: string;
}): React.JSX.Element {
  const headingId = useId();
  const selectId = useId();
  const [view, setView] = useStoredChartView();
  const [selectedCategory, setSelectedCategory] = useState<CategoryDatum | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  // Label of the chart mark or table button that opened the dialog. Recharts
  // remounts bar shapes on re-render, so the opener is found again by label.
  const openerLabelRef = useRef<string | null>(null);
  const data = toCategoryData(nodes, links);

  const openCategory = (datum: CategoryDatum): void => {
    const active = document.activeElement;
    openerLabelRef.current = active?.getAttribute("aria-label") ?? null;
    setSelectedCategory(datum);
    setIsDialogOpen(true);
  };

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className={cn("island-shell rounded-xl p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-sm font-semibold mb-1">
            {m.analytics_spending_by_category()}
          </h2>
          <p className="text-xs text-muted-foreground">{m.analytics_spending_by_category_desc()}</p>
          {data.length > 0 ? (
            <p className="text-xs text-muted-foreground mt-1">{m.analytics_drilldown_hint()}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor={selectId} className="text-xs font-medium text-muted-foreground">
            {m.analytics_chart_type()}
          </label>
          <Select
            id={selectId}
            value={view}
            onChange={(event) => {
              if (isChartView(event.target.value)) setView(event.target.value);
            }}
            className="h-8 w-auto px-2 text-xs"
          >
            {CHART_VIEWS.map((option) => (
              <SelectItem key={option} value={option}>
                {chartViewLabel(option)}
              </SelectItem>
            ))}
          </Select>
        </div>
      </div>
      {data.length === 0 ? (
        <EmptyChartState />
      ) : (
        <figure aria-label={m.analytics_chart_figure({ view: chartViewLabel(view) })}>
          {renderView(view, { data, currency, onSelect: openCategory })}
        </figure>
      )}
      <CategoryExpensesDialog
        category={selectedCategory}
        open={isDialogOpen}
        filter={filter}
        currency={currency}
        onOpenChange={setIsDialogOpen}
        onCloseAutoFocus={(event) => {
          const label = openerLabelRef.current;
          const opener = label
            ? sectionRef.current?.querySelector<HTMLElement | SVGElement>(`[aria-label="${CSS.escape(label)}"]`)
            : null;
          if (!opener) return;
          event.preventDefault();
          opener.focus();
        }}
      />
    </section>
  );
}
