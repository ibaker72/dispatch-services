# Lease-on operations (deferred)

The platform does **not** lease drivers or owner-operators onto company
authority. The company has no operating authority today, and the public site
offers only a waitlist.

## What exists now

- Waitlist form (`/lease-on-waitlist`) and admin list with CSV export.
- Twelve prepared tables (admin-readable, write-locked while disabled) in
  `supabase/migrations/20260922000800_lease_on_prepared.sql`:
  `lease_on_applications`, `owner_operator_leases`, `carrier_insurance_policies`,
  `driver_qualification_documents`, `compliance_tasks`,
  `vehicle_maintenance_records`, `drug_testing_status`,
  `clearinghouse_query_status`, `eld_provider_connections`,
  `settlement_deductions`, `escrow_accounts`, `safety_events`.
- `authority_profiles` (company authority details, super admin only) and the
  readiness checklist (**Settings → Feature flags & lease-on**).

## Activation requires all of

1. `LEASE_ON_OPERATIONS_ENABLED=true` in the server environment, **and**
2. the `lease_on_operations` feature flag, which the database refuses to enable
   until the checklist is complete:
   - company USDOT and MC numbers and authority effective date,
   - insurance filing verified with FMCSA,
   - BOC-3 process agent filing verified,
   - a designated compliance administrator (active admin),
   - an attorney-approved `owner_operator_lease` agreement version.

## Deferred work before launch

- Driver qualification files, drug and alcohol program (Clearinghouse),
  hours-of-service and vehicle maintenance records.
- Lease agreement workflow compliant with 49 CFR Part 376 (compensation,
  chargebacks, escrow, insurance, receipts).
- Settlement statements for leased operators, escrow accounting and 1099s.
- IFTA/IRP, UCR and state permits.
- Separate public copy; the current site must keep saying lease-on is not available.
