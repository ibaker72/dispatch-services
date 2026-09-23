/**
 * The app writes through PostgREST with the user's own token. PostgREST reads
 * the written row back, so these tests exercise the exact write paths the UI
 * uses (not just raw SQL) for carrier owners, members and dispatchers.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs } from "./support/clients";
import { closePool } from "../db/support/harness";
import { type World, createWorld } from "../db/support/world";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

describe("carrier owner writes", () => {
  it("updates operating preferences on their own carrier only", async () => {
    const owner = clientAs(w.A.ownerId);
    const own = await owner.from("carriers").update({ min_rate_per_mile: 2.35, days_available: ["mon", "tue"] }).eq("id", w.A.carrierId).select("id");
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    const other = await owner.from("carriers").update({ min_rate_per_mile: 9 }).eq("id", w.B.carrierId).select("id");
    expect(other.data ?? []).toHaveLength(0);
  });

  it("cannot change identity or status fields", async () => {
    const res = await clientAs(w.A.ownerId).from("carriers").update({ legal_name: "Renamed LLC" }).eq("id", w.A.carrierId).select("id");
    expect(res.error?.message).toMatch(/operating preferences/);
  });

  it("members cannot update the carrier profile", async () => {
    const res = await clientAs(w.A.memberId).from("carriers").update({ min_rate_per_mile: 5 }).eq("id", w.A.carrierId).select("id");
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
  });

  it("owners invite and revoke team members through the same path as the portal", async () => {
    const owner = clientAs(w.A.ownerId);
    const invite = await owner
      .from("organization_invitations")
      .insert({ organization_id: w.A.orgId, email: `helper-${w.suffix}@test.example`, role: "carrier_member", token_hash: randomBytes(32).toString("hex"), invited_by: w.A.ownerId, expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id")
      .single();
    expect(invite.error).toBeNull();
    const revoke = await owner.from("organization_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", invite.data!.id).select("id");
    expect(revoke.data).toHaveLength(1);
    const ownerInvite = await owner
      .from("organization_invitations")
      .insert({ organization_id: w.A.orgId, email: `boss-${w.suffix}@test.example`, role: "carrier_owner", token_hash: randomBytes(32).toString("hex"), invited_by: w.A.ownerId, expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id");
    expect(ownerInvite.error).not.toBeNull();
  });
});

describe("dispatcher writes", () => {
  it("edits operational fields for assigned carriers only", async () => {
    const dispatcher = clientAs(w.dispatcherAId);
    const own = await dispatcher.from("carriers").update({ preferences_notes: "Prefers early pickups" }).eq("id", w.A.carrierId).select("id");
    expect(own.data).toHaveLength(1);
    const other = await dispatcher.from("carriers").update({ preferences_notes: "x" }).eq("id", w.B.carrierId).select("id");
    expect(other.data ?? []).toHaveLength(0);
  });

  it("logs communications for assigned carriers; delivery status is always 'logged'", async () => {
    const res = await clientAs(w.dispatcherAId)
      .from("communications")
      .insert({ carrier_id: w.A.carrierId, channel: "phone", direction: "outbound", body_text: "Called about lanes", status: "sent", visibility: "internal" })
      .select("status")
      .single();
    expect(res.error).toBeNull();
    expect(res.data!.status).toBe("logged");
    const denied = await clientAs(w.dispatcherAId).from("communications").insert({ carrier_id: w.B.carrierId, channel: "note", direction: "internal", body_text: "x" }).select("id");
    expect(denied.error).not.toBeNull();
  });
});
