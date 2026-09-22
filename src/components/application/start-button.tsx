"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startApplication } from "@/app/(marketing)/apply/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";

export function StartApplicationButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button
        size="lg"
        variant="accent"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startApplication();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            track("application_started", { source: "apply_page" });
            router.refresh();
          })
        }
      >
        {pending ? "Starting…" : "Start my application"}
      </Button>
      {error ? (
        <Alert tone="danger" live>
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
