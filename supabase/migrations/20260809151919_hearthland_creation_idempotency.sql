-- Use the creation draft UUID as the idempotency key for the community wizard.
--
-- The legacy one-argument function remains as the internal implementation so
-- this migration does not duplicate the sizeable entity-mapping routine. It is
-- no longer callable by application roles. The public application entrypoint
-- locks the caller-owned draft and completes it in the same transaction as the
-- entity inserts performed by the legacy function.

begin;

revoke all on function hearthland.create_emerging_community_project(jsonb)
  from public, anon, authenticated;

create or replace function hearthland.create_emerging_community_project(
  draft_id uuid,
  draft_payload jsonb,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  persisted_draft_payload jsonb := draft_payload;
  request_payload jsonb := payload;
  draft_row hearthland.creation_drafts%rowtype;
  created jsonb;
  project_entity_id uuid;
  project_slug text;
  community_entity_id uuid;
  community_slug text;
  publication_status text;
  completed_time timestamptz := now();
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- This row lock serializes simultaneous completion requests for the same
  -- draft. Filtering by account_id keeps draft existence private.
  select d.*
  into draft_row
  from hearthland.creation_drafts d
  where d.id = draft_id
    and d.account_id = owner_id
    and d.draft_type = 'start_community_wizard'
  for update;

  if not found then
    raise exception 'Community creation draft is unavailable' using errcode = 'P0002';
  end if;

  -- A retry after a committed request (including a response lost in transit)
  -- returns the original pair instead of creating another pair.
  if draft_row.completed_at is not null then
    if draft_row.entity_id is null then
      raise exception 'Completed community creation draft has no project';
    end if;

    select
      project_entity.id,
      project_entity.slug,
      community_entity.id,
      community_entity.slug,
      project_entity.publication_status
    into
      project_entity_id,
      project_slug,
      community_entity_id,
      community_slug,
      publication_status
    from hearthland.settlement_projects project
    join hearthland.entities project_entity
      on project_entity.id = project.entity_id
    join hearthland.entities community_entity
      on community_entity.id = project.emerging_community_entity_id
    where project.entity_id = draft_row.entity_id
      and project_entity.owner_account_id = owner_id
      and community_entity.owner_account_id = owner_id;

    if not found then
      raise exception 'Completed community creation draft references an unavailable project';
    end if;

    return jsonb_build_object(
      'draft_id', draft_id,
      'emerging_community_entity_id', community_entity_id,
      'emerging_community_slug', community_slug,
      'settlement_project_entity_id', project_entity_id,
      'settlement_project_slug', project_slug,
      'publication_status', publication_status,
      'idempotent_replay', true
    );
  end if;

  if draft_row.archived_at is not null then
    raise exception 'Archived community creation draft cannot be completed';
  end if;
  if draft_row.entity_id is not null then
    raise exception 'Incomplete community creation draft already references a project';
  end if;
  if persisted_draft_payload is null or jsonb_typeof(persisted_draft_payload) <> 'object' then
    raise exception 'draft_payload must be a JSON object';
  end if;
  if request_payload is null or jsonb_typeof(request_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  -- PostgreSQL functions run within their caller's transaction. Any exception
  -- in entity creation or draft completion rolls the complete operation back.
  created := hearthland.create_emerging_community_project(request_payload);
  project_entity_id := nullif(created ->> 'settlement_project_entity_id', '')::uuid;

  if project_entity_id is null then
    raise exception 'Community creation returned no settlement project';
  end if;

  update hearthland.creation_drafts d
  set
    entity_id = project_entity_id,
    current_step = greatest(d.current_step, 6),
    payload = persisted_draft_payload,
    completed_at = completed_time,
    updated_at = completed_time
  where d.id = draft_id;

  return created || jsonb_build_object(
    'draft_id', draft_id,
    'idempotent_replay', false
  );
end;
$$;

comment on function hearthland.create_emerging_community_project(uuid, jsonb, jsonb) is
  'Idempotently completes a caller-owned creation draft and returns its emerging community and settlement project.';

revoke all on function hearthland.create_emerging_community_project(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function hearthland.create_emerging_community_project(uuid, jsonb, jsonb)
  to authenticated;

commit;
