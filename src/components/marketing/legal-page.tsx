import type * as React from "react";
import { Alert } from "@/components/ui/alert";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="container-page py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-steel-600">Last updated {updated}</p>
      <Alert tone="warning" title="Draft — requires review by a transportation attorney" className="mt-6 max-w-3xl">
        This page is a starting template provided with the platform. It has not been reviewed by counsel and is not legal advice. Replace or
        approve it before relying on it.
      </Alert>
      <div className="prose-legal mt-8">{children}</div>
    </div>
  );
}
