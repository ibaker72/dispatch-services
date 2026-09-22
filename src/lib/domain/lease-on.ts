/**
 * Lease-on operations gate. Lease-on workflows are available only when ALL of
 * the following hold:
 *   1. LEASE_ON_OPERATIONS_ENABLED=true in the server environment,
 *   2. the `lease_on_operations` feature flag is enabled in the database, and
 *   3. every compliance requirement below exists.
 * The database independently refuses to enable the flag (and blocks writes to
 * prepared lease-on tables) until the requirements exist.
 */

export const LEASE_ON_REQUIREMENTS = [
  { key: "usdot_number", label: "Company USDOT number" },
  { key: "mc_number", label: "Company MC number" },
  { key: "authority_effective_date", label: "Operating authority effective date" },
  { key: "insurance_filing_verified", label: "Insurance filing verified with FMCSA" },
  { key: "boc3_verified", label: "BOC-3 process agent filing verified" },
  { key: "compliance_administrator", label: "Designated compliance administrator" },
  { key: "attorney_approved_lease_version", label: "Attorney-approved owner-operator lease" },
] as const;

export type LeaseOnRequirementKey = (typeof LEASE_ON_REQUIREMENTS)[number]["key"];

export interface LeaseOnInput {
  envEnabled: boolean;
  flagEnabled: boolean;
  requirements: Partial<Record<LeaseOnRequirementKey, boolean>>;
}

export interface LeaseOnDecision {
  enabled: boolean;
  missing: LeaseOnRequirementKey[];
  reasons: string[];
}

export function evaluateLeaseOn(input: LeaseOnInput): LeaseOnDecision {
  const missing = LEASE_ON_REQUIREMENTS.filter((r) => input.requirements[r.key] !== true).map((r) => r.key);
  const reasons: string[] = [];
  if (!input.envEnabled) reasons.push("LEASE_ON_OPERATIONS_ENABLED is not true on the server.");
  if (!input.flagEnabled) reasons.push("The lease_on_operations feature flag is off.");
  for (const key of missing) {
    const label = LEASE_ON_REQUIREMENTS.find((r) => r.key === key)?.label ?? key;
    reasons.push(`Missing: ${label}.`);
  }
  return { enabled: reasons.length === 0, missing, reasons };
}
