"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", background: "#faf8f5", color: "#1b2733" }}>
        <main>
          <h1 style={{ color: "#0f1f33" }}>Something went wrong</h1>
          <p>The error has been reported. Please try again.</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: "10px 16px", background: "#0f1f33", color: "#fff", border: 0, borderRadius: 6 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
