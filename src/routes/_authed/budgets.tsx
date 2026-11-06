import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { m } from "#/paraglide/messages";
import { formatMoney, minorToInputValue, parseAmountToMinor } from "#/lib/money";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { CategoryBadge } from "#/components/ui/category-badge";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { ProgressBar } from "#/components/ui/progress-bar";
import { Select, SelectItem } from "#/components/ui/select";
import { QuickCreateCategoryDialog } from "#/components/quick-create-category-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { getAccounts } from "#/server/accounts.functions";
import {
  getBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
} from "#/server/budgets.functions";
import { getCategories } from "#/server/categories.functions";

export const Route = createFileRoute("/_authed/budgets")({
  component: BudgetsPage,
});

const BUDGETS_QUERY_KEY = ["budgets"] as const;
const CATEGORIES_QUERY_KEY = ["categories"] as const;
const ACCOUNTS_QUERY_KEY = ["accounts"] as const;

// Mirrors the server's int4 bound so the user sees the error before submit.
const MAX_LIMIT_MINOR = 2147483647;
// accounts.currency is nullable; the column default is what the server counts.
const DEFAULT_CURRENCY = "PLN";

type BudgetRow = Awaited<ReturnType<typeof getBudgets>>["budgets"][number];
type CategoryRow = Awaited<ReturnType<typeof getCategories>>[number];

interface CategoryOption {
  id: string;
  label: string;
}

interface ParentCategoryOption {
  id: string;
  name: string;
}

/** Categories in tree order (by sort_order), each with a depth prefix. */
function buildCategoryOptions(categories: CategoryRow[]): CategoryOption[] {
  const childrenByParent = new Map<string | null, CategoryRow[]>();
  const knownIds = new Set(categories.map((c) => c.id));
  for (const category of categories) {
    // An orphaned parent_id is shown at the top level rather than dropped.
    const parentKey =
      category.parent_id && knownIds.has(category.parent_id)
        ? category.parent_id
        : null;
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(category);
    childrenByParent.set(parentKey, siblings);
  }
  const options: CategoryOption[] = [];
  const visited = new Set<string>();
  const walk = (parentKey: string | null, depth: number): void => {
    const siblings = [...(childrenByParent.get(parentKey) ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    for (const category of siblings) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      options.push({
        id: category.id,
        label: `${"— ".repeat(depth)}${category.name}`,
      });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return options;
}

function distinctCurrencies(
  accounts: { currency: string | null }[],
): string[] {
  return [
    ...new Set(accounts.map((a) => a.currency ?? DEFAULT_CURRENCY)),
  ];
}

// --- Budget form (add / edit limit) ---

interface BudgetFormData {
  categoryId: string;
  currency: string;
  limitMinor: number;
}

/** Mounted only while open (keyed by the edited budget), so its state is
 * initialised from props on every open without a syncing effect. */
function BudgetForm({
  editingBudget,
  categoryOptions,
  parentCategoryOptions,
  currencyOptions,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  editingBudget: BudgetRow | null;
  categoryOptions: CategoryOption[];
  parentCategoryOptions: ParentCategoryOption[];
  currencyOptions: string[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (data: BudgetFormData) => void;
}) {
  const [categoryId, setCategoryId] = useState(
    () => editingBudget?.category_id ?? "",
  );
  const [currency, setCurrency] = useState(
    () => editingBudget?.currency ?? currencyOptions[0] ?? DEFAULT_CURRENCY,
  );
  const [limit, setLimit] = useState(() =>
    editingBudget ? String(minorToInputValue(editingBudget.limit_minor)) : "",
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBudget && !categoryId) {
      setValidationError(m.budgets_category_required());
      return;
    }
    const limitMinor = parseAmountToMinor(limit);
    if (limitMinor === null || limitMinor <= 0) {
      setValidationError(m.budgets_limit_invalid());
      return;
    }
    if (limitMinor > MAX_LIMIT_MINOR) {
      setValidationError(m.budgets_limit_too_large());
      return;
    }
    setValidationError(null);
    onSubmit({ categoryId, currency, limitMinor });
  };

  const isEditing = editingBudget !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? m.budgets_edit() : m.budgets_add()}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="budget-category" className="mb-1">
              {m.budgets_category_label()}
            </Label>
            <div className="flex items-center gap-2">
              <Select
                id="budget-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={isEditing}
              >
                {editingBudget ? (
                  <SelectItem value={editingBudget.category_id}>
                    {editingBudget.category_name}
                  </SelectItem>
                ) : (
                  <>
                    <SelectItem value="">
                      {m.budgets_category_placeholder()}
                    </SelectItem>
                    {categoryOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </>
                )}
              </Select>
              {!isEditing && (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setIsCreatingCategory(true)}
                  disabled={pending}
                >
                  {m.quick_create_category_button()}
                </Button>
              )}
            </div>
            {!isEditing && categoryOptions.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {m.budgets_all_categories_budgeted()}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="budget-currency" className="mb-1">
              {m.budgets_currency_label()}
            </Label>
            <Select
              id="budget-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={isEditing}
            >
              {editingBudget ? (
                <SelectItem value={editingBudget.currency}>
                  {editingBudget.currency}
                </SelectItem>
              ) : (
                currencyOptions.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))
              )}
            </Select>
          </div>

          <div>
            <Label htmlFor="budget-limit" className="mb-1">
              {m.budgets_limit_label()}
            </Label>
            <Input
              id="budget-limit"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              aria-invalid={validationError !== null}
              autoFocus={isEditing}
            />
          </div>

          {error && (
            <div className="text-destructive text-sm" role="alert">
              {error}
            </div>
          )}
          {validationError && (
            <div className="text-destructive text-sm" role="alert">
              {validationError}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              {m.cancel()}
            </Button>
            <Button type="submit" disabled={pending}>
              {m.budgets_save()}
            </Button>
          </DialogFooter>
        </form>

        {isCreatingCategory && (
          <QuickCreateCategoryDialog
            parentCategories={parentCategoryOptions}
            onCreated={(id) => {
              setCategoryId(id);
              setValidationError(null);
            }}
            onClose={() => setIsCreatingCategory(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Remove confirmation ---

function RemoveBudgetConfirm({
  budget,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  budget: BudgetRow | null;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={budget !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{m.budgets_remove_confirm_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.budgets_remove_confirm_description({
              category: budget?.category_name ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div
            className="text-destructive text-sm p-3 rounded-md bg-destructive/10"
            role="alert"
          >
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={pending}>
            {m.cancel()}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              // Keep the dialog open until the server answers so a failure
              // can be shown in place; it closes via state on success.
              e.preventDefault();
              onConfirm();
            }}
          >
            {m.delete()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Budget card ---

function BudgetCard({
  budget,
  hasSubcategories,
  onEdit,
  onRemove,
}: {
  budget: BudgetRow;
  hasSubcategories: boolean;
  onEdit: (budget: BudgetRow) => void;
  onRemove: (budget: BudgetRow) => void;
}) {
  const percent = (budget.spent_minor / budget.limit_minor) * 100;
  return (
    <article
      aria-label={budget.category_name}
      className="island-shell rounded-xl p-4 space-y-3"
      data-testid="budget-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge
            name={budget.category_name}
            color={budget.category_color}
          />
          {budget.over_budget && (
            <Badge variant="destructive">{m.budgets_over_badge()}</Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="xs" onClick={() => onEdit(budget)}>
            {m.budgets_edit()}
          </Button>
          <Button variant="outline" size="xs" onClick={() => onRemove(budget)}>
            {m.budgets_remove()}
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{m.budgets_limit()}</dt>
          <dd className="font-medium tabular-nums">
            {formatMoney(budget.limit_minor, budget.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{m.budgets_spent()}</dt>
          <dd className="font-medium tabular-nums">
            {formatMoney(budget.spent_minor, budget.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{m.budgets_left()}</dt>
          {budget.over_budget ? (
            <dd className="font-medium tabular-nums text-destructive">
              {m.budgets_over_by({
                amount: formatMoney(-budget.remaining_minor, budget.currency),
              })}
            </dd>
          ) : (
            <dd className="font-medium tabular-nums">
              {formatMoney(budget.remaining_minor, budget.currency)}
            </dd>
          )}
        </div>
      </dl>

      <ProgressBar
        value={percent}
        variant={budget.over_budget ? "destructive" : "default"}
        label={m.budgets_progress_label({ category: budget.category_name })}
      />
      {hasSubcategories && (
        <p className="text-xs text-muted-foreground">
          {m.budgets_includes_subcategories()}
        </p>
      )}
    </article>
  );
}

// --- Empty state ---

function EmptyState({
  title,
  description,
  link,
}: {
  title?: string;
  description: string;
  link?: { to: "/accounts" | "/categories"; label: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {title && <h2 className="text-base font-medium mb-1">{title}</h2>}
      <p className="text-sm text-muted-foreground mb-4 max-w-sm">
        {description}
      </p>
      {link && (
        <Link
          to={link.to}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}

// --- Page ---

function BudgetsPage() {
  const queryClient = useQueryClient();
  const getBudgetsFn = useServerFn(getBudgets);
  const getCategoriesFn = useServerFn(getCategories);
  const getAccountsFn = useServerFn(getAccounts);
  const createBudgetFn = useServerFn(createBudget);
  const updateBudgetFn = useServerFn(updateBudget);
  const deleteBudgetFn = useServerFn(deleteBudget);

  const budgetsQuery = useQuery({
    queryKey: BUDGETS_QUERY_KEY,
    queryFn: () => getBudgetsFn({ data: {} }),
    // Spend changes whenever transactions change elsewhere in the app, so
    // the page always recomputes on visit.
    refetchOnMount: true,
    staleTime: 0,
  });
  const categoriesQuery = useQuery({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: () => getCategoriesFn(),
  });
  const accountsQuery = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => getAccountsFn(),
  });

  const invalidateBudgets = () =>
    queryClient.invalidateQueries({ queryKey: BUDGETS_QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: (data: BudgetFormData) => createBudgetFn({ data }),
    onSuccess: invalidateBudgets,
  });
  const updateMutation = useMutation({
    mutationFn: (data: { id: string; limitMinor: number }) =>
      updateBudgetFn({ data }),
    onSuccess: invalidateBudgets,
  });
  const deleteMutation = useMutation({
    mutationFn: (data: { id: string }) => deleteBudgetFn({ data }),
    onSuccess: invalidateBudgets,
  });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removingBudget, setRemovingBudget] = useState<BudgetRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const budgetsData = budgetsQuery.data;
  const budgets = budgetsData?.budgets ?? [];
  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const planLimit = budgetsData?.limit ?? null;
  const atCap = planLimit !== null && budgets.length >= planLimit;

  const budgetedCategoryIds = new Set(budgets.map((b) => b.category_id));
  const availableCategoryOptions = buildCategoryOptions(categories).filter(
    (option) => !budgetedCategoryIds.has(option.id),
  );
  const parentIds = new Set(categories.map((c) => c.parent_id));
  const parentCategoryOptions: ParentCategoryOption[] = categories
    .filter((c) => c.parent_id === null)
    .map((c) => ({ id: c.id, name: c.name }));
  const currencyOptions = distinctCurrencies(accounts);

  const isLoading =
    budgetsQuery.isLoading || categoriesQuery.isLoading || accountsQuery.isLoading;
  const loadFailed =
    budgetsQuery.isError || categoriesQuery.isError || accountsQuery.isError;
  const hasAccounts = accounts.length > 0;
  const canAdd = !isLoading && !loadFailed && hasAccounts && categories.length > 0;

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingBudget(null);
    setFormError(null);
  };

  const handleAdd = () => {
    setEditingBudget(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleEdit = (budget: BudgetRow) => {
    setEditingBudget(budget);
    setFormError(null);
    setIsFormOpen(true);
  };

  /** Saves the form; resolves to the message to show, or null on success. */
  const saveBudget = async (data: BudgetFormData): Promise<string | null> => {
    if (editingBudget) {
      const result = await updateMutation.mutateAsync({
        id: editingBudget.id,
        limitMinor: data.limitMinor,
      });
      return "error" in result ? (result.error ?? m.unknown_error()) : null;
    }
    const result = await createMutation.mutateAsync(data);
    if (!("error" in result)) return null;
    return "code" in result && result.code === "budget_limit_reached"
      ? m.budgets_limit_reached({ limit: result.limit })
      : (result.error ?? m.unknown_error());
  };

  const handleFormSubmit = async (data: BudgetFormData) => {
    setFormError(null);
    try {
      const message = await saveBudget(data);
      if (message !== null) {
        setFormError(message);
        return;
      }
    } catch {
      // Transport failure (network, session expiry): the dialog stays open
      // with the user's input so they can retry.
      setFormError(m.unknown_error());
      return;
    }
    closeForm();
  };

  const handleRemoveConfirm = async () => {
    if (!removingBudget) return;
    setRemoveError(null);
    try {
      const result = await deleteMutation.mutateAsync({ id: removingBudget.id });
      if ("error" in result) {
        setRemoveError(result.error ?? m.unknown_error());
        return;
      }
    } catch {
      setRemoveError(m.unknown_error());
      return;
    }
    setRemovingBudget(null);
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">{m.loading()}</span>
          </div>
        </div>
      );
    }
    if (loadFailed) {
      return (
        <div
          className="p-3 rounded-md bg-destructive/10 text-destructive text-sm"
          role="alert"
        >
          {m.unknown_error()}
        </div>
      );
    }
    if (!hasAccounts) {
      return (
        <EmptyState
          title={m.budgets_no_accounts_title()}
          description={m.budgets_no_accounts_description()}
          link={{ to: "/accounts", label: m.budgets_no_accounts_link() }}
        />
      );
    }
    if (categories.length === 0) {
      return (
        <EmptyState
          description={m.budgets_no_categories_description()}
          link={{ to: "/categories", label: m.budgets_no_categories_link() }}
        />
      );
    }
    if (budgets.length === 0) {
      return (
        <EmptyState
          title={m.budgets_empty_title()}
          description={m.budgets_empty_description()}
        />
      );
    }
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {budgets.map((budget) => (
          <BudgetCard
            key={budget.id}
            budget={budget}
            hasSubcategories={parentIds.has(budget.category_id)}
            onEdit={handleEdit}
            onRemove={(b) => {
              setRemoveError(null);
              setRemovingBudget(b);
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line/50 bg-header-bg/80 backdrop-blur-sm">
        <div className="page-wrap py-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold display-title">
              {m.budgets_title()}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {m.budgets_description()}
            </p>
            {budgetsData && (
              <p className="text-xs text-muted-foreground mt-1">
                {m.budgets_month({ month: budgetsData.month })}
              </p>
            )}
          </div>
          {canAdd && (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={handleAdd} disabled={atCap}>
                <svg
                  className="size-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                {m.budgets_add()}
              </Button>
              {planLimit !== null && (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="budgets-usage"
                >
                  {m.budgets_usage({ used: budgets.length, limit: planLimit })}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="page-wrap py-8 space-y-4">
        {canAdd && atCap && planLimit !== null && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md bg-amber-500/10 text-sm"
            data-testid="budgets-upsell"
          >
            <span>{m.budgets_limit_reached({ limit: planLimit })}</span>
            <Link
              to="/billing"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {m.billing_upgrade()}
            </Link>
          </div>
        )}
        {hasAccounts && !isLoading && (
          <p className="text-xs text-muted-foreground">
            {m.budgets_currency_note()}
          </p>
        )}
        {renderContent()}
      </main>

      {isFormOpen && (
        <BudgetForm
          key={editingBudget?.id ?? "new"}
          editingBudget={editingBudget}
          categoryOptions={availableCategoryOptions}
          parentCategoryOptions={parentCategoryOptions}
          currencyOptions={currencyOptions}
          pending={createMutation.isPending || updateMutation.isPending}
          error={formError}
          onClose={closeForm}
          onSubmit={handleFormSubmit}
        />
      )}

      <RemoveBudgetConfirm
        budget={removingBudget}
        pending={deleteMutation.isPending}
        error={removeError}
        onConfirm={handleRemoveConfirm}
        onCancel={() => {
          setRemovingBudget(null);
          setRemoveError(null);
        }}
      />
    </div>
  );
}
