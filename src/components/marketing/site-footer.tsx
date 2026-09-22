import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { type BusinessConfig, displayableAuthority, isPlaceholder } from "@/config/business";
import { relationshipDisclosure } from "@/content/marketing";

const COLUMNS = [
  {
    heading: "Dispatch",
    links: [
      { href: "/dispatch-services", label: "Dispatch services" },
      { href: "/car-hauler-dispatch", label: "Car hauler dispatch" },
      { href: "/hotshot-dispatch", label: "Hotshot dispatch" },
      { href: "/box-truck-dispatch", label: "Box truck dispatch" },
      { href: "/dry-van-dispatch", label: "Dry van dispatch" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/lease-on-waitlist", label: "Lease-on waitlist" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/dispatch-disclosure", label: "Dispatch relationship disclosure" },
      { href: "/terms", label: "Terms of service" },
      { href: "/privacy", label: "Privacy policy" },
    ],
  },
];

export function SiteFooter({ profile }: { profile: BusinessConfig }) {
  const authority = displayableAuthority(profile);
  const year = new Date().getFullYear();
  return (
    <footer className="on-dark mt-auto bg-navy-900 text-steel-300">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <BrandMark name={profile.brandName} onDark />
          <address className="mt-4 space-y-1 text-sm not-italic">
            <p>{profile.address}</p>
            <p>
              {isPlaceholder(profile.phone) ? profile.phone : <a href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`} className="hover:text-paper">{profile.phone}</a>}
            </p>
            <p>{isPlaceholder(profile.email) ? profile.email : <a href={`mailto:${profile.email}`} className="hover:text-paper">{profile.email}</a>}</p>
          </address>
          {authority ? (
            <p className="mt-3 text-sm">
              USDOT {authority.usdot} · MC {authority.mc}
            </p>
          ) : null}
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h2 className="text-sm font-semibold text-paper">{col.heading}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-paper hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-navy-700">
        <div className="container-page space-y-3 py-6 text-xs leading-5">
          <p>{relationshipDisclosure(profile.brandName)}</p>
          <p>
            © {year} {profile.legalEntity}. Serving carriers across the United States.
          </p>
        </div>
      </div>
    </footer>
  );
}
