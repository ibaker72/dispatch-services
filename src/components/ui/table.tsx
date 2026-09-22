import type * as React from "react";
import { cn } from "@/lib/utils";

/** Responsive table: scrolls horizontally inside its card on small screens. */
export function Table({ className, caption, ...props }: React.ComponentProps<"table"> & { caption?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full min-w-[640px] border-collapse text-left text-sm", className)} {...props}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {props.children}
      </table>
    </div>
  );
}

export function THead(props: React.ComponentProps<"thead">) {
  return <thead className="border-b border-steel-200 bg-paper text-xs uppercase tracking-wide text-steel-600" {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th scope="col" className={cn("px-4 py-2.5 font-semibold", className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-steel-100 last:border-0 hover:bg-paper/60", className)} {...props} />;
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-top text-steel-900", className)} {...props} />;
}
