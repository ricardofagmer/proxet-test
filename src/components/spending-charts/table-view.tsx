import { m } from "#/paraglide/messages";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import {
  canOpenCategory,
  formatAmount,
  formatPercent,
  type CategoryDatum,
  type CurrencyLabel,
} from "./category-data";
import type { SelectCategory } from "./chart-parts";

function CategoryName({ datum }: { datum: CategoryDatum }): React.JSX.Element {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-3 rounded-sm shrink-0"
        style={{ backgroundColor: datum.color }}
      />
      {datum.name}
    </span>
  );
}

/**
 * The same numbers as the charts, as a plain table for screen readers and
 * exact reading. With `onSelect`, each category name is a button that opens
 * its expenses.
 */
export function TableView({
  data,
  currency,
  onSelect,
}: {
  data: CategoryDatum[];
  currency: CurrencyLabel;
  onSelect?: SelectCategory;
}): React.JSX.Element {
  return (
    <Table>
      <TableCaption className="sr-only">{m.analytics_spending_by_category()}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{m.analytics_table_category()}</TableHead>
          <TableHead scope="col" className="text-right">
            {m.analytics_table_amount()}
          </TableHead>
          <TableHead scope="col" className="text-right">
            {m.analytics_table_share()}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((datum) => (
          <TableRow key={datum.name}>
            <TableHead scope="row" className="h-auto p-2">
              {onSelect && canOpenCategory(datum) ? (
                <button
                  type="button"
                  aria-label={m.analytics_category_open({ name: datum.name })}
                  onClick={() => onSelect(datum)}
                  className="rounded-sm text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <CategoryName datum={datum} />
                </button>
              ) : (
                <CategoryName datum={datum} />
              )}
            </TableHead>
            <TableCell className="text-right tabular-nums">{formatAmount(datum.total, currency)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatPercent(datum.share)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
