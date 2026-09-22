-- =============================================================================
-- Reference data required in every environment (not demo data).
-- Demo carriers, users and loads are created by scripts/seed.ts.
-- =============================================================================

insert into public.equipment_types (key, label, description, is_primary, sort_order) values
  ('car_hauler', 'Car hauler', 'Open or enclosed auto transport, including wedge and gooseneck setups.', true, 10),
  ('hotshot', 'Hotshot', 'Pickup-and-gooseneck or flatbed hotshot units.', false, 20),
  ('box_truck', 'Box truck', 'Straight trucks, typically 16–26 ft.', false, 30),
  ('dry_van', 'Dry van', '53 ft dry van tractor-trailers.', false, 40)
on conflict (key) do nothing;

insert into public.document_requirements
  (doc_type, applies_to, label, description, required_for_application, required_for_activation, tracks_expiration, sort_order)
values
  ('w9', 'carrier', 'W-9', 'IRS Form W-9 for your business.', true, true, false, 10),
  ('certificate_of_insurance', 'carrier', 'Certificate of insurance', 'Current COI showing auto liability and cargo coverage.', true, true, true, 20),
  ('operating_authority', 'carrier', 'Operating authority', 'Your MC authority letter or FMCSA authority document.', true, true, false, 30),
  ('notice_of_assignment', 'carrier', 'Notice of assignment', 'Only if you factor your invoices.', false, false, false, 40),
  ('other', 'carrier', 'Other onboarding document', 'Anything else you would like us to have on file.', false, false, false, 90),
  ('driver_license', 'driver', 'Driver license', 'Driver license copy for each driver.', false, false, true, 110),
  ('medical_card', 'driver', 'Medical card', 'DOT medical examiner''s certificate, where required.', false, false, true, 120),
  ('truck_registration', 'truck', 'Truck registration', 'Current registration for each power unit.', false, false, true, 130),
  ('rate_confirmation', 'load', 'Rate confirmation', 'Signed rate confirmation from the broker.', false, false, false, 210),
  ('bill_of_lading', 'load', 'Bill of lading', 'BOL signed at pickup.', false, false, false, 220),
  ('proof_of_delivery', 'load', 'Proof of delivery', 'Signed POD or delivery receipt.', false, false, false, 230),
  ('vehicle_inspection_report', 'load', 'Vehicle inspection report', 'Condition report for vehicles transported.', false, false, false, 240)
on conflict (doc_type, applies_to) do nothing;

insert into public.fee_plans (key, name, description, model, percentage, flat_weekly_amount,
                              include_detention, include_layover, include_tonu, include_other, is_default)
values
  ('standard_percentage', 'Percentage of gross',
   'A percentage of eligible gross revenue on completed loads. No charge for weeks without completed loads.',
   'percentage', 0.0700, null, true, true, true, false, true),
  ('flat_weekly', 'Flat weekly per truck',
   'A fixed weekly fee for each active truck, regardless of how many loads are completed.',
   'flat_weekly', null, 300.00, true, true, true, false, false)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description, is_sensitive) values
  ('lease_on_operations', false,
   'Lease-on (owner-operator) operations under company authority. Cannot be enabled until the compliance checklist is complete and LEASE_ON_OPERATIONS_ENABLED=true on the server.',
   true),
  ('lease_on_waitlist', true, 'Show the public lease-on waitlist form.', false),
  ('online_invoice_payments', true, 'Allow carriers to pay dispatch invoices online through Stripe Checkout when Stripe is configured.', false)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description, is_public, is_sensitive) values
  ('business_profile', '{}'::jsonb,
   'Runtime overrides for the business profile in src/config/business.ts (brand, contact details).', true, false),
  ('operations', jsonb_build_object(
     'timezone', 'America/Chicago',
     'cancellation_notice_days', 14,
     'statement_due_days', 7,
     'auto_issue_statements', false),
   'Operating timezone, service cancellation notice period and billing defaults.', false, false),
  ('notification_schedules', jsonb_build_object(
     'document_reminder_days', jsonb_build_array(30, 14, 7, 0),
     'invoice_reminder_days_before_due', 2,
     'invoice_overdue_reminder_interval_days', 7,
     'stale_application_days', 3,
     'information_request_reminder_days', 5,
     'onboarding_reminder_days', 3,
     'daily_summary_enabled', true),
   'Reminder timing used by background jobs.', false, false),
  ('email_templates', '{}'::jsonb,
   'Optional subject/intro overrides per transactional email template.', false, false),
  ('application_questions', '[]'::jsonb,
   'Additional questions shown at the end of the carrier application.', false, false),
  ('security', jsonb_build_object('require_admin_mfa', false),
   'Security-sensitive settings. Only super administrators can change these.', false, true)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Agreements. Default texts are DRAFTS that REQUIRE TRANSPORTATION-ATTORNEY
-- REVIEW. They are inserted unpublished; an administrator publishes a version
-- from the dashboard (the demo seed publishes them for local use only).
-- -----------------------------------------------------------------------------
insert into public.agreements (key, title, description, audience, required_for_activation, requires_attorney_approval_to_publish, sort_order)
values
  ('dispatch_service_agreement', 'Dispatch Service Agreement',
   'Terms under which the dispatch company provides dispatch services to the carrier.', 'carrier', true, false, 10),
  ('broker_authorization', 'Broker and Load-Board Authorization Acknowledgment',
   'Carrier acknowledgment authorizing the dispatcher to communicate with brokers and load boards on the carrier''s behalf.', 'carrier', true, false, 20),
  ('limited_power_of_attorney', 'Limited Power of Attorney',
   'Only used when counsel provides an approved limited power of attorney. Not required until an attorney-approved version is published.', 'carrier', false, true, 30),
  ('owner_operator_lease', 'Owner-Operator Lease Agreement',
   'Reserved for future lease-on operations. Must be attorney-approved before use.', 'lease_on', false, true, 90)
on conflict (key) do nothing;

insert into public.agreement_versions (agreement_id, version, title, body_markdown)
select a.id, '0.1-draft', 'Dispatch Service Agreement (draft)', $agreement$
> **DRAFT — REQUIRES REVIEW BY A QUALIFIED TRANSPORTATION ATTORNEY BEFORE USE.**
> This template is provided as a starting point only and is not legal advice.

# Dispatch Service Agreement

This Dispatch Service Agreement ("Agreement") is between **{{legal_entity}}** ("Dispatcher") and the motor carrier identified in the carrier portal ("Carrier").

## 1. Nature of the relationship
1.1 Carrier is a motor carrier that holds its own operating authority and insurance. Dispatcher provides administrative dispatch services **on Carrier's behalf and at Carrier's direction**.
1.2 Dispatcher is not a motor carrier, freight broker or freight forwarder. Dispatcher does not arrange transportation for shippers, does not accept freight in its own name and does not hold itself out as providing transportation.
1.3 Carrier is Dispatcher's only client for each load. Dispatcher does not accept compensation from brokers, shippers, factoring companies or any party other than Carrier.

## 2. Services
Dispatcher may, as Carrier's agent and within Carrier's instructions: search load boards and broker networks; negotiate rates for Carrier's consideration; communicate with brokers regarding Carrier's loads; prepare and submit carrier setup packets; track loads; organize paperwork such as rate confirmations, bills of lading and proofs of delivery; and provide reporting.

## 3. Carrier control
3.1 Carrier retains sole authority to accept or reject any load. Dispatcher will not book a load without Carrier's approval, recorded in the portal or documented by Dispatcher when given by phone, email or text.
3.2 Carrier is solely responsible for safety, regulatory compliance, drivers, equipment, insurance, hours of service and the performance of transportation.

## 4. Fees
4.1 Carrier pays Dispatcher the fee stated in Carrier's fee terms in the portal: either a percentage of eligible gross revenue on completed loads, or a flat weekly fee per active truck.
4.2 Freight charges are paid by brokers (or their payment processors) directly to Carrier or Carrier's factoring company. Dispatcher does not collect, hold or disburse freight payments.
4.3 Dispatcher issues weekly statements and invoices. Payment is due by the date on the invoice.

## 5. No guarantee
Dispatcher does not guarantee any volume of loads, rates, revenue or income.

## 6. Term and cancellation
Either party may end this Agreement with written notice of **{{cancellation_notice_days}} days** through the portal or in writing. Fees for loads completed before the effective date remain payable.

## 7. Confidentiality and data
Dispatcher will protect Carrier's business information and use it only to provide the services.

## 8. Electronic acceptance
Carrier's authorized owner accepts this Agreement electronically. Dispatcher records the version, time, user, IP address and a cryptographic hash of this text.
$agreement$
from public.agreements a where a.key = 'dispatch_service_agreement'
on conflict (agreement_id, version) do nothing;

insert into public.agreement_versions (agreement_id, version, title, body_markdown)
select a.id, '0.1-draft', 'Broker and Load-Board Authorization Acknowledgment (draft)', $agreement$
> **DRAFT — REQUIRES REVIEW BY A QUALIFIED TRANSPORTATION ATTORNEY BEFORE USE.**

# Broker and Load-Board Authorization Acknowledgment

Carrier authorizes **{{legal_entity}}** to act as Carrier's dispatch agent when communicating with freight brokers and load boards, including:

- presenting Carrier's MC/USDOT information, insurance certificate and W-9 in broker setup packets;
- requesting and negotiating rates for Carrier's consideration; and
- receiving rate confirmations addressed to Carrier for Carrier's review.

Carrier acknowledges that:

1. The dispatcher is not a broker and is not a party to any broker–carrier agreement.
2. Rate confirmations and broker–carrier agreements are between Carrier and the broker.
3. Carrier may revoke this authorization at any time through the portal or in writing.
$agreement$
from public.agreements a where a.key = 'broker_authorization'
on conflict (agreement_id, version) do nothing;
