/** Indexable public pages. Private areas (dashboard, portal, auth) are excluded and disallowed in robots.txt. */
export const PUBLIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly" }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/dispatch-services", priority: 0.9, changeFrequency: "monthly" },
  { path: "/car-hauler-dispatch", priority: 0.9, changeFrequency: "monthly" },
  { path: "/hotshot-dispatch", priority: 0.8, changeFrequency: "monthly" },
  { path: "/box-truck-dispatch", priority: 0.8, changeFrequency: "monthly" },
  { path: "/dry-van-dispatch", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" },
  { path: "/how-it-works", priority: 0.7, changeFrequency: "monthly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/apply", priority: 0.9, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.6, changeFrequency: "monthly" },
  { path: "/lease-on-waitlist", priority: 0.4, changeFrequency: "monthly" },
  { path: "/dispatch-disclosure", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
];
