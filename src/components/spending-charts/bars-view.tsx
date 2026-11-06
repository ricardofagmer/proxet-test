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
import { formatAmountAndShare, type CategoryDatum, type CurrencyLabel } from "./category-data";
import { renderCategoryTooltip, selectableBarShape, type SelectCategory } from "./chart-parts";

const ROW_HEIGHT = 40;
const CATEGORY_AXIS_WIDTH = 130;
const LABEL_SPACE = 150;

/** Horizontal bars, largest first, with the amount and share beside each bar. */
export function BarsView({
  data,
  currency,
  onSelect,
}: {
  data: CategoryDatum[];
  currency: CurrencyLabel;
  onSelect?: SelectCategory;
}): React.JSX.Element {
  const height = Math.max(160, data.length * ROW_HEIGHT + 16);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: LABEL_SPACE, bottom: 8, left: 0 }}
        barCategoryGap={8}
      >
        <XAxis type="number" dataKey="total" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="name"
          width={CATEGORY_AXIS_WIDTH}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: "currentColor" }}
          className="text-foreground"
        />
        <Tooltip
          cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
          content={({ active, payload }) => renderCategoryTooltip(active, payload?.[0]?.payload, currency)}
        />
        <Bar
          dataKey="total"
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          shape={selectableBarShape({ data, radius: [0, 4, 4, 0], onSelect })}
        >
          {data.map((datum) => (
            <Cell key={datum.name} fill={datum.color} />
          ))}
          <LabelList
            dataKey="name"
            position="right"
            className="fill-muted-foreground"
            fontSize={12}
            formatter={(name: unknown) => {
              const datum = data.find((candidate) => candidate.name === name);
              // Recharts wraps SVG labels at spaces when a wider font (e.g. on
              // Linux) overflows its measured width; non-breaking spaces keep
              // "165.50 PLN · 100%" on one line.
              return datum ? formatAmountAndShare(datum, currency).replace(/ /g, "\u00A0") : "";
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
