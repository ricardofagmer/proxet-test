import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { m } from "#/paraglide/messages";
import { EditButton, DeleteButton } from "#/components/ui/action-buttons";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { CurrencySelect } from "#/components/currency-select";
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
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from "#/server/accounts.functions";


const ACCOUNTS_QUERY_KEY = ["accounts"] as const;

// --- Account Form Modal ---

interface AccountFormData {
  name: string;
  bank: string;
  currency: string;
}

function AccountForm({
  isOpen,
  editingAccount,
  onClose,
  onSubmit,
  error,
}: {
  isOpen: boolean;
  editingAccount: AccountRow | null;
  onClose: () => void;
  onSubmit: (data: AccountFormData) => void;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [currency, setCurrency] = useState("PLN");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (editingAccount) {
        setName(editingAccount.name);
        setBank(editingAccount.bank ?? "");
        setCurrency(editingAccount.currency ?? "PLN");
      } else {
        setName("");
        setBank("");
        setCurrency("PLN");
      }
      setValidationError(null);
      setSubmitting(false);
    }
  }, [isOpen, editingAccount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError(m.account_name_required());
      return;
    }
    setSubmitting(true);
    setValidationError(null);
    onSubmit({ name: name.trim(), bank: bank.trim() || "", currency });
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingAccount ? m.edit() : m.add_account()}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <Label htmlFor="acc-name" className="mb-1">
              {m.account_name_label()}
            </Label>
            <Input
              id="acc-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              autoFocus
              placeholder="e.g. Main Checking"
            />
          </div>

          {/* Bank */}
          <div>
            <Label htmlFor="acc-bank" className="mb-1">
              {m.bank_label()}
            </Label>
            <Input
              id="acc-bank"
              type="text"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              maxLength={128}
              placeholder="e.g. Bank of America"
            />
          </div>

          {/* Currency */}
          <div>
            <Label htmlFor="acc-currency" className="mb-1">
              {m.currency_label()}
            </Label>
            <CurrencySelect
              id="acc-currency"
              value={currency}
              onValueChange={setCurrency}
            />
          </div>

          {/* Error */}
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

          {/* Actions */}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={submitting}
            >
              {m.cancel()}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? editingAccount
                  ? m.saving()
                  : m.creating()
                : editingAccount
                  ? m.save_changes()
                  : m.create_account_btn()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Delete Confirmation ---

function DeleteConfirm({
  isOpen,
  transactionCount,
  error,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  transactionCount: number;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{m.delete_account_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.delete_account_confirm()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {transactionCount > 0 && (
          <p className="text-sm text-amber-600">
            {m.account_has_txns({ n: transactionCount })}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {m.delete_account_unsaved()}
        </p>
        {error && (
          <div
            className="text-destructive text-sm p-3 rounded-md bg-destructive/10"
            role="alert"
          >
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{m.cancel()}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {m.delete()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Account Row ---

type AccountRow = Awaited<ReturnType<typeof getAccounts>>[number];

function AccountRow({
  account,
  onEdit,
  onDelete,
}: {
  account: AccountRow;
  onEdit: (acc: AccountRow) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors group/row">
      {/* Name */}
      <span className="flex-1 text-sm font-medium truncate">
        {account.name}
      </span>

      {/* Bank */}
      <span className="w-36 text-sm text-muted-foreground truncate">
        {account.bank ?? "—"}
      </span>

      {/* Currency */}
      <span className="w-16 text-sm font-mono text-muted-foreground text-right">
        {account.currency}
      </span>

      {/* Transactions */}
      <span className="w-16 text-sm text-muted-foreground text-right">
        {account.transactionCount ?? 0}
      </span>

      {/* Actions */}
      <span className="w-32 text-right flex justify-end gap-1">
        <EditButton onClick={() => onEdit(account)} data-testid="edit-account" />
        <DeleteButton onClick={() => onDelete(account.id)} data-testid="delete-account" />
      </span>
    </div>
  );
}

// --- Main Page ---

export const Route = createFileRoute("/_authed/accounts")({
  component: AccountsPage,
});

function AccountsPage() {
  const queryClient = useQueryClient();
  const getAccountsFn = useServerFn(getAccounts);
  const createAccountFn = useServerFn(createAccount);
  const updateAccountFn = useServerFn(updateAccount);
  const deleteAccountFn = useServerFn(deleteAccount);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => getAccountsFn(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; bank: string; currency: string }) =>
      createAccountFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      id: string;
      name: string;
      bank: string;
      currency: string;
    }) => updateAccountFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data: { id: string }) => deleteAccountFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    },
  });

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Handle add
  const handleAdd = () => {
    setEditingAccount(null);
    setIsFormOpen(true);
    setFormError(null);
  };

  // Handle edit
  const handleEdit = (acc: AccountRow) => {
    setEditingAccount(acc);
    setIsFormOpen(true);
    setFormError(null);
  };

  // Handle form submit (create or update)
  const handleFormSubmit = async (data: AccountFormData) => {
    setFormError(null);
    if (editingAccount) {
      await updateMutation.mutateAsync({
        id: editingAccount.id,
        name: data.name,
        bank: data.bank,
        currency: data.currency,
      });
    } else {
      const result = await createMutation.mutateAsync({
        name: data.name,
        bank: data.bank,
        currency: data.currency,
      });
      if (result && "error" in result) {
        setFormError(
          result.code === "account_limit_reached"
            ? m.account_limit_reached({ limit: result.limit })
            : (result.error ?? null),
        );
        return;
      }
    }
    setIsFormOpen(false);
    setEditingAccount(null);
  };

  // Handle delete confirm
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    setDeleteError(null);

    const result = await deleteMutation.mutateAsync({ id: deleteConfirmId });
    if (result && "error" in result) {
      setDeleteError(result.error ?? null);
      return;
    }

    setDeleteConfirmId(null);
  };

  // Handle delete click
  const handleDeleteClick = (id: string) => {
    setDeleteConfirmId(id);
    setDeleteError(null);
  };

  // Get the account being deleted for the confirmation dialog
  const deletingAccount = accounts.find((a) => a.id === deleteConfirmId);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-line/50 bg-header-bg/80 backdrop-blur-sm">
        <div className="page-wrap py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold display-title">
              Accounts
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage your bank accounts and financial institutions.
            </p>
          </div>
          <Button onClick={handleAdd}>
            <svg
              className="size-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
            {m.add_account()}
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="page-wrap py-8">
        {formError && (
          <div
            className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
            role="alert"
          >
            {formError}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">
                {m.loading_accounts()}
              </span>
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg
              className="size-12 text-muted-foreground/40 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
              />
            </svg>
            <h3 className="text-base font-medium mb-1">{m.no_accounts_yet()}</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">
              {m.add_first_account()}
            </p>
          </div>
        ) : (
          <div className="island-shell rounded-xl overflow-hidden">
            {/* Table header */}
            <div className="flex items-center gap-3 px-3 py-2 bg-muted/40 border-b border-line/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span className="flex-1">{m.account_column()}</span>
              <span className="w-36">{m.bank_column()}</span>
              <span className="w-16 text-right">{m.currency_column()}</span>
              <span className="w-16 text-right">{m.txns_column()}</span>
              <span className="w-20 text-right">{m.actions_column()}</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-line/30">
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onEdit={handleEdit}
                  onDelete={handleDeleteClick}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Add/Edit Form */}
      <AccountForm
        isOpen={isFormOpen}
        editingAccount={editingAccount}
        onClose={() => {
          setIsFormOpen(false);
          setEditingAccount(null);
          setFormError(null);
        }}
        onSubmit={handleFormSubmit}
        error={formError}
      />

      {/* Delete Confirmation */}
      <DeleteConfirm
        isOpen={!!deleteConfirmId}
        transactionCount={deletingAccount?.transactionCount ?? 0}
        error={deleteError}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteConfirmId(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
