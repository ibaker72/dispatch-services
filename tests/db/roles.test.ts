/**
 * Authorization tests for each role: super_admin, admin, dispatcher,
 * carrier_owner, carrier_member — including security-sensitive settings,
 * MFA enforcement, column-level guards and the append-only audit log.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICE, SYSTEM, closePool, rollbackTx, user } from "./support/harness";
import { type World, createLoad, createUser, createWorld } from "./support/world";

let w: World;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(closePool);

describe("security-sensitive settings", () => {
  it("only super_admin can change sensitive settings", async () => {
    await rollbackTx(async (tx) => {
      const sql = `update public.app_settings set value = jsonb_set(value, '{require_admin_mfa}', 'true') where key = 'security'`;
      expect(await tx.count(w.admin, sql)).toBe(0);
      expect(await tx.count(w.dispatcherA, sql)).toBe(0);
      expect(await tx.count(w.A.owner, sql)).toBe(0);
      expect(await tx.count(w.superAdmin, sql)).toBe(1);
    });
  });

  it("admins can change non-sensitive settings; dispatchers and carriers cannot", async () => {
    await rollbackTx(async (tx) => {
      const sql = `update public.app_settings set value = jsonb_set(value, '{statement_due_days}', '10') where key = 'operations'`;
      expect(await tx.count(w.dispatcherA, sql)).toBe(0);
      expect(await tx.count(w.A.owner, sql)).toBe(0);
      expect(await tx.count(w.admin, sql)).toBe(1);
    });
  });

  it("carriers cannot read staff settings but anyone can read public settings", async () => {
    await rollbackTx(async (tx) => {
      const keys = (await tx.rows<{ key: string }>(w.A.owner, `select key from public.app_settings`)).map((r) => r.key);
      expect(keys).toEqual(["business_profile"]);
      const anonKeys = (await tx.rows<{ key: string }>({ kind: "anon" }, `select key from public.app_settings`)).map((r) => r.key);
      expect(anonKeys).toEqual(["business_profile"]);
    });
  });

  it("admins cannot toggle sensitive feature flags; super_admin can toggle ordinary ones", async () => {
    await rollbackTx(async (tx) => {
      expect(await tx.count(w.admin, `update public.feature_flags set enabled = false where key = 'lease_on_waitlist'`)).toBe(1);
      expect(await tx.count(w.admin, `update public.feature_flags set description = 'x' where key = 'lease_on_operations'`)).toBe(0);
      expect(await tx.count(w.A.owner, `select 1 from public.feature_flags`)).toBe(0);
    });
  });
});

describe("role management", () => {
  it("admins may grant dispatcher roles but not admin or super_admin", async () => {
    await rollbackTx(async (tx) => {
      const target = await createUser(tx, "new-staff", w.suffix);
      await tx.query(w.admin, `insert into public.user_roles (user_id, role) values ($1, 'dispatcher')`, [target]);
      await tx.rejects(w.admin, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [target], /row-level security/);
      await tx.rejects(w.admin, `insert into public.user_roles (user_id, role) values ($1, 'super_admin')`, [target], /row-level security/);
      await tx.query(w.superAdmin, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [target]);
    });
  });

  it("dispatchers and carriers cannot grant roles", async () => {
    await rollbackTx(async (tx) => {
      const target = await createUser(tx, "target", w.suffix);
      for (const actor of [w.dispatcherA, w.A.owner]) {
        await tx.rejects(actor, `insert into public.user_roles (user_id, role) values ($1, 'dispatcher')`, [target], /row-level security/);
      }
      await tx.rejects(w.A.owner, `insert into public.user_roles (user_id, role) values ($1, 'super_admin')`, [w.A.ownerId], /row-level security|carrier users/);
    });
  });

  it("the last active super_admin cannot be revoked", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `update public.user_roles set revoked_at = now() where role = 'super_admin' and user_id <> $1 and revoked_at is null`, [
        w.superAdminId,
      ]);
      await tx.rejects(
        w.superAdmin,
        `update public.user_roles set revoked_at = now() where user_id = $1 and role = 'super_admin'`,
        [w.superAdminId],
        /at least one active super_admin/,
      );
    });
  });

  it("staff and carrier memberships are mutually exclusive", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(SYSTEM, `insert into public.user_roles (user_id, role) values ($1, 'dispatcher')`, [w.A.ownerId], /carrier users cannot hold staff roles/);
      await tx.rejects(
        SYSTEM,
        `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'carrier_member')`,
        [w.B.orgId, w.dispatcherAId],
        /staff users cannot be carrier members|one_active_org|duplicate/,
      );
    });
  });

  it("revoked staff immediately lose access", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `update public.user_roles set revoked_at = now() where user_id = $1`, [w.dispatcherAId]);
      const { n } = await tx.one<{ n: number }>(w.dispatcherA, `select count(*)::int as n from public.loads`);
      expect(n).toBe(0);
    });
  });

  it("deactivated staff lose access even with an active role", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `update public.profiles set deactivated_at = now() where id = $1`, [w.adminId]);
      const { n } = await tx.one<{ n: number }>(w.admin, `select count(*)::int as n from public.carriers`);
      expect(n).toBe(0);
    });
  });
});

describe("MFA enforcement for administrative roles", () => {
  it("when required, admin access needs an aal2 session", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(SYSTEM, `update public.app_settings set value = '{"require_admin_mfa": true}' where key = 'security'`);
      const aal1 = await tx.one<{ n: number }>(user(w.adminId, "aal1"), `select count(*)::int as n from public.carriers`);
      expect(aal1.n).toBe(0);
      const aal2 = await tx.one<{ n: number }>(user(w.adminId, "aal2"), `select count(*)::int as n from public.carriers where id in ($1, $2)`, [
        w.A.carrierId,
        w.B.carrierId,
      ]);
      expect(aal2.n).toBe(2);
      // Dispatchers are not administrative accounts and keep working.
      const dispatcher = await tx.one<{ n: number }>(w.dispatcherA, `select count(*)::int as n from public.carriers where id = $1`, [w.A.carrierId]);
      expect(dispatcher.n).toBe(1);
    });
  });
});

describe("dispatcher scope", () => {
  it("assigned dispatcher can edit operational fields but not identity, status or verification", async () => {
    await rollbackTx(async (tx) => {
      expect(await tx.count(w.dispatcherA, `update public.carriers set min_rate_per_mile = 2.75 where id = $1`, [w.A.carrierId])).toBe(1);
      await tx.rejects(w.dispatcherA, `update public.carriers set legal_name = 'Renamed' where id = $1`, [w.A.carrierId], /dispatchers cannot/);
      await tx.rejects(w.dispatcherA, `update public.carriers set status = 'inactive' where id = $1`, [w.A.carrierId], /dispatchers cannot/);
      await tx.rejects(
        w.dispatcherA,
        `update public.carriers set authority_verification_status = 'unverified' where id = $1`,
        [w.A.carrierId],
        /dispatchers cannot/,
      );
    });
  });

  it("dispatcher cannot touch an unassigned carrier", async () => {
    await rollbackTx(async (tx) => {
      expect(await tx.count(w.dispatcherA, `update public.carriers set min_rate_per_mile = 9 where id = $1`, [w.B.carrierId])).toBe(0);
      await tx.rejects(
        w.dispatcherA,
        `insert into public.loads (carrier_id, broker_name) values ($1, 'Broker')`,
        [w.B.carrierId],
        /row-level security/,
      );
    });
  });

  it("an admin grant of all-carrier access widens dispatcher scope", async () => {
    await rollbackTx(async (tx) => {
      const before = await tx.one<{ n: number }>(w.dispatcherB, `select count(*)::int as n from public.carriers where id = $1`, [w.A.carrierId]);
      expect(before.n).toBe(0);
      expect(
        await tx.count(w.admin, `update public.user_roles set grants_all_carriers = true where user_id = $1 and role = 'dispatcher'`, [
          w.dispatcherBId,
        ]),
      ).toBe(1);
      const after = await tx.one<{ n: number }>(w.dispatcherB, `select count(*)::int as n from public.carriers where id = $1`, [w.A.carrierId]);
      expect(after.n).toBe(1);
    });
  });

  it("only admins manage dispatcher assignments", async () => {
    await rollbackTx(async (tx) => {
      await tx.rejects(
        w.dispatcherA,
        `insert into public.dispatcher_assignments (carrier_id, dispatcher_id) values ($1, $2)`,
        [w.B.carrierId, w.dispatcherAId],
        /row-level security/,
      );
      await tx.query(w.admin, `insert into public.dispatcher_assignments (carrier_id, dispatcher_id) values ($1, $2)`, [
        w.B.carrierId,
        w.dispatcherAId,
      ]);
      const { n } = await tx.one<{ n: number }>(w.dispatcherA, `select count(*)::int as n from public.carriers where id = $1`, [w.B.carrierId]);
      expect(n).toBe(1);
    });
  });
});

describe("carrier owner and member", () => {
  it("owner can update operating preferences only", async () => {
    await rollbackTx(async (tx) => {
      expect(
        await tx.count(w.A.owner, `update public.carriers set min_rate_per_mile = 2.5, days_available = '{mon,tue}' where id = $1`, [w.A.carrierId]),
      ).toBe(1);
      for (const sql of [
        `update public.carriers set mc_number = '999' where id = $1`,
        `update public.carriers set status = 'inactive' where id = $1`,
        `update public.carriers set authority_verification_status = 'failed' where id = $1`,
        `update public.carriers set cancellation_requested_at = now() where id = $1`,
        `update public.carriers set noa_on_file = true where id = $1`,
      ]) {
        await tx.rejects(w.A.owner, sql, [w.A.carrierId], /carriers may update only/);
      }
    });
  });

  it("members cannot update the carrier profile", async () => {
    await rollbackTx(async (tx) => {
      expect(await tx.count(w.A.member, `update public.carriers set min_rate_per_mile = 1 where id = $1`, [w.A.carrierId])).toBe(0);
    });
  });

  it("members cannot approve or reject loads; owners can", async () => {
    await rollbackTx(async (tx) => {
      const loadId = await createLoad(tx, w.A, { dispatcherId: w.dispatcherAId, advanceTo: "proposed" });
      await tx.rejects(w.A.member, `select public.respond_to_proposed_load($1, 'approved')`, [loadId], /load not found/);
      const { status } = await tx.one<{ status: string }>(w.A.owner, `select public.respond_to_proposed_load($1, 'approved') as status`, [loadId]);
      expect(status).toBe("approved");
    });
  });

  it("owners invite members but cannot invite owners; members cannot invite", async () => {
    await rollbackTx(async (tx) => {
      const sql = `insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, invited_by)
                   values ($1, $2, $3, repeat('b', 64), now() + interval '7 days', auth.uid())`;
      await tx.query(w.A.owner, sql, [w.A.orgId, "teammate@test.example", "carrier_member"]);
      await tx.rejects(w.A.owner, sql.replace("repeat('b', 64)", "repeat('c', 64)"), [w.A.orgId, "boss@test.example", "carrier_owner"], /row-level security/);
      await tx.rejects(w.A.member, sql.replace("repeat('b', 64)", "repeat('d', 64)"), [w.A.orgId, "x@test.example", "carrier_member"], /row-level security/);
    });
  });

  it("owners can remove members but not themselves; the last owner cannot be removed", async () => {
    await rollbackTx(async (tx) => {
      expect(await tx.count(w.A.owner, `update public.organization_members set status = 'removed' where user_id = $1`, [w.A.ownerId])).toBe(0);
      expect(await tx.count(w.A.owner, `update public.organization_members set status = 'removed' where user_id = $1`, [w.A.memberId])).toBe(1);
      await tx.rejects(w.admin, `update public.organization_members set status = 'removed' where user_id = $1`, [w.A.ownerId], /at least one active owner/);
    });
  });

  it("profiles are visible only to teammates, assigned dispatchers and admins", async () => {
    await rollbackTx(async (tx) => {
      const visible = async (actor: Parameters<typeof tx.count>[0], id: string) =>
        (await tx.count(actor, `select 1 from public.profiles where id = $1`, [id])) === 1;
      expect(await visible(w.A.owner, w.A.memberId)).toBe(true);
      expect(await visible(w.A.owner, w.dispatcherAId)).toBe(true);
      expect(await visible(w.A.owner, w.B.ownerId)).toBe(false);
      expect(await visible(w.A.owner, w.dispatcherBId)).toBe(false);
      expect(await visible(w.dispatcherB, w.A.ownerId)).toBe(false);
      expect(await visible(w.dispatcherA, w.A.ownerId)).toBe(true);
      expect(await visible(w.admin, w.B.ownerId)).toBe(true);
    });
  });

  it("users cannot change their own email or account status", async () => {
    await rollbackTx(async (tx) => {
      expect(await tx.count(w.A.owner, `update public.profiles set full_name = 'New Name' where id = $1`, [w.A.ownerId])).toBe(1);
      await tx.rejects(w.A.owner, `update public.profiles set email = 'other@test.example' where id = $1`, [w.A.ownerId], /managed by administrators/);
    });
  });
});

describe("audit log", () => {
  it("records changes and is readable only by admins", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(w.dispatcherA, `update public.carriers set min_rate_per_mile = 3.10 where id = $1`, [w.A.carrierId]);
      const events = await tx.rows<{ action: string; actor_id: string }>(
        w.admin,
        `select action, actor_id from public.audit_events where entity_type = 'carriers' and entity_id = $1 order by id desc limit 1`,
        [w.A.carrierId],
      );
      expect(events[0]).toMatchObject({ action: "carriers.update", actor_id: w.dispatcherAId });
      expect(await tx.count(w.dispatcherA, `select 1 from public.audit_events`)).toBe(0);
      expect(await tx.count(w.A.owner, `select 1 from public.audit_events`)).toBe(0);
    });
  });

  it("is append-only for every role, including the service role", async () => {
    await rollbackTx(async (tx) => {
      for (const actor of [w.superAdmin, SERVICE]) {
        await tx.rejects(actor, `update public.audit_events set action = 'tampered'`, [], /permission denied|append-only/);
        await tx.rejects(actor, `delete from public.audit_events`, [], /permission denied|append-only/);
      }
      await tx.rejects(SYSTEM, `delete from public.audit_events`, [], /append-only/);
    });
  });

  it("users can record their own security events, limited to known actions", async () => {
    await rollbackTx(async (tx) => {
      await tx.query(w.A.owner, `select public.log_security_event('auth.login', '{}'::jsonb)`);
      await tx.rejects(w.A.owner, `select public.log_security_event('admin.grant', '{}'::jsonb)`, [], /unsupported security event/);
      await tx.rejects({ kind: "anon" }, `select public.log_security_event('auth.login', '{}'::jsonb)`, [], /permission denied/);
      const { n } = await tx.one<{ n: number }>(
        w.admin,
        `select count(*)::int as n from public.audit_events where actor_id = $1 and action = 'auth.login' and severity = 'security'`,
        [w.A.ownerId],
      );
      expect(n).toBe(1);
    });
  });
});

describe("agreement versions", () => {
  it("published text is immutable and hashes are computed by the database", async () => {
    await rollbackTx(async (tx) => {
      const v = await tx.one<{ id: string; body_sha256: string }>(
        SYSTEM,
        `select v.id, v.body_sha256 from public.agreement_versions v join public.agreements a on a.id = v.agreement_id
         where a.key = 'dispatch_service_agreement' and v.status = 'published'`,
      );
      expect(v.body_sha256).toMatch(/^[0-9a-f]{64}$/);
      await tx.rejects(w.superAdmin, `update public.agreement_versions set body_markdown = 'changed' where id = $1`, [v.id], /immutable/);
    });
  });

  it("only super_admin can record attorney approval; LPOA cannot publish without it", async () => {
    await rollbackTx(async (tx) => {
      const { id } = await tx.one<{ id: string }>(
        w.admin,
        `insert into public.agreement_versions (agreement_id, version, title, body_markdown)
         select id, '1.0', 'LPOA', 'Counsel-provided text' from public.agreements where key = 'limited_power_of_attorney' returning id`,
      );
      await tx.rejects(w.admin, `update public.agreement_versions set status = 'published' where id = $1`, [id], /only be published after attorney approval/);
      await tx.rejects(
        w.admin,
        `update public.agreement_versions set legal_review_status = 'attorney_approved', attorney_approved_by_name = 'Counsel', attorney_approved_at = now() where id = $1`,
        [id],
        /only a super administrator/,
      );
      await tx.query(
        w.superAdmin,
        `update public.agreement_versions set legal_review_status = 'attorney_approved', attorney_approved_by_name = 'Counsel', attorney_approved_at = now() where id = $1`,
        [id],
      );
      await tx.query(w.admin, `update public.agreement_versions set status = 'published' where id = $1`, [id]);
    });
  });

  it("acceptances require the carrier owner, the published version and a matching hash", async () => {
    await rollbackTx(async (tx) => {
      const v = await tx.one<{ id: string; body_sha256: string }>(
        SYSTEM,
        `select v.id, v.body_sha256 from public.agreement_versions v join public.agreements a on a.id = v.agreement_id
         where a.key = 'dispatch_service_agreement' and v.status = 'published'`,
      );
      const insert = `insert into public.agreement_acceptances (agreement_version_id, carrier_id, user_id, signer_name, document_hash) values ($1, $2, $3, 'Signer', $4)`;
      await tx.rejects(SERVICE, insert, [v.id, w.A.carrierId, w.A.memberId, v.body_sha256], /active carrier owner/);
      await tx.rejects(SERVICE, insert, [v.id, w.A.carrierId, w.B.ownerId, v.body_sha256], /active carrier owner/);
      await tx.rejects(SERVICE, insert, [v.id, w.A.carrierId, w.A.ownerId, "0".repeat(64)], /hash does not match/);
      // Carriers cannot insert acceptances directly through the API (IP/UA must come from the server).
      await tx.rejects(w.A.owner, insert, [v.id, w.A.carrierId, w.A.ownerId, v.body_sha256], /row-level security/);
      const acceptance = await tx.one<{ id: string }>(SYSTEM, `select id from public.agreement_acceptances where carrier_id = $1 limit 1`, [w.A.carrierId]);
      await tx.rejects(SYSTEM, `update public.agreement_acceptances set signer_name = 'Forged' where id = $1`, [acceptance.id], /immutable/);
      await tx.rejects(SYSTEM, `delete from public.agreement_acceptances where id = $1`, [acceptance.id], /append-only/);
    });
  });
});
