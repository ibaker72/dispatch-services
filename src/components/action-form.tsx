"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/utils";

type FormActionFn = (formData: FormData) => Promise<ActionResult<unknown>>;

const FieldErrorsContext = React.createContext<Record<string, string[]>>({});
/** Lets an ActionForm close the dialog that contains it after a successful submit. */
const DialogCloseContext = React.createContext<(() => void) | null>(null);

/**
 * Generic form bound to a FormData server action. Shows pending state,
 * form-level and field-level errors (via <FormField>), refreshes server data
 * on success and never clears user input on validation errors.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  successMessage,
  resetOnSuccess = false,
  onSuccess,
  className,
  submitVariant = "primary",
  submitSize = "md",
  inline = false,
  hideSubmit = false,
}: {
  action: FormActionFn;
  children?: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (data: unknown) => void;
  className?: string;
  submitVariant?: ButtonProps["variant"];
  submitSize?: ButtonProps["size"];
  inline?: boolean;
  hideSubmit?: boolean;
}) {
  const router = useRouter();
  const closeDialog = React.useContext(DialogCloseContext);
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<ActionResult<unknown> | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const res = await action(data);
      setResult(res);
      if (res.ok) {
        if (resetOnSuccess) form.reset();
        onSuccess?.(res.data);
        closeDialog?.();
        router.refresh();
      }
    });
  }

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  return (
    <FieldErrorsContext.Provider value={fieldErrors}>
      <form onSubmit={onSubmit} noValidate className={cn(inline ? "inline-flex flex-wrap items-center gap-2" : "space-y-4", className)}>
        {children}
        {result && !result.ok && !inline ? (
          <Alert tone="danger" live>
            {result.error}
          </Alert>
        ) : null}
        {result?.ok && (successMessage || result.message) && !inline ? (
          <Alert tone="success" live>
            {result.message ?? successMessage}
          </Alert>
        ) : null}
        {hideSubmit ? null : (
          <Button type="submit" variant={submitVariant} size={submitSize} disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        )}
        {inline && result && !result.ok ? (
          <p role="alert" className="w-full text-sm font-medium text-danger">
            {result.error}
          </p>
        ) : null}
      </form>
    </FieldErrorsContext.Provider>
  );
}

/** Field wired to the surrounding ActionForm's server-side field errors. */
export function FormField(props: Omit<React.ComponentProps<typeof Field>, "error"> & { name?: string }) {
  const errors = React.useContext(FieldErrorsContext);
  const { name, ...rest } = props;
  return <Field {...rest} error={errors[name ?? props.id]} />;
}

/** Checkbox with its label and any server-side error for `name`. */
export function FormCheckbox({ id, name, defaultChecked, children }: { id: string; name: string; defaultChecked?: boolean; children: React.ReactNode }) {
  const errors = React.useContext(FieldErrorsContext);
  const message = errors[name]?.[0];
  return (
    <div>
      <label htmlFor={id} className="flex items-start gap-2 text-sm">
        <Checkbox id={id} name={name} defaultChecked={defaultChecked} aria-invalid={message ? true : undefined} aria-describedby={message ? `${id}-error` : undefined} />
        <span>{children}</span>
      </label>
      {message ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** A button that asks for confirmation (and optionally a reason) before running an action. */
export function ConfirmAction({
  action,
  title,
  description,
  triggerLabel,
  confirmLabel,
  triggerVariant = "secondary",
  confirmVariant = "danger",
  children,
  triggerSize = "sm",
}: {
  action: FormActionFn;
  title: string;
  description?: string;
  triggerLabel: string;
  confirmLabel?: string;
  triggerVariant?: ButtonProps["variant"];
  confirmVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <DialogCloseContext.Provider value={() => setOpen(false)}>
          <ActionForm action={action} submitLabel={confirmLabel ?? triggerLabel} submitVariant={confirmVariant}>
            {children}
          </ActionForm>
        </DialogCloseContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

/** Opens any form in a dialog. */
export function FormDialog({
  title,
  description,
  triggerLabel,
  triggerVariant = "primary",
  triggerSize = "md",
  children,
}: {
  title: string;
  description?: string;
  triggerLabel: React.ReactNode;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <DialogCloseContext.Provider value={() => setOpen(false)}>{children}</DialogCloseContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
