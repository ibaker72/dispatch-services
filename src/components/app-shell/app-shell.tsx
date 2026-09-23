import { LogOut } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { MobileNav, type NavItem, SidebarNav } from "./nav-links";
import { signOut } from "@/app/(auth)/actions";
import { BrandMark } from "@/components/marketing/brand-mark";
import { initials } from "@/lib/utils";

export function AppShell({
  area,
  brandName,
  homeHref,
  nav,
  user,
  banner,
  children,
}: {
  area: string;
  brandName: string;
  homeHref: string;
  nav: NavItem[];
  user: { name: string; email: string; roleLabel: string };
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-paper">
      <aside className="on-dark hidden w-64 shrink-0 flex-col bg-navy-900 lg:flex">
        <div className="flex h-16 items-center border-b border-navy-800 px-5">
          <Link href={homeHref} aria-label={`${area} home`}>
            <BrandMark name={brandName} onDark />
          </Link>
        </div>
        <p className="px-5 pt-4 pb-2 text-xs font-semibold tracking-wide text-steel-400 uppercase">{area}</p>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <SidebarNav items={nav} label={area} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-steel-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNav items={nav} label={area} title={area} />
            <span className="font-semibold text-navy-900 lg:hidden">{area}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-navy-900">{user.name}</p>
              <p className="text-xs text-steel-600">{user.roleLabel}</p>
            </div>
            <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-full bg-navy-100 text-sm font-bold text-navy-800">
              {initials(user.name)}
            </span>
            <form action={signOut}>
              <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-steel-700 hover:bg-paper-2">
                <LogOut className="size-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </header>
        {banner}
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
