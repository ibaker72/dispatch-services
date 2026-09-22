import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-navy-900 text-white hover:bg-navy-800",
        accent: "bg-accent text-navy-900 hover:bg-accent-strong",
        secondary: "border border-steel-300 bg-white text-navy-900 hover:bg-paper-2",
        outlineDark: "border border-steel-400 text-paper hover:bg-navy-800",
        ghost: "text-navy-900 hover:bg-paper-2",
        danger: "bg-danger text-white hover:bg-[#912018]",
        link: "h-auto px-0 text-navy-700 underline underline-offset-2 hover:text-navy-900",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), variant === "link" && "h-auto px-0", className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}
