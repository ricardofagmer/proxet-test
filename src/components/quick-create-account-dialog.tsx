import { useId, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { m } from "#/paraglide/messages";
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
import { createAccount } from "#/server/accounts.functions";

// Shared with every route that lists accounts, so the new one shows up in
// the parent form's select once this dialog closes.
const ACCOUNTS_QUERY_KEY = ["accounts"] as const;
const DEFAULT_CURRENCY = "PLN";

interface CreateAccountInput {
  name: string;
  bank: string;
  currency: string;
}

/**
 * Nested dialog that creates an account without leaving the form that opened
 * it. Mount it only while open so its fields start empty on every open.
 * Render it outside the parent's <form>: React bubbles submit events through
 * portals along the component tree.
 */
export function QuickCreateAccountDialog({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
}): ReactElement {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const createAccountFn = useServerFn(createAccount);
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: CreateAccountInput) => createAccountFn({ data }),
    // Awaited by mutateAsync, so the refreshed list is in the cache before the
    // caller selects the new id.
    onSuccess: (result) =>
      "error" in result
        ? undefined
        : queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(m.account_name_required());
      return;
    }
    setError(null);
    try {
      const result = await createMutation.mutateAsync({
        name: trimmedName,
        bank: bank.trim(),
        currency,
      });
      if ("error" in result) {
        // The free-plan cap is the expected refusal; show it localized.
        setError(
          result.code === "account_limit_reached"
            ? m.account_limit_reached({ limit: result.limit })
            : (result.error ?? m.unknown_error()),
        );
        return;
      }
      onCreated(result.id);
      onClose();
    } catch {
      // Transport or validation failure: keep the dialog open with the input.
      setError(m.unknown_error());
    }
  };

  const pending = createMutation.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{m.quick_create_account_title()}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor={`${fieldId}-name`} className="mb-1">
              {m.account_name_label()}
            </Label>
            <Input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              autoFocus
              autoComplete="off"
              aria-invalid={error !== null}
            />
          </div>

          <div>
            <Label htmlFor={`${fieldId}-bank`} className="mb-1">
              {m.bank_label()}
            </Label>
            <Input
              id={`${fieldId}-bank`}
              type="text"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              maxLength={128}
              autoComplete="off"
            />
          </div>

          <div>
            <Label htmlFor={`${fieldId}-currency`} className="mb-1">
              {m.currency_label()}
            </Label>
            <CurrencySelect
              id={`${fieldId}-currency`}
              value={currency}
              onValueChange={setCurrency}
            />
          </div>

          {error && (
            <div className="text-destructive text-sm" role="alert">
              {error}
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
              {pending ? m.creating() : m.create_account_btn()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
