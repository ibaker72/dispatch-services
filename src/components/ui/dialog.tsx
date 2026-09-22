"use client";

import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-navy-950/60" />
      <D.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl",
          className,
        )}
      >
        <D.Title className="pr-8 text-lg font-semibold text-navy-900">{title}</D.Title>
        {description ? <D.Description className="mt-1 text-sm text-steel-600">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        <div className="mt-4">{children}</div>
        <D.Close className="absolute top-4 right-4 rounded-md p-1 text-steel-600 hover:bg-paper-2" aria-label="Close">
          <X className="size-5" aria-hidden="true" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
