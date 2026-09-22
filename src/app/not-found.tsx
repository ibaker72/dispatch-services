import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="container-page flex min-h-[60vh] flex-col items-start justify-center py-16">
      <p className="text-sm font-semibold text-accent-ink">404</p>
      <h1 className="mt-2 text-3xl font-semibold">We could not find that page</h1>
      <p className="mt-2 max-w-md text-steel-600">The link may be out of date, or you may not have access to this record.</p>
      <Button asChild className="mt-6">
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
