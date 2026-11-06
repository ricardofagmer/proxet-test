import { useId, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { m } from "#/paraglide/messages";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select, SelectItem } from "#/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { createCategory } from "#/server/categories.functions";

// Shared with every route that lists categories, so the new one shows up in
// the parent form's select once this dialog closes.
const CATEGORIES_QUERY_KEY = ["categories"] as const;
const DEFAULT_COLOR = "#6b7280";

interface ParentCategoryOption {
  id: string;
  name: string;
}

interface CreateCategoryInput {
  name: string;
  parentId: string | null;
  color: string;
}

/**
 * Nested dialog that creates a category without leaving the form that opened
 * it. Mount it only while open so its fields start empty on every open.
 * Render it outside the parent's <form>: React bubbles submit events through
 * portals along the component tree.
 */
export function QuickCreateCategoryDialog({
  parentCategories,
  onCreated,
  onClose,
}: {
  parentCategories: ParentCategoryOption[];
  onCreated: (id: string) => void;
  onClose: () => void;
}): ReactElement {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const createCategoryFn = useServerFn(createCategory);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: CreateCategoryInput) => createCategoryFn({ data }),
    // Awaited by mutateAsync, so the refreshed list is in the cache before the
    // caller selects the new id.
    onSuccess: (result) =>
      "error" in result
        ? undefined
        : queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY }),
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(m.name_required());
      return;
    }
    setError(null);
    try {
      const result = await createMutation.mutateAsync({
        name: trimmedName,
        parentId: parentId || null,
        color,
      });
      if ("error" in result) {
        setError(result.error ?? m.unknown_error());
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
          <DialogTitle>{m.quick_create_category_title()}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor={`${fieldId}-name`} className="mb-1">
              {m.name_label()}
            </Label>
            <Input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              autoFocus
              autoComplete="off"
              placeholder={m.example_grocery()}
              aria-invalid={error !== null}
            />
          </div>

          <div>
            <Label htmlFor={`${fieldId}-parent`} className="mb-1">
              {m.parent_category_label()}
            </Label>
            <Select
              id={`${fieldId}-parent`}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <SelectItem value="">{m.none_option()}</SelectItem>
              {parentCategories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor={`${fieldId}-color`} className="mb-1">
              {m.color_label()}
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id={`${fieldId}-color`}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="size-9 w-9 cursor-pointer p-0.5"
              />
              <span className="text-sm text-muted-foreground font-mono">
                {color}
              </span>
            </div>
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
              {pending ? m.creating() : m.create_category_btn()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
