"use client";

import {
  BarChart3,
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  Inbox,
  LifeBuoy,
  ListChecks,
  type LucideIcon,
  Menu,
  MessageSquare,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  UserCog,
  Users,
  Wallet,
  X,
  Route,
  CalendarClock,
  Handshake,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { cn } from "@/lib/utils";

export const ICONS = {
  gauge: Gauge,
  inbox: Inbox,
  building: Building2,
  users: Users,
  truck: Truck,
  route: Route,
  file: FileText,
  tasks: ListChecks,
  chart: BarChart3,
  receipt: Receipt,
  wallet: Wallet,
  message: MessageSquare,
  support: LifeBuoy,
  audit: ScrollText,
  waitlist: ClipboardList,
  settings: Settings,
  shield: ShieldCheck,
  team: UserCog,
  calendar: CalendarClock,
  handshake: Handshake,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badge?: number;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                active ? "bg-navy-800 text-white" : "text-steel-300 hover:bg-navy-800/60 hover:text-white",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="rounded-full bg-accent px-2 text-xs font-bold text-navy-900">
                  {item.badge}
                  <span className="sr-only"> pending</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav aria-label={label}>
      <NavList items={items} />
    </nav>
  );
}

export function MobileNav({ items, label, title }: { items: NavItem[]; label: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger className="inline-flex size-10 items-center justify-center rounded-md text-navy-900 hover:bg-paper-2 lg:hidden" aria-label="Open navigation">
        <Menu className="size-6" aria-hidden="true" />
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-navy-950/50 lg:hidden" />
        <D.Content className="on-dark fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto bg-navy-900 p-4 lg:hidden">
          <div className="mb-4 flex items-center justify-between">
            <D.Title className="font-semibold text-paper">{title}</D.Title>
            <D.Description className="sr-only">Navigation</D.Description>
            <D.Close className="rounded-md p-2 text-steel-300 hover:bg-navy-800" aria-label="Close navigation">
              <X className="size-5" aria-hidden="true" />
            </D.Close>
          </div>
          <nav aria-label={label}>
            <NavList items={items} onNavigate={() => setOpen(false)} />
          </nav>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
