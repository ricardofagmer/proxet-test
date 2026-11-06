import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { m } from "#/paraglide/messages";
import {
  canOpenCategory,
  formatAmount,
  type CategoryDatum,
  type CurrencyLabel,
} from "./category-data";
import {
  CategoryLegend,
  SEGMENT_GAP_STROKE,
  SEGMENT_GAP_WIDTH,
  renderCategoryTooltip,
  type SelectCategory,
} from "./chart-parts";

/**
 * Share of spending per category as a pie, or as a donut with the period's
 * total in the centre. Slices start at 12 o'clock and run clockwise, largest
 * first; the legend beside it carries every name, amount and share. Clicking
 * a slice or a legend row (the keyboard path) opens the category's expenses.
 */
export function PieView({
  data,
  variant,
  currency,
  onSelect,
}: {
  data: CategoryDatum[];
  variant: "pie" | "donut";
  currency: CurrencyLabel;
  onSelect?: SelectCategory;
}): React.JSX.Element {
  const isDonut = variant === "donut";
  const totalSpent = data.reduce((sum, datum) => sum + datum.total, 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-center">
      <div className="relative h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => renderCategoryTooltip(active, payload?.[0]?.payload, currency)}
            />
            <Pie
              data={data}
              dataKey="total"
              nameKey="name"
              innerRadius={isDonut ? "62%" : 0}
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              stroke={SEGMENT_GAP_STROKE}
              strokeWidth={SEGMENT_GAP_WIDTH}
              isAnimationActive={false}
              className={onSelect ? "cursor-pointer" : undefined}
              onClick={(_sector, index) => {
                const datum = data[index];
                if (datum && onSelect && canOpenCategory(datum)) onSelect(datum);
              }}
            >
              {data.map((datum) => (
                <Cell key={datum.name} fill={datum.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {isDonut ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted-foreground">{m.analytics_chart_total()}</span>
            <span className="text-lg font-bold tabular-nums text-foreground">
              {formatAmount(totalSpent, currency)}
            </span>
          </div>
        ) : null}
      </div>
      <CategoryLegend data={data} currency={currency} onSelect={onSelect} />
    </div>
  );
}
