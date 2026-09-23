# Compliance invariants

Each rule is enforced in the database (so no UI bug or direct API call can
bypass it) and covered by automated tests. File references are relative to
the repository root.

| # | Invariant | Enforcement | Tests |
| --- | --- | --- | --- |
| 1 | The company works only for carriers under a signed dispatch service agreement, with the carrier's own authority. | Loads can be created or proposed only when `app.carrier_is_contracted` holds (active carrier, accepted required agreements, fee terms). Activation is refused until every onboarding step is complete (`app.carrier_onboarding_complete`), including authority verification and agreement acceptance. | `tests/db/load-workflow.test.ts` › "loads can only be created for an active, contracted carrier"; `tests/db/onboarding.test.ts` › "activation is refused until every onboarding step is complete"; `tests/db/admin-workflows.test.ts` › "cannot create freight for a carrier that is not active and contracted" |
| 2 | Only the carrier pays the dispatch company, and only for dispatch service. | `invoices.payer_type` and `payments.payer_type` are constrained to `carrier`; invoice totals come only from statement/line ledgers; Stripe Checkout metadata `purpose=dispatch_service_invoice`, other events ignored. | `tests/db/billing.test.ts` › "only the carrier can be the payer"; `tests/integration/payments.test.ts` › "Stripe driver verifies signatures and only handles dispatch-service checkouts" |
| 3 | No compensation from brokers, shippers or factoring companies. | There is no data model for broker/shipper/factor payments to the company; payments attach only to carrier invoices; freight rates are recorded as the carrier's revenue and paid broker → carrier. Public copy states it. | `tests/db/billing.test.ts` (payer constraints); `tests/unit/compliance-copy.test.ts` › disclosure checks |
| 4 | No freight is worked before a carrier is associated; there is no unassigned load pool. | `loads.carrier_id` is `NOT NULL`; loads start as `opportunity` for one carrier; carriers never see opportunities until proposed to them. | `tests/db/load-workflow.test.ts` › "every load has a carrier; there is no unassigned load pool", "carriers see proposed loads but not dispatcher opportunities"; `e2e/authorization.spec.ts` |
| 5 | A load is never reassigned from one carrier to another. | `app.guard_load_write` raises `load_reassignment_forbidden`; trucks, trailers, drivers, stops, vehicles, charges and documents use composite `(id, carrier_id)` foreign keys. | `tests/db/load-workflow.test.ts` › "no role can move a load to another carrier", "a truck or driver from another carrier cannot be assigned" |
| 6 | A load removed from a carrier returns to the broker. | Cancellation requires a reason and records disposition `returned_to_broker` (or `broker_cancelled`); cancelled loads are closed records. | `tests/db/load-workflow.test.ts` › "removing a load from a carrier returns it to the broker (cancelled), never to a pool" |
| 7 | The company does not solicit freight from shippers. | No shipper portal, quote form or load marketplace exists; the contact page redirects shippers to brokers/carriers; copy tests reject solicitation language. | `tests/unit/compliance-copy.test.ts` › "mentions of shipper solicitation appear only in negated sentences" |
| 8 | The company is not a broker, and is never described as a licensed dispatcher. | Disclosure page, footer and terms state the relationship; copy tests reject "licensed dispatcher", FMCSA dispatch-licence claims, guarantees, income claims, invented statistics and testimonials. | `tests/unit/compliance-copy.test.ts` (with detector self-tests) |
| 9 | Lease-on operations stay disabled until the company holds real authority, insurance filings, BOC-3, a compliance administrator and an attorney-approved lease. | `app.guard_feature_flag` refuses enabling `lease_on_operations` unless `app.lease_on_ready()`; prepared lease-on tables refuse writes while disabled. | `tests/db/lease-on.test.ts` (all cases) |
| 10 | Lease-on is behind a server-side flag and the checklist. | `LEASE_ON_OPERATIONS_ENABLED` (environment) **and** the database flag **and** the checklist must all hold (`evaluateLeaseOn`). | `tests/unit/mileage-workflow.test.ts` › "lease-on gate"; `tests/unit/compliance-copy.test.ts` › "keeps lease-on operations disabled by default" |

Related guarantees for carriers:

- **The carrier decides every load.** Booking requires a live carrier approval
  at the current rate; a rate change after approval sends the load back to the
  carrier. Off-portal approvals must be recorded by staff with evidence.
  (`tests/db/load-workflow.test.ts` › "booking guard", "carrier decisions"; `e2e/loads.spec.ts`)
- **Fees follow the signed terms.** Fee contracts are versioned and immutable;
  fee snapshots are fixed at completion and never change afterwards.
  (`tests/db/billing.test.ts` › "fee snapshots"; `tests/db/admin-workflows.test.ts` › fee parity)
