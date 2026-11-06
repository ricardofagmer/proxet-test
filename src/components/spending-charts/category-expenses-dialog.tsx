import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { m } from "#/paraglide/messages";
import { getCategoryExpenses } from "#/server/analytics.functions";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { formatAmount, type CategoryDatum, type CurrencyLabel } from "./category-data";

const CATEGORY_EXPENSES_QUERY_KEY = ["dashboard-category-expenses"] as const;

/** The dashboard filter the chart was drawn with; the list must use the same one. */
export interface SpendingFilter {
  from: string;
  to: string;
  accountId?: string;
}

// Derived from the server function so this client file never imports a server module.
type CategoryExpenses = Extract<
  Awaited<ReturnType<typeof getCategoryExpenses>>,
  { success: true }
>["data"];

function ExpenseRows({
  expenses,
  currency,
}: {
  expenses: CategoryExpenses["expenses"];
  currency: CurrencyLabel;
}): React.JSX.Element {
  return (
    <>
      {expenses.map((expense) => (
        <TableRow key={expense.transactionId}>
          <TableCell className="tabular-nums whitespace-nowrap">{expense.date}</TableCell>
          <TableCell className="max-w-56 truncate">
            {expense.description ?? (
              <span className="text-muted-foreground">{m.analytics_drilldown_no_description()}</span>
            )}
          </TableCell>
          <TableCell>{expense.accountName}</TableCell>
          <TableCell className="text-muted-foreground">
            {expense.subcategoryNames.length > 0 ? expense.subcategoryNames.join(", ") : "—"}
          </TableCell>
          <TableCell className="text-right tabular-nums whitespace-nowrap">
            {formatAmount(expense.amountMinor, currency)}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function ExpenseTable({
  categoryName,
  result,
  currency,
}: {
  categoryName: string;
  result: CategoryExpenses;
  currency: CurrencyLabel;
}): React.JSX.Element {
  if (result.expenses.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {m.analytics_drilldown_empty()}
      </p>
    );
  }
  return (
    <div className="max-h-[55vh] overflow-y-auto">
      <Table>
        <TableCaption className="sr-only">
          {m.analytics_drilldown_table({ name: categoryName })}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{m.date_label()}</TableHead>
            <TableHead scope="col">{m.description_label()}</TableHead>
            <TableHead scope="col">{m.account_filter()}</TableHead>
            <TableHead scope="col">{m.analytics_drilldown_subcategory()}</TableHead>
            <TableHead scope="col" className="text-right">
              {m.amount_label()}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <ExpenseRows expenses={result.expenses} currency={currency} />
        </TableBody>
      </Table>
    </div>
  );
}

function Summary({
  result,
  currency,
}: {
  result: CategoryExpenses;
  currency: CurrencyLabel;
}): React.JSX.Element {
  const totalId = useId();
  const countId = useId();
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div className="flex gap-2">
        <dt id={totalId} className="text-muted-foreground">
          {m.analytics_drilldown_total()}
        </dt>
        <dd aria-labelledby={totalId} className="font-semibold tabular-nums text-foreground">
          {formatAmount(result.totalMinor, currency)}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt id={countId} className="text-muted-foreground">
          {m.analytics_drilldown_count()}
        </dt>
        <dd aria-labelledby={countId} className="font-semibold tabular-nums text-foreground">
          {result.expenses.length}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Every expense behind one category of the "Spending by category" chart, for
 * the dashboard's current period and account. The total comes from the same
 * attribution the chart uses, so it matches the chart's amount. Radix moves
 * focus into the dialog, traps it, closes on Esc and restores focus to the
 * bar, slice or row that opened it. `category` outlives `open` so the content
 * stays in place while the dialog animates out.
 */
export function CategoryExpensesDialog({
  category,
  open,
  filter,
  currency,
  onOpenChange,
  onCloseAutoFocus,
}: {
  category: CategoryDatum | null;
  open: boolean;
  filter: SpendingFilter;
  currency: CurrencyLabel;
  onOpenChange: (open: boolean) => void;
  /** Returns focus on close; Radix only restores it to a DialogTrigger, and this dialog has none. */
  onCloseAutoFocus: (event: Event) => void;
}): React.JSX.Element {
  const getCategoryExpensesFn = useServerFn(getCategoryExpenses);
  const categoryId = category?.categoryId;

  const { data, isLoading, isError } = useQuery({
    queryKey: [...CATEGORY_EXPENSES_QUERY_KEY, categoryId ?? null, filter],
    queryFn: async (): Promise<CategoryExpenses> => {
      const result = await getCategoryExpensesFn({
        data: { ...filter, categoryId: categoryId ?? null },
      });
      if ("error" in result) throw new Error(result.error);
      return result.data;
    },
    enabled: open && categoryId !== undefined,
  });

  return (
    <Dialog open={open && category !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="glass-panel sm:max-w-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {category ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-sm shrink-0"
                  style={{ backgroundColor: category.color }}
                />
                {category.name}
              </DialogTitle>
              <DialogDescription>
                {m.analytics_drilldown_period({ from: filter.from, to: filter.to })}
              </DialogDescription>
              {data ? <Summary result={data} currency={currency} /> : null}
            </DialogHeader>
            {isLoading ? (
              <div role="status" className="flex items-center justify-center gap-3 py-10">
                <span className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">{m.loading()}</span>
              </div>
            ) : isError ? (
              <p role="alert" className="py-10 text-center text-sm text-destructive">
                {m.analytics_drilldown_error()}
              </p>
            ) : data ? (
              <ExpenseTable categoryName={category.name} result={data} currency={currency} />
            ) : null}
            <DialogFooter className="mt-4">
              <DialogClose asChild>
                <Button variant="outline">{m.analytics_drilldown_close()}</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
