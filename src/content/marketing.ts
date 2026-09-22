/**
 * Public marketing copy. Kept in one module so it can be reviewed in one place
 * and scanned by tests for prohibited claims (income guarantees, "licensed
 * dispatcher", broker language, fake statistics). See
 * tests/unit/compliance-copy.test.ts.
 */
import type { EquipmentKey } from "@/config/business";

export interface Faq {
  q: string;
  a: string;
}

export const SERVICES = [
  {
    title: "Load search and rate negotiation",
    body: "We work the load boards and broker contacts every day, check the numbers against your minimum rate and lanes, and negotiate before anything reaches you.",
  },
  {
    title: "You approve every load",
    body: "Each proposed load shows the lane, rate, loaded and deadhead miles, rate per mile and our fee. Nothing is booked until you approve it.",
  },
  {
    title: "Planning to cut empty miles",
    body: "We plan the next load while you are on the current one, looking for reloads near your delivery so fewer miles are driven empty.",
  },
  {
    title: "Broker setup and paperwork",
    body: "We handle carrier packets, keep your W-9, insurance and authority documents current, and organize rate confirmations, BOLs and PODs by load.",
  },
  {
    title: "Check calls and communication",
    body: "We stay on the phone and email with brokers about appointments, detention and updates, so you can drive.",
  },
  {
    title: "Weekly numbers you can use",
    body: "Every week you see revenue, loaded and all-in rate per mile, deadhead percentage and exactly what you owe us — separately from what you earned.",
  },
] as const;

export const PROCESS_STEPS = [
  {
    title: "Apply",
    body: "Tell us about your authority, equipment, lanes and minimum rates. The application takes about 10 minutes and saves as you go.",
  },
  {
    title: "Get set up",
    body: "We verify your authority and insurance, you review and sign the dispatch agreement, and we set up your trucks, drivers and preferences in your portal.",
  },
  {
    title: "Start running",
    body: "Your dispatcher sends load proposals that fit your rules. You approve or reject each one; we book the ones you approve and handle the paperwork.",
  },
] as const;

export const BENEFITS = [
  {
    title: "More of your week on paying miles",
    body: "Planning the next load before the current one delivers is the most reliable way to reduce deadhead. We track deadhead percentage so you can see whether it is working.",
  },
  {
    title: "A second set of eyes on every rate",
    body: "We compare offers against your minimum rate per mile and recent lane rates, and we counter when a load is priced below the market.",
  },
  {
    title: "Organized paperwork, faster pay",
    body: "Complete, legible PODs and rate confirmations sent to your factor or broker promptly help avoid payment delays.",
  },
  {
    title: "You stay in control",
    body: "You set the lanes, days and minimums. You can reject any load. Freight payments go directly to you or your factoring company, never through us.",
  },
] as const;

export const HOME_FAQS: Faq[] = [
  {
    q: "Do I need my own authority to work with you?",
    a: "Yes. We dispatch for motor carriers that already have active operating authority (MC/USDOT) and insurance. We do not lease drivers onto our own authority.",
  },
  {
    q: "Who decides which loads I take?",
    a: "You do. Every load is sent to you as a proposal with the full numbers. It is only booked after you approve it in the portal or tell your dispatcher directly, and we record that approval.",
  },
  {
    q: "How do I get paid for loads?",
    a: "Brokers pay you, or your factoring company, directly. We never collect freight payments. We bill you separately for our dispatch fee each week.",
  },
  {
    q: "What does it cost?",
    a: "Either a percentage of the gross on completed loads (7% by default) or a flat weekly fee per truck ($300). The fee terms are written in your agreement and shown on every statement.",
  },
  {
    q: "Can you guarantee a certain amount per week?",
    a: "No. No honest dispatcher can guarantee rates or income. Freight markets change week to week. What we can promise is consistent effort, careful negotiation and clear reporting.",
  },
  {
    q: "Is there a long-term contract?",
    a: "No long-term lock-in. Either side can end the service with written notice as described in the dispatch agreement.",
  },
];

export const PRICING_FAQS: Faq[] = [
  {
    q: "What counts toward the percentage fee?",
    a: "The line-haul rate on completed loads plus the accessorials your agreement includes (by default detention, layover and TONU). Lumper reimbursements are never included.",
  },
  {
    q: "Do I pay for weeks with no loads?",
    a: "On the percentage plan, no: the fee is only charged on completed loads. On the flat plan, the weekly fee applies to each active truck.",
  },
  {
    q: "How and when do I pay?",
    a: "You receive a weekly statement and invoice. You can pay online by card or bank transfer when enabled, or by check or ACH using the instructions on the invoice.",
  },
  {
    q: "Do you take a cut from brokers or factoring companies?",
    a: "No. We are paid only by the carriers we dispatch for. We do not accept compensation from brokers, shippers or factoring companies.",
  },
];

export interface EquipmentPage {
  key: EquipmentKey;
  path: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  heading: string;
  intro: string;
  focus: Array<{ title: string; body: string }>;
  checklist: string[];
  faqs: Faq[];
}

export const EQUIPMENT_PAGES: EquipmentPage[] = [
  {
    key: "car_hauler",
    path: "/car-hauler-dispatch",
    title: "Car hauler dispatch",
    metaTitle: "Car Hauler Dispatch for Owner-Operators",
    metaDescription:
      "Dispatch for car haulers with their own authority: dealer, auction and private-party loads planned around your trailer, lanes and minimums. You approve every load.",
    heading: "Car hauler dispatch built around how auto transport actually runs",
    intro:
      "Auto transport is our primary focus. Multi-car loads have more moving parts than a single pickup and drop — gate passes, keys and titles, inoperable units, lot numbers and several delivery contacts. We plan and track all of it by vehicle.",
    focus: [
      {
        title: "Filling the trailer",
        body: "We look for combinations of auction, dealer and private-party vehicles that fill your deck along one direction of travel instead of chasing single-car moves.",
      },
      {
        title: "Vehicle-level detail",
        body: "Each vehicle on a load is tracked with VIN, year/make/model, operable status, lot number, pickup and delivery contacts, keys and title notes, and its share of the rate.",
      },
      {
        title: "Inspections and paperwork",
        body: "Condition reports, gate passes and signed delivery receipts are organized per vehicle so disputes and payment delays are easier to avoid.",
      },
    ],
    checklist: [
      "Open and enclosed trailers, including wedge and gooseneck setups",
      "Dealer, auction, rental-return and private-party freight",
      "Planning for inoperable units that need a winch",
      "Per-vehicle pay tracking on multi-car loads",
    ],
    faqs: [
      {
        q: "Do you work with single-car hotshot haulers?",
        a: "Yes. Tell us your trailer capacity in the application and we plan around it, whether that is one car or nine.",
      },
      {
        q: "Who handles the auction gate passes?",
        a: "We request and organize gate passes and release paperwork with the broker and share them with you and your driver before pickup.",
      },
    ],
  },
  {
    key: "hotshot",
    path: "/hotshot-dispatch",
    title: "Hotshot dispatch",
    metaTitle: "Hotshot Dispatch for Owner-Operators",
    metaDescription:
      "Hotshot dispatch for carriers with their own authority: time-sensitive and partial loads matched to your deck, weight limits and preferred lanes, with you approving every load.",
    heading: "Hotshot dispatch that respects your weight limits and your time",
    intro:
      "Hotshot freight moves fast and pays for speed, but only when the load fits your deck length and legal weight. We filter by your equipment and hours before a proposal ever reaches you.",
    focus: [
      {
        title: "Fit before rate",
        body: "Deck length, gooseneck or bumper-pull, and maximum payload are checked on every load so you are not offered freight you cannot legally haul.",
      },
      {
        title: "Partial and LTL-style freight",
        body: "We look for partials that can be combined in the same direction to improve your revenue per trip.",
      },
      {
        title: "Short-notice planning",
        body: "Expedited loads often book quickly. Keep your availability current in the portal and we will move quickly with it.",
      },
    ],
    checklist: [
      "Gooseneck and bumper-pull flatbeds",
      "Construction, oilfield, agricultural and equipment freight",
      "Partial loads combined along your route",
      "Weight and dimension checks before every proposal",
    ],
    faqs: [
      {
        q: "Do you dispatch non-CDL hotshot units?",
        a: "Yes, as long as your company has its own active authority and insurance. We plan around your combined weight limits.",
      },
      {
        q: "Can I stay regional?",
        a: "Yes. Set your preferred states and states to avoid in the application; your dispatcher works within them.",
      },
    ],
  },
  {
    key: "box_truck",
    path: "/box-truck-dispatch",
    title: "Box truck dispatch",
    metaTitle: "Box Truck Dispatch for Owner-Operators",
    metaDescription:
      "Box truck dispatch for carriers with their own authority: regional and expedited freight matched to your truck length, liftgate and schedule. You approve every load.",
    heading: "Box truck dispatch for regional and expedited freight",
    intro:
      "Straight trucks win on flexibility — residential deliveries, liftgate freight and quick regional turns. We plan loads around your length, liftgate, pallet jack and home time.",
    focus: [
      {
        title: "Equipment-aware matching",
        body: "Truck length, liftgate and pallet capacity are part of every search so proposals match what you can actually handle.",
      },
      {
        title: "Regional planning",
        body: "Many box truck carriers want to be home most nights. We plan loops and reloads that respect the days and hours you set.",
      },
      {
        title: "Appointment management",
        body: "We confirm pickup and delivery appointments with brokers and keep you updated when windows change.",
      },
    ],
    checklist: [
      "16–26 ft straight trucks",
      "Liftgate and residential deliveries",
      "Expedited and team-friendly freight",
      "Home-time-first regional planning",
    ],
    faqs: [
      {
        q: "Is there enough freight for box trucks?",
        a: "Box truck freight varies by region and season. We will tell you honestly what we are seeing in your area during onboarding rather than promising volume.",
      },
      {
        q: "Do you work with new authorities?",
        a: "Yes. Some brokers require a minimum authority age; we factor that into which brokers we approach for you.",
      },
    ],
  },
  {
    key: "dry_van",
    path: "/dry-van-dispatch",
    title: "Dry van dispatch",
    metaTitle: "Dry Van Dispatch for Owner-Operators",
    metaDescription:
      "Dry van dispatch for carriers with their own authority: rate negotiation, lane planning and paperwork for 53 ft vans, with you approving every load.",
    heading: "Dry van dispatch focused on lanes, reloads and rate per mile",
    intro:
      "Dry van is the most competitive board freight. Results come from knowing your lanes, negotiating every offer and lining up the next load before you unload.",
    focus: [
      {
        title: "Lane strategy",
        body: "We learn your preferred lanes and use them to plan loops that keep you moving toward freight-rich areas.",
      },
      {
        title: "Negotiation discipline",
        body: "We counter offers that fall below your minimum rate per mile and walk away from loads that do not make sense for your truck.",
      },
      {
        title: "Detention and TONU follow-up",
        body: "We document arrival and departure times and follow up on detention and truck-ordered-not-used charges with the broker.",
      },
    ],
    checklist: [
      "53 ft dry vans",
      "Solo and team operations",
      "Drop-and-hook and live-load freight",
      "Detention documentation on every stop",
    ],
    faqs: [
      {
        q: "Do you use a load board account in my name?",
        a: "We use our own tools and brokers' carrier setup processes with your authority documents. You authorize this in the broker authorization acknowledgment during onboarding.",
      },
      {
        q: "Can I keep my own direct shippers?",
        a: "Yes. Your existing customers stay yours. We only dispatch the loads you ask us to find.",
      },
    ],
  },
];

export function equipmentPage(key: EquipmentKey): EquipmentPage {
  return EQUIPMENT_PAGES.find((p) => p.key === key)!;
}

/** Statement shown across the site about what the company is and is not. */
export function relationshipDisclosure(brandName: string): string {
  return `${brandName} is a truck dispatch service that works on behalf of motor carriers. We are not a motor carrier or a freight broker, we do not arrange transportation for shippers, and we do not hold operating authority. We work only with carriers that have their own active authority and insurance. Brokers pay carriers (or their factoring companies) directly; we are paid only by the carriers we serve.`;
}
