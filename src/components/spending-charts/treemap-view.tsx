import { ResponsiveContainer, Tooltip, Treemap, type TreemapNode } from "recharts";
import {
  formatAmount,
  formatPercent,
  type CategoryDatum,
  type CurrencyLabel,
} from "./category-data";
import {
  SEGMENT_GAP_STROKE,
  SEGMENT_GAP_WIDTH,
  renderCategoryTooltip,
  svgCategoryButtonProps,
  type SelectCategory,
} from "./chart-parts";

const CHART_HEIGHT = 320;
const ACCENT_HEIGHT = 4;
const LABEL_MIN_WIDTH = 64;
const LABEL_MIN_HEIGHT = 40;
const DETAIL_MIN_HEIGHT = 56;
const APPROX_CHAR_WIDTH = 7;
const TILE_PADDING = 8;

function fitText(text: string, width: number): string {
  const maxChars = Math.floor((width - TILE_PADDING * 2) / APPROX_CHAR_WIDTH);
  if (text.length <= maxChars) return text;
  return maxChars > 1 ? `${text.slice(0, maxChars - 1)}…` : "";
}

/**
 * One category tile. The tile is a tint of the category color topped by a
 * solid accent strip, so the labels can use the theme's foreground color and
 * stay readable on any category color in both light and dark mode. With
 * `onSelect`, the tile is a button that opens the category's expenses.
 */
function renderTreemapTile(
  node: TreemapNode,
  options: {
    data: CategoryDatum[];
    currency: CurrencyLabel;
    onSelect: SelectCategory | undefined;
  },
): React.ReactElement {
  const { x, y, width, height, depth, name } = node;
  if (depth !== 1 || typeof node.color !== "string") return <g />;
  const total = typeof node.total === "number" ? node.total : 0;
  const share = typeof node.share === "number" ? node.share : 0;
  const showLabel = width >= LABEL_MIN_WIDTH && height >= LABEL_MIN_HEIGHT;
  const showDetail = showLabel && height >= DETAIL_MIN_HEIGHT;
  // Recharts copies each datum's fields onto its node; match on both so two
  // categories sharing a name never open each other.
  const datum = options.data.find(
    (candidate) => candidate.name === name && candidate.categoryId === node.categoryId,
  );

  return (
    <g {...svgCategoryButtonProps(datum, options.onSelect)}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={node.color}
        fillOpacity={0.3}
        stroke={SEGMENT_GAP_STROKE}
        strokeWidth={SEGMENT_GAP_WIDTH}
      />
      <rect
        x={x + SEGMENT_GAP_WIDTH}
        y={y + SEGMENT_GAP_WIDTH}
        width={Math.max(0, width - SEGMENT_GAP_WIDTH * 2)}
        height={ACCENT_HEIGHT}
        rx={2}
        fill={node.color}
      />
      {showLabel ? (
        <text
          x={x + TILE_PADDING}
          y={y + ACCENT_HEIGHT + 18}
          className="fill-foreground"
          fontSize={12}
          fontWeight={600}
        >
          {fitText(name, width)}
        </text>
      ) : null}
      {showDetail ? (
        <text
          x={x + TILE_PADDING}
          y={y + ACCENT_HEIGHT + 34}
          className="fill-foreground"
          fontSize={11}
        >
          {fitText(`${formatAmount(total, options.currency)} · ${formatPercent(share)}`, width)}
        </text>
      ) : null}
    </g>
  );
}

/** Each category as a rectangle whose area is its share of spending. */
export function TreemapView({
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
      <Treemap
        data={data}
        dataKey="total"
        nameKey="name"
        aspectRatio={4 / 3}
        content={(node: TreemapNode) => renderTreemapTile(node, { data, currency, onSelect })}
        isAnimationActive={false}
      >
        <Tooltip
          content={({ active, payload }) => renderCategoryTooltip(active, payload?.[0]?.payload, currency)}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}
