-- =============================================================================
-- Documents (private storage), document requirements, agreements and
-- agreement acceptances.
-- =============================================================================

create table public.document_requirements (
  id uuid primary key default gen_random_uuid(),
  doc_type public.document_type not null,
  applies_to text not null check (applies_to in ('carrier', 'driver', 'truck', 'load')),
  label text not null check (char_length(label) between 1 and 120),
  description text check (char_length(description) <= 1000),
  required_for_application boolean not null default false,
  required_for_activation boolean not null default false,
  tracks_expiration boolean not null default false,
  reminder_days integer[] not null default '{30,14,7}',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doc_type, applies_to)
);
create trigger document_requirements_touch before update on public.document_requirements
  for each row execute function app.touch_updated_at();
create trigger document_requirements_audit after insert or update on public.document_requirements
  for each row execute function app.audit_row_change();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid references public.carriers (id),
  application_id uuid references public.carrier_applications (id),
  load_id uuid,
  driver_id uuid,
  truck_id uuid,
  doc_type public.document_type not null,
  status public.document_status not null default 'uploading',
  storage_bucket text not null default 'carrier-documents' check (storage_bucket = 'carrier-documents'),
  storage_path text not null unique check (char_length(storage_path) <= 400 and storage_path !~ '\.\.'),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  expires_on date,
  visibility text not null default 'carrier' check (visibility in ('carrier', 'internal')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 2000),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_owner check (carrier_id is not null or application_id is not null),
  constraint documents_path_scope check (
    (application_id is not null and storage_path like 'applications/' || application_id::text || '/%')
    or (carrier_id is not null and storage_path like 'carriers/' || carrier_id::text || '/%')
  ),
  foreign key (driver_id, carrier_id) references public.drivers (id, carrier_id),
  foreign key (truck_id, carrier_id) references public.trucks (id, carrier_id)
);
create index documents_carrier_idx on public.documents (carrier_id, doc_type) where deleted_at is null;
create index documents_application_idx on public.documents (application_id) where application_id is not null;
create index documents_load_idx on public.documents (load_id) where load_id is not null;
create index documents_expiring_idx on public.documents (expires_on) where deleted_at is null and status = 'accepted';
create trigger documents_touch before update on public.documents
  for each row execute function app.touch_updated_at();

create or replace function app.guard_document_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  immutable_cols text[] := array['storage_bucket', 'storage_path', 'original_filename', 'uploaded_by', 'uploaded_at', 'application_id'];
  carrier_editable text[] := array['status', 'sha256', 'size_bytes', 'mime_type', 'deleted_at', 'deleted_by', 'updated_at'];
  staff_editable text[] := array[
    'status', 'sha256', 'size_bytes', 'mime_type', 'expires_on', 'visibility', 'review_note',
    'reviewed_by', 'reviewed_at', 'deleted_at', 'deleted_by', 'doc_type', 'driver_id', 'truck_id', 'load_id', 'updated_at'
  ];
  k text;
begin
  if tg_op = 'INSERT' then
    if not app.is_system() then
      new.uploaded_by := auth.uid();
      new.status := 'uploading';
      new.reviewed_by := null;
      new.reviewed_at := null;
      if not app.can_staff_access_carrier(new.carrier_id) then
        new.visibility := 'carrier';
      end if;
    end if;
    return new;
  end if;

  if app.is_system() or app.in_internal('carrier_lifecycle') then
    -- Server-side processes and application approval attach application documents to the new carrier.
    if old.carrier_id is not null and new.carrier_id is distinct from old.carrier_id then
      raise exception 'documents cannot be moved between carriers' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.carrier_id is distinct from old.carrier_id then
    raise exception 'documents cannot be moved between carriers' using errcode = '42501';
  end if;
  foreach k in array immutable_cols loop
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      raise exception 'document field % is immutable', k using errcode = '42501';
    end if;
  end loop;

  if app.can_staff_access_carrier(old.carrier_id) then
    if not app.only_columns_changed(to_jsonb(old), to_jsonb(new), staff_editable) then
      raise exception 'field not editable' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status in ('accepted', 'rejected') then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  else
    -- Carrier users: finalize their own uploads or withdraw documents not yet accepted.
    if old.uploaded_by is distinct from auth.uid()
       or not app.only_columns_changed(to_jsonb(old), to_jsonb(new), carrier_editable) then
      raise exception 'carriers may only finalize or withdraw their own uploads' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (old.status = 'uploading' and new.status = 'pending_review') then
      raise exception 'invalid document status change' using errcode = '42501';
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      if old.status = 'accepted' then
        raise exception 'accepted documents are retained and cannot be withdrawn' using errcode = '42501';
      end if;
      new.deleted_by := auth.uid();
    end if;
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := coalesce(new.deleted_by, auth.uid());
  end if;
  return new;
end
$$;
create trigger documents_guard before insert or update on public.documents
  for each row execute function app.guard_document_write();

-- Accepting a newer carrier-level document supersedes the previous one, and an
-- accepted COI keeps the carrier's insurance expiration date current.
create or replace function app.after_document_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.carrier_id is not null then
    if new.doc_type in ('w9', 'certificate_of_insurance', 'operating_authority', 'notice_of_assignment')
       and new.load_id is null and new.driver_id is null and new.truck_id is null then
      update public.documents d
      set status = 'superseded'
      where d.carrier_id = new.carrier_id and d.doc_type = new.doc_type and d.id <> new.id
        and d.status = 'accepted' and d.load_id is null and d.driver_id is null and d.truck_id is null;
    end if;
    if new.doc_type = 'certificate_of_insurance' and new.expires_on is not null then
      update public.carriers c set insurance_expiration_date = new.expires_on where c.id = new.carrier_id;
    end if;
    if new.doc_type = 'notice_of_assignment' then
      update public.carriers c set noa_on_file = true where c.id = new.carrier_id;
    end if;
  end if;
  return null;
end
$$;
create trigger documents_after_review after update of status on public.documents
  for each row execute function app.after_document_review();
create trigger documents_audit after insert or update on public.documents
  for each row execute function app.audit_row_change('original_filename,sha256');

-- -----------------------------------------------------------------------------
-- Agreements
-- -----------------------------------------------------------------------------
create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  audience text not null default 'carrier' check (audience in ('carrier', 'lease_on')),
  required_for_activation boolean not null default false,
  requires_attorney_approval_to_publish boolean not null default false,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger agreements_touch before update on public.agreements for each row execute function app.touch_updated_at();
create trigger agreements_audit after insert or update on public.agreements for each row execute function app.audit_row_change();

create table public.agreement_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements (id),
  version text not null check (version ~ '^[0-9A-Za-z.\-]{1,32}$'),
  title text not null check (char_length(title) between 1 and 200),
  body_markdown text not null check (char_length(body_markdown) between 1 and 200000),
  body_sha256 text not null default '' ,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  legal_review_status text not null default 'requires_attorney_review'
    check (legal_review_status in ('requires_attorney_review', 'attorney_approved')),
  attorney_approved_by_name text check (char_length(attorney_approved_by_name) <= 200),
  attorney_approved_at timestamptz,
  effective_at timestamptz,
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  retired_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agreement_id, version),
  constraint agreement_versions_attorney_fields check (
    legal_review_status = 'requires_attorney_review'
    or (attorney_approved_by_name is not null and attorney_approved_at is not null)
  )
);
create unique index agreement_versions_one_published on public.agreement_versions (agreement_id) where status = 'published';
create trigger agreement_versions_touch before update on public.agreement_versions for each row execute function app.touch_updated_at();

create or replace function app.guard_agreement_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  needs_attorney boolean;
begin
  new.body_sha256 := encode(extensions.digest(convert_to(new.body_markdown, 'UTF8'), 'sha256'), 'hex');

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.status <> 'draft' then
      raise exception 'new agreement versions start as drafts' using errcode = '23514';
    end if;
  else
    if old.status <> 'draft' and (
      new.body_markdown is distinct from old.body_markdown
      or new.title is distinct from old.title
      or new.version is distinct from old.version
      or new.agreement_id is distinct from old.agreement_id
    ) then
      raise exception 'published agreement text is immutable; create a new version' using errcode = '42501',
        hint = 'immutable_record';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'draft' and new.status = 'published')
      or (old.status = 'published' and new.status = 'retired')
    ) then
      raise exception 'invalid agreement version status change' using errcode = '23514';
    end if;
  end if;

  if new.legal_review_status = 'attorney_approved'
     and (tg_op = 'INSERT' or old.legal_review_status <> 'attorney_approved')
     and not (app.is_system() or app.is_super_admin()) then
    raise exception 'only a super administrator can record attorney approval' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.legal_review_status = 'attorney_approved' and new.legal_review_status <> 'attorney_approved' then
    raise exception 'attorney approval cannot be withdrawn on a version; retire it instead' using errcode = '23514';
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status = 'draft') then
    select a.requires_attorney_approval_to_publish into needs_attorney from public.agreements a where a.id = new.agreement_id;
    if needs_attorney and new.legal_review_status <> 'attorney_approved' then
      raise exception 'this agreement can only be published after attorney approval' using errcode = '23514',
        hint = 'attorney_approval_required';
    end if;
    update public.agreement_versions v
    set status = 'retired', retired_at = now()
    where v.agreement_id = new.agreement_id and v.status = 'published' and v.id <> new.id;
    new.published_at := now();
    new.published_by := auth.uid();
    new.effective_at := coalesce(new.effective_at, now());
  end if;
  if new.status = 'retired' and tg_op = 'UPDATE' and old.status <> 'retired' then
    new.retired_at := now();
  end if;
  return new;
end
$$;
create trigger agreement_versions_guard before insert or update on public.agreement_versions
  for each row execute function app.guard_agreement_version();
create trigger agreement_versions_no_delete before delete on public.agreement_versions
  for each row execute function app.prevent_mutation();
create trigger agreement_versions_audit after insert or update on public.agreement_versions
  for each row execute function app.audit_row_change('body_markdown');

create table public.agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null references public.agreement_versions (id),
  carrier_id uuid not null references public.carriers (id),
  user_id uuid not null references public.profiles (id),
  signer_name text not null check (char_length(signer_name) between 2 and 200),
  signer_title text check (char_length(signer_title) <= 120),
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text check (char_length(user_agent) <= 512),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revocation_reason text check (char_length(revocation_reason) <= 2000),
  terminated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index agreement_acceptances_active_unique
  on public.agreement_acceptances (agreement_version_id, carrier_id)
  where revoked_at is null and terminated_at is null;
create index agreement_acceptances_carrier_idx on public.agreement_acceptances (carrier_id);

create or replace function app.guard_agreement_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if tg_op = 'INSERT' then
    select av.status, av.body_sha256 into v from public.agreement_versions av where av.id = new.agreement_version_id;
    if v.status is distinct from 'published' then
      raise exception 'only the published agreement version can be accepted' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.carriers c
      join public.organization_members m on m.organization_id = c.organization_id
      where c.id = new.carrier_id and m.user_id = new.user_id
        and m.status = 'active' and m.role = 'carrier_owner'
    ) then
      raise exception 'agreements must be accepted by an active carrier owner' using errcode = '42501';
    end if;
    if new.document_hash is distinct from v.body_sha256 then
      raise exception 'document hash does not match the published agreement text' using errcode = '23514';
    end if;
    new.accepted_at := now();
    new.revoked_at := null;
    new.terminated_at := null;
    return new;
  end if;

  if not app.only_columns_changed(to_jsonb(old), to_jsonb(new),
       array['revoked_at', 'revoked_by', 'revocation_reason', 'terminated_at']) then
    raise exception 'agreement acceptances are immutable except for revocation or termination'
      using errcode = '42501', hint = 'immutable_record';
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_by := coalesce(new.revoked_by, auth.uid());
  end if;
  return new;
end
$$;
create trigger agreement_acceptances_guard before insert or update on public.agreement_acceptances
  for each row execute function app.guard_agreement_acceptance();
create trigger agreement_acceptances_no_delete before delete on public.agreement_acceptances
  for each row execute function app.prevent_mutation();
create trigger agreement_acceptances_audit after insert or update on public.agreement_acceptances
  for each row execute function app.audit_row_change('ip_address,user_agent');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.document_requirements enable row level security;
alter table public.documents enable row level security;
alter table public.agreements enable row level security;
alter table public.agreement_versions enable row level security;
alter table public.agreement_acceptances enable row level security;

create policy document_requirements_select on public.document_requirements for select to anon, authenticated
  using (active or (select app.is_staff()));
create policy document_requirements_insert on public.document_requirements for insert to authenticated
  with check ((select app.is_admin()));
create policy document_requirements_update on public.document_requirements for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select on public.document_requirements to anon;

create policy documents_select on public.documents for select to authenticated
  using (
    (carrier_id is not null and app.can_staff_access_carrier(carrier_id))
    or (carrier_id is null and application_id is not null and (select app.is_staff()))
    or (carrier_id is not null and visibility = 'carrier' and deleted_at is null and app.is_carrier_member(carrier_id))
  );
create policy documents_insert on public.documents for insert to authenticated
  with check (
    carrier_id is not null and application_id is null
    and (app.can_staff_access_carrier(carrier_id) or app.is_carrier_member(carrier_id))
  );
create policy documents_update on public.documents for update to authenticated
  using (
    carrier_id is not null
    and (app.can_staff_access_carrier(carrier_id) or (app.is_carrier_member(carrier_id) and uploaded_by = (select auth.uid())))
  )
  with check (
    carrier_id is not null
    and (app.can_staff_access_carrier(carrier_id) or (app.is_carrier_member(carrier_id) and uploaded_by = (select auth.uid())))
  );

create policy agreements_select on public.agreements for select to authenticated using (true);
create policy agreements_insert on public.agreements for insert to authenticated with check ((select app.is_admin()));
create policy agreements_update on public.agreements for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy agreement_versions_select on public.agreement_versions for select to authenticated
  using (status in ('published', 'retired') or (select app.is_staff()));
create policy agreement_versions_insert on public.agreement_versions for insert to authenticated
  with check ((select app.is_admin()));
create policy agreement_versions_update on public.agreement_versions for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Acceptances are inserted by the server (service role) so that IP address and
-- user agent come from the request rather than the client; the guard trigger
-- still verifies signer, version and hash for every insert.
create policy agreement_acceptances_select on public.agreement_acceptances for select to authenticated
  using (app.can_read_carrier(carrier_id));
create policy agreement_acceptances_update on public.agreement_acceptances for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

revoke delete, truncate on public.agreement_acceptances, public.agreement_versions from authenticated, anon;

-- -----------------------------------------------------------------------------
-- Private storage bucket. Objects are uploaded through short-lived signed
-- upload URLs issued by the server and read through short-lived signed URLs.
-- Direct reads are allowed only when the caller can see the matching
-- documents row (documents RLS applies inside the policy subquery).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carrier-documents', 'carrier-documents', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy carrier_documents_select on storage.objects for select to authenticated
  using (
    bucket_id = 'carrier-documents'
    and exists (
      select 1 from public.documents d
      where d.storage_bucket = storage.objects.bucket_id and d.storage_path = storage.objects.name
    )
  );
