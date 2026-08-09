-- Hearthland T3.3 security hardening follow-up.
--
-- This migration changes only Hearthland-owned schemas, functions, and the
-- three Hearthland Storage buckets. The pre-existing COM tables and Storage
-- buckets are neither altered nor repurposed.

begin;

-- ---------------------------------------------------------------------------
-- Immediate account-state revocation
-- ---------------------------------------------------------------------------

create or replace function hearthland_private.current_account_is_active()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from hearthland.accounts a
      where a.id = (select auth.uid())
        and a.account_status = 'active'
        and a.archived_at is null
    ),
    false
  );
$$;

comment on function hearthland_private.current_account_is_active() is
  'Returns true only when the current JWT belongs to an active, non-archived Hearthland account.';

revoke all on function hearthland_private.current_account_is_active()
  from public, anon;
grant execute on function hearthland_private.current_account_is_active()
  to authenticated;

-- A restrictive policy is ANDed with every matching permissive policy. This
-- closes every Hearthland Data API table immediately for a suspended,
-- deactivated, pending-deletion, archived, or missing account while leaving
-- anonymous public-directory access unchanged.
do $$
declare
  target record;
begin
  for target in
    select table_name
    from information_schema.tables
    where table_schema = 'hearthland'
      and table_type = 'BASE TABLE'
  loop
    execute format(
      'drop policy if exists active_authenticated_account_gate on hearthland.%I',
      target.table_name
    );
    execute format(
      'create policy active_authenticated_account_gate on hearthland.%I '
      'as restrictive for all to authenticated '
      'using ((select hearthland_private.current_account_is_active())) '
      'with check ((select hearthland_private.current_account_is_active()))',
      target.table_name
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contact-visible profile links
-- ---------------------------------------------------------------------------

alter table hearthland.profile_contacts
  add column links jsonb not null default '[]'::jsonb
  check (jsonb_typeof(links) = 'array');

-- Preserve any pre-hardening links under the existing contact visibility. A
-- profile without a contact row receives the privacy-preserving default.
insert into hearthland.profile_contacts (
  profile_entity_id,
  links,
  visibility
)
select
  p.entity_id,
  p.links,
  'connections'
from hearthland.person_profiles p
where p.links <> '[]'::jsonb
on conflict (profile_entity_id) do update
set links = excluded.links,
    updated_at = now();

update hearthland.person_profiles
set links = '[]'::jsonb,
    updated_at = now()
where links <> '[]'::jsonb;

alter table hearthland.person_profiles
  add constraint person_profiles_links_must_be_empty
  check (links = '[]'::jsonb);

comment on column hearthland.profile_contacts.links is
  'Website and social links protected by the same row visibility as contact details.';
comment on column hearthland.person_profiles.links is
  'Deprecated compatibility column. Always empty; use profile_contacts.links.';

-- Keep the sizeable, already-verified implementation private and put a narrow
-- active-account/link-routing wrapper at the exposed RPC name.
alter function hearthland.save_my_profile(jsonb)
  rename to save_my_profile_unchecked_v1;
alter function hearthland.save_my_profile_unchecked_v1(jsonb)
  set schema hearthland_private;

revoke all on function hearthland_private.save_my_profile_unchecked_v1(jsonb)
  from public, anon, authenticated;

create function hearthland.save_my_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  profile_id uuid;
  prepared_payload jsonb := payload;
  resolved_contact_visibility text;
begin
  if current_account_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;
  if payload ? 'links' and jsonb_typeof(payload -> 'links') <> 'array' then
    raise exception 'links must be an array';
  end if;
  if payload ? 'contact_visibility'
     and payload ->> 'contact_visibility' not in (
       'public', 'members', 'connections', 'private'
     ) then
    raise exception 'Invalid contact_visibility';
  end if;

  if payload ? 'links' then
    select p.entity_id
    into profile_id
    from hearthland.person_profiles p
    where p.account_id = current_account_id;

    if profile_id is null then
      raise exception 'Hearthland profile was not initialized for this account';
    end if;

    resolved_contact_visibility := coalesce(
      payload ->> 'contact_visibility',
      (
        select pc.visibility
        from hearthland.profile_contacts pc
        where pc.profile_entity_id = profile_id
      ),
      'connections'
    );

    insert into hearthland.profile_contacts as existing_contact (
      profile_entity_id,
      links,
      visibility
    ) values (
      profile_id,
      payload -> 'links',
      resolved_contact_visibility
    )
    on conflict (profile_entity_id) do update
    set links = excluded.links,
        visibility = case
          when payload ? 'contact_visibility' then excluded.visibility
          else existing_contact.visibility
        end,
        updated_at = now();

    -- The private legacy implementation continues to own the remaining
    -- atomic profile writes, but it must never write the deprecated column.
    prepared_payload := payload - 'links';
  end if;

  return hearthland_private.save_my_profile_unchecked_v1(prepared_payload);
end;
$$;

comment on function hearthland.save_my_profile(jsonb) is
  'Saves an active caller profile and stores links only in visibility-protected profile_contacts.';
revoke all on function hearthland.save_my_profile(jsonb)
  from public, anon;
grant execute on function hearthland.save_my_profile(jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Active-account guards for SECURITY DEFINER application entrypoints
-- ---------------------------------------------------------------------------

-- The one-argument creation function is an internal implementation used by
-- the draft-completion function. Keep that API non-callable by application
-- roles while adding the account-state guard for its trusted caller.
alter function hearthland.create_emerging_community_project(jsonb)
  rename to create_emerging_community_project_unchecked_v1;
alter function hearthland.create_emerging_community_project_unchecked_v1(jsonb)
  set schema hearthland_private;

revoke all on function hearthland_private.create_emerging_community_project_unchecked_v1(jsonb)
  from public, anon, authenticated;

create function hearthland.create_emerging_community_project(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;
  return hearthland_private.create_emerging_community_project_unchecked_v1(payload);
end;
$$;

comment on function hearthland.create_emerging_community_project(jsonb) is
  'Internal active-account guarded creator used by the idempotent draft completion RPC.';
revoke all on function hearthland.create_emerging_community_project(jsonb)
  from public, anon, authenticated;

-- Guard the public, idempotent three-argument completion overload, including
-- its replay path which can return before invoking the one-argument creator.
alter function hearthland.create_emerging_community_project(uuid, jsonb, jsonb)
  rename to complete_emerging_community_project_unchecked_v1;
alter function hearthland.complete_emerging_community_project_unchecked_v1(uuid, jsonb, jsonb)
  set schema hearthland_private;

revoke all on function hearthland_private.complete_emerging_community_project_unchecked_v1(uuid, jsonb, jsonb)
  from public, anon, authenticated;

create function hearthland.create_emerging_community_project(
  draft_id uuid,
  draft_payload jsonb,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;
  return hearthland_private.complete_emerging_community_project_unchecked_v1(
    draft_id,
    draft_payload,
    payload
  );
end;
$$;

comment on function hearthland.create_emerging_community_project(uuid, jsonb, jsonb) is
  'Idempotently completes an active caller-owned creation draft.';
revoke all on function hearthland.create_emerging_community_project(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function hearthland.create_emerging_community_project(uuid, jsonb, jsonb)
  to authenticated;

-- Invitation claiming also bypasses table RLS, so guard it explicitly.
alter function hearthland_private.claim_invitation(text)
  rename to claim_invitation_unchecked_v1;
revoke all on function hearthland_private.claim_invitation_unchecked_v1(text)
  from public, anon, authenticated;

create function hearthland_private.claim_invitation(invitation_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;
  return hearthland_private.claim_invitation_unchecked_v1(invitation_token_hash);
end;
$$;

revoke all on function hearthland_private.claim_invitation(text)
  from public, anon;
grant execute on function hearthland_private.claim_invitation(text)
  to authenticated;

-- The coordinate RPC remains publicly callable for anonymous visitors, but a
-- request carrying an inactive Hearthland JWT is denied.
create or replace function hearthland.get_public_land_coordinates(target_land_entity_id uuid)
returns table (
  land_entity_id uuid,
  latitude numeric,
  longitude numeric
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pll.land_entity_id, pll.exact_latitude, pll.exact_longitude
  from hearthland.land_private_locations pll
  join hearthland.land_listings l on l.entity_id = pll.land_entity_id
  where pll.land_entity_id = target_land_entity_id
    and l.location_visibility = 'exact'
    and (
      (select auth.uid()) is null
      or hearthland_private.current_account_is_active()
    )
    and hearthland_private.can_view_entity(l.entity_id);
$$;

revoke all on function hearthland.get_public_land_coordinates(uuid)
  from public;
grant execute on function hearthland.get_public_land_coordinates(uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Direct application/interest INSERT parity with the application API
-- ---------------------------------------------------------------------------

drop policy if exists application_insert
  on hearthland.community_interests;
create policy application_insert
on hearthland.community_interests
for insert to authenticated
with check (
  applicant_account_id = (select auth.uid())
  and pipeline_status = 'new'
  and archived_at is null
  and hearthland_private.can_view_entity(community_entity_id)
  and exists (
    select 1
    from hearthland.entities e
    where e.id = community_entity_id
      and e.entity_type in ('community', 'emerging_community')
      and e.publication_status = 'published'
      and e.archived_at is null
  )
  and (
    exists (
      select 1
      from hearthland.communities c
      where c.entity_id = community_entity_id
        and c.lifecycle_status <> 'closed'
        and (interest_type <> 'join' or c.accepting_members)
    )
    or exists (
      select 1
      from hearthland.emerging_communities ec
      where ec.entity_id = community_entity_id
    )
  )
);

drop policy if exists application_insert
  on hearthland.opportunity_applications;
create policy application_insert
on hearthland.opportunity_applications
for insert to authenticated
with check (
  applicant_account_id = (select auth.uid())
  and status = 'submitted'
  and archived_at is null
  and hearthland_private.can_view_entity(opportunity_entity_id)
  and exists (
    select 1
    from hearthland.entities e
    join hearthland.opportunities o
      on o.entity_id = e.id
    where e.id = opportunity_entity_id
      and e.entity_type = 'opportunity'
      and e.publication_status = 'published'
      and e.archived_at is null
      and o.application_status = 'open'
  )
);

drop policy if exists application_insert
  on hearthland.camp_applications;
create policy application_insert
on hearthland.camp_applications
for insert to authenticated
with check (
  applicant_account_id = (select auth.uid())
  and status = 'new'
  and archived_at is null
  and hearthland_private.can_view_entity(camp_entity_id)
  and exists (
    select 1
    from hearthland.entities e
    join hearthland.building_camps c
      on c.entity_id = e.id
    where e.id = camp_entity_id
      and e.entity_type = 'building_camp'
      and e.publication_status = 'published'
      and e.archived_at is null
      and c.camp_status = 'applications_open'
      and (c.application_deadline is null or c.application_deadline >= current_date)
  )
);

-- ---------------------------------------------------------------------------
-- Assignee task-update column boundary
-- ---------------------------------------------------------------------------

create or replace function hearthland_private.guard_task_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
begin
  -- Trusted service/migration writes have no end-user JWT and retain the
  -- normal administrative path.
  if current_account_id is null then
    return new;
  end if;

  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;

  -- Owners and entity administrators retain the full edit authority already
  -- constrained by the task UPDATE RLS policy.
  if hearthland_private.can_manage_entity(old.entity_id) then
    return new;
  end if;

  if old.assignee_account_id is distinct from current_account_id then
    raise exception 'Only the task assignee or an entity manager may update this task'
      using errcode = '42501';
  end if;

  if row(
    new.id,
    new.entity_id,
    new.title,
    new.description,
    new.assignee_account_id,
    new.due_date,
    new.priority,
    new.linked_stage,
    new.sort_order,
    new.created_by_account_id,
    new.created_at,
    new.archived_at
  ) is distinct from row(
    old.id,
    old.entity_id,
    old.title,
    old.description,
    old.assignee_account_id,
    old.due_date,
    old.priority,
    old.linked_stage,
    old.sort_order,
    old.created_by_account_id,
    old.created_at,
    old.archived_at
  ) then
    raise exception 'Assignees may only change task status fields'
      using errcode = '42501';
  end if;

  new.updated_by_account_id := current_account_id;
  if new.status = 'completed' then
    new.completed_at := case
      when old.status = 'completed' and old.completed_at is not null
        then old.completed_at
      else now()
    end;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_hearthland_task_update
  on hearthland.tasks;
create trigger guard_hearthland_task_update
before update on hearthland.tasks
for each row execute function hearthland_private.guard_task_update();

-- ---------------------------------------------------------------------------
-- Hearthland-only Storage account-state gate
-- ---------------------------------------------------------------------------

drop policy if exists hearthland_active_authenticated_account_gate
  on storage.objects;
create policy hearthland_active_authenticated_account_gate
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id not in (
    'hearthland-avatars',
    'hearthland-entity-media',
    'hearthland-project-files'
  )
  or (select hearthland_private.current_account_is_active())
)
with check (
  bucket_id not in (
    'hearthland-avatars',
    'hearthland-entity-media',
    'hearthland-project-files'
  )
  or (select hearthland_private.current_account_is_active())
);

commit;
