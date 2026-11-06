import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPercent, type CategoryDatum, type CurrencyLabel } from "./category-data";
import { renderCategoryTooltip, selectableBarShape, type SelectCategory } from "./chart-parts";

const CHART_HEIGHT = 320;
const CATEGORY_AXIS_HEIGHT = 64;
const MAX_TICK_LENGTH = 14;

function shortenName(name: unknown): string {
  const text = String(name);
  return text.length > MAX_TICK_LENGTH ? `${text.slice(0, MAX_TICK_LENGTH - 1)}…` : text;
}

/**
 * Vertical columns, largest first, with the share above each column. Names
 * are slanted and shortened so many categories still fit; the tooltip shows
 * the full name and amount.
 */
export function ColumnsView({
  data,
  currency,
  onSelect,
}: {
  data: CategoryDatum[];
  currency: CurrencyLabel;
  onSelect?: SelectCategory;
}): React.JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 24, right: 8, bottom: 8, left: 8 }} barCategoryGap="20%">
        <XAxis
          type="category"
          dataKey="name"
          interval={0}
          height={CATEGORY_AXIS_HEIGHT}
          angle={-30}
          textAnchor="end"
          tickLine={false}
          axisLine={false}
          tickFormatter={shortenName}
          tick={{ fontSize: 12, fill: "currentColor" }}
          className="text-foreground"
        />
        <YAxis type="number" dataKey="total" hide domain={[0, "dataMax"]} />
        <Tooltip
          cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
          content={({ active, payload }) => renderCategoryTooltip(active, payload?.[0]?.payload, currency)}
        />
        <Bar
          dataKey="total"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
          shape={selectableBarShape({ data, radius: [4, 4, 0, 0], onSelect })}
        >
          {data.map((datum) => (
            <Cell key={datum.name} fill={datum.color} />
          ))}
          <LabelList
            dataKey="name"
            position="top"
            className="fill-muted-foreground"
            fontSize={12}
            formatter={(name: unknown) => {
              const datum = data.find((candidate) => candidate.name === name);
              return datum ? formatPercent(datum.share) : "";
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
