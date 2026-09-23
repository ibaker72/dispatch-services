"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="space-y-4">
      <Alert tone="danger" title="This page could not be loaded">
        The problem has been reported. {error.digest ? `Reference: ${error.digest}` : null}
      </Alert>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
