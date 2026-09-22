"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { BrandMark } from "./brand-mark";
import { TrackLink } from "@/components/track-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dispatch-services", label: "Services" },
  { href: "/car-hauler-dispatch", label: "Car haulers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const EQUIPMENT = [
  { href: "/car-hauler-dispatch", label: "Car hauler dispatch" },
  { href: "/hotshot-dispatch", label: "Hotshot dispatch" },
  { href: "/box-truck-dispatch", label: "Box truck dispatch" },
  { href: "/dry-van-dispatch", label: "Dry van dispatch" },
];

export function SiteHeader({ brandName }: { brandName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href;

  return (
    <header className="sticky top-0 z-40 border-b border-steel-200 bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="shrink-0" aria-label={`${brandName} home`}>
          <BrandMark name={brandName} />
        </Link>
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium text-steel-700 hover:bg-paper-2 hover:text-navy-900",
                    isActive(item.href) && "text-navy-900 underline decoration-accent decoration-2 underline-offset-8",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Log in
          </Link>
          <TrackLink href="/apply" cta="apply" location="header" className={buttonVariants({ variant: "accent", size: "sm" })}>
            Apply for Dispatch
          </TrackLink>
        </div>

        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
              <Menu className="size-6" aria-hidden="true" />
            </Button>
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-50 bg-navy-950/50 lg:hidden" />
            <D.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(22rem,100vw)] flex-col overflow-y-auto bg-paper p-5 shadow-xl lg:hidden">
              <div className="flex items-center justify-between">
                <D.Title asChild>
                  <span>
                    <BrandMark name={brandName} />
                  </span>
                </D.Title>
                <D.Description className="sr-only">Site navigation</D.Description>
                <D.Close asChild>
                  <Button variant="ghost" size="icon" aria-label="Close menu">
                    <X className="size-6" aria-hidden="true" />
                  </Button>
                </D.Close>
              </div>
              <nav aria-label="Mobile" className="mt-6 flex-1">
                <ul className="space-y-1">
                  {[{ href: "/", label: "Home" }, ...NAV.filter((n) => n.href !== "/car-hauler-dispatch")].map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={isActive(item.href) ? "page" : undefined}
                        className="block rounded-md px-3 py-3 text-base font-medium text-navy-900 hover:bg-paper-2"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 px-3 text-xs font-semibold tracking-wide text-steel-600 uppercase">Equipment</p>
                <ul className="mt-1 space-y-1">
                  {EQUIPMENT.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2.5 text-[15px] text-steel-700 hover:bg-paper-2">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-6 grid gap-2">
                <TrackLink href="/apply" cta="apply" location="mobile_menu" onClick={() => setOpen(false)} className={buttonVariants({ variant: "accent", size: "lg" })}>
                  Apply for Dispatch
                </TrackLink>
                <Link href="/login" onClick={() => setOpen(false)} className={buttonVariants({ variant: "secondary", size: "lg" })}>
                  Log in
                </Link>
              </div>
            </D.Content>
          </D.Portal>
        </D.Root>
      </div>
    </header>
  );
}
