import type { KeyboardEvent } from "react";
import { Rectangle, type BarShapeProps } from "recharts";
import { m } from "#/paraglide/messages";
import {
  canOpenCategory,
  formatAmount,
  formatPercent,
  isCategoryDatum,
  type CategoryDatum,
  type CurrencyLabel,
} from "./category-data";

/** Opens the expense list of one category; absent when the card offers no drill-down. */
export type SelectCategory = (datum: CategoryDatum) => void;

const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Makes an SVG chart mark (bar, column, tile) a keyboard-operable button that
 * opens the category's expenses. Marks that cannot be opened stay inert.
 */
export function svgCategoryButtonProps(
  datum: CategoryDatum | undefined,
  onSelect: SelectCategory | undefined,
): React.SVGProps<SVGGElement> {
  if (!datum || !onSelect || !canOpenCategory(datum)) return {};
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": m.analytics_category_open({ name: datum.name }),
    className: FOCUS_RING,
    onClick: () => onSelect(datum),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect(datum);
    },
  };
}

/**
 * Bar shape for the bars and columns views: the regular rounded bar wrapped
 * in a focusable button, so a click or Enter/Space opens the category.
 */
export function selectableBarShape(options: {
  data: CategoryDatum[];
  radius: [number, number, number, number];
  onSelect: SelectCategory | undefined;
}): (props: BarShapeProps) => React.ReactElement {
  return function SelectableBar(props) {
    const datum = options.data[props.index];
    return (
      <g {...svgCategoryButtonProps(datum, options.onSelect)}>
        <Rectangle
          x={props.x}
          y={props.y}
          width={props.width}
          height={props.height}
          radius={options.radius}
          fill={datum?.color}
        />
      </g>
    );
  };
}

/** Gap between adjacent slices/tiles, painted in the page surface color. */
export const SEGMENT_GAP_STROKE = "var(--background)";
export const SEGMENT_GAP_WIDTH = 2;

/**
 * Tooltip body shared by every chart view. Recharts hands over an untyped
 * payload, so it is narrowed before anything is rendered.
 */
export function renderCategoryTooltip(
  active: boolean | undefined,
  payload: unknown,
  currency: CurrencyLabel,
): React.ReactNode {
  if (!active || !isCategoryDatum(payload)) return null;
  return (
    <div className="island-shell rounded-lg p-3 shadow-lg border border-line/50">
      <p className="text-xs font-medium mb-1 text-foreground">{payload.name}</p>
      <p className="text-sm font-bold tabular-nums text-foreground">
        {formatAmount(payload.total, currency)}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {m.analytics_category_share_of_total({
          percent: String(Math.round(payload.share * 100)),
        })}
      </p>
    </div>
  );
}

function LegendRowContent({
  datum,
  currency,
}: {
  datum: CategoryDatum;
  currency: CurrencyLabel;
}): React.JSX.Element {
  return (
    <>
      <span
        aria-hidden="true"
        className="size-3 rounded-sm shrink-0"
        style={{ backgroundColor: datum.color }}
      />
      <span className="flex-1 truncate text-left text-foreground">{datum.name}</span>
      <span className="tabular-nums text-foreground">{formatAmount(datum.total, currency)}</span>
      <span className="w-10 text-right tabular-nums text-muted-foreground">
        {formatPercent(datum.share)}
      </span>
    </>
  );
}

/**
 * Legend for the pie and donut views: color, name, amount and share. With
 * `onSelect`, each row is a button that opens the category's expenses — the
 * keyboard path for the slices.
 */
export function CategoryLegend({
  data,
  currency,
  onSelect,
}: {
  data: CategoryDatum[];
  currency: CurrencyLabel;
  onSelect?: SelectCategory;
}): React.JSX.Element {
  return (
    <ul aria-label={m.analytics_chart_legend()} className="space-y-1.5 text-sm min-w-0">
      {data.map((datum) => (
        <li key={datum.name}>
          {onSelect && canOpenCategory(datum) ? (
            <button
              type="button"
              aria-label={m.analytics_category_open({ name: datum.name })}
              onClick={() => onSelect(datum)}
              className="flex w-full items-center gap-2 rounded-md px-1 -mx-1 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <LegendRowContent datum={datum} currency={currency} />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <LegendRowContent datum={datum} currency={currency} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EmptyChartState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-80 text-center">
      <p className="text-sm text-muted-foreground">{m.analytics_no_data()}</p>
      <p className="text-xs text-muted-foreground mt-1">{m.analytics_no_data_desc()}</p>
    </div>
  );
}
