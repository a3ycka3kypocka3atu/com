begin;

-- Controlled, rollback-only identities. These exercise the same database roles
-- and JWT claims used by PostgREST without leaving test accounts or data live.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 't34-owner@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"T34 Owner"}', now(), now()),
  ('00000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 't34-entity-admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"T34 Entity Admin"}', now(), now()),
  ('00000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 't34-member@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"T34 Member"}', now(), now()),
  ('00000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 't34-unrelated@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"T34 Unrelated"}', now(), now()),
  ('00000000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 't34-platform-admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"T34 Platform Admin"}', now(), now()),
  ('00000000-0000-4000-8000-000000000106', 'authenticated', 'authenticated', 't34-suspended@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"T34 Suspended"}', now(), now()),
  ('00000000-0000-4000-8000-000000000107', 'authenticated', 'authenticated', 't34-storage-unrelated@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"T34 Storage Unrelated"}', now(), now());

update hearthland.accounts
set onboarding_status = 'complete'
where id between '00000000-0000-4000-8000-000000000101'::uuid
             and '00000000-0000-4000-8000-000000000107'::uuid;

update hearthland.accounts
set account_status = 'suspended'
where id = '00000000-0000-4000-8000-000000000106';

insert into hearthland.platform_roles (
  account_id, role, granted_by_account_id
)
values (
  '00000000-0000-4000-8000-000000000105',
  'admin',
  '00000000-0000-4000-8000-000000000101'
);

insert into hearthland.entities (
  id, entity_type, slug, title, publication_status, visibility,
  owner_account_id, created_by_account_id, published_at
)
values
  (
    '00000000-0000-4000-8000-000000000201', 'community',
    't34-role-matrix-community', 'T34 Role Matrix Community',
    'published', 'public',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000101', now()
  ),
  (
    '00000000-0000-4000-8000-000000000202', 'settlement_project',
    't34-role-matrix-project', 'T34 Role Matrix Project',
    'published', 'public',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000101', now()
  ),
  (
    '00000000-0000-4000-8000-000000000203', 'building_camp',
    't34-role-matrix-camp', 'T34 Role Matrix Camp',
    'published', 'public',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000101', now()
  ),
  (
    '00000000-0000-4000-8000-000000000204', 'community',
    't34-role-matrix-second-community', 'T34 Second Community',
    'published', 'members',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000104', now()
  );

insert into hearthland.communities (
  entity_id, country, community_type, accepting_members, membership_status
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    'Czechia', 'intentional', true, 'open'
  ),
  (
    '00000000-0000-4000-8000-000000000204',
    'Czechia', 'intentional', false, 'closed'
  );

insert into hearthland.settlement_projects (
  entity_id, description, stage, target_country, target_region,
  target_population, next_milestone
)
values (
  '00000000-0000-4000-8000-000000000202',
  'Rollback-only role matrix project.', 'core_team', 'Czechia', 'Bohemia',
  20, 'Complete the controlled role matrix'
);

insert into hearthland.building_camps (
  entity_id, host_entity_id, project_entity_id, location, country, region,
  start_date, end_date, purpose, max_participants,
  application_deadline, camp_status
)
values (
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
  'Role matrix field site', 'Czechia', 'Bohemia',
  current_date + 30, current_date + 37,
  'Controlled Camp access verification', 20,
  current_date + 20, 'applications_open'
);

insert into hearthland.entity_roles (
  entity_id, account_id, role, status, granted_by_account_id
)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000102',
  'administrator', 'active',
  '00000000-0000-4000-8000-000000000101'
);

insert into hearthland.entity_memberships (
  entity_id, account_id, membership_type, status, joined_at,
  created_by_account_id
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000103',
    'member', 'active', now(),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000106',
    'member', 'active', now(),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000204',
    '00000000-0000-4000-8000-000000000103',
    'member', 'active', now(),
    '00000000-0000-4000-8000-000000000101'
  );

create temp table t34_invitation_tokens (
  purpose text primary key,
  raw_token text not null
) on commit drop;
grant select, insert on t34_invitation_tokens to authenticated;

create temp table t34_conversation_ids (
  purpose text primary key,
  conversation_id uuid not null
) on commit drop;
grant select, insert on t34_conversation_ids to authenticated;

-- Owner can manage the entity.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"t34-owner@example.invalid"}',
  true
);
set local role authenticated;
insert into hearthland.community_working_groups (
  id, community_entity_id, slug, title, coordinator_account_id,
  created_by_account_id
)
values (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000201',
  'owner-group', 'Owner Group',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000101'
);
insert into hearthland.working_group_members (
  working_group_id, account_id, member_role, created_by_account_id
)
values (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000102',
  'member', '00000000-0000-4000-8000-000000000101'
);
reset role;

-- Entity administrator can perform permitted entity management.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"t34-entity-admin@example.invalid"}',
  true
);
set local role authenticated;
insert into hearthland.community_working_groups (
  id, community_entity_id, slug, title, created_by_account_id
)
values (
  '00000000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000201',
  'administrator-group', 'Administrator Group',
  '00000000-0000-4000-8000-000000000102'
);
insert into hearthland.working_group_members (
  working_group_id, account_id, member_role, created_by_account_id
)
values (
  '00000000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000102',
  'coordinator', '00000000-0000-4000-8000-000000000102'
);

do $matrix$
begin
  begin
    perform hearthland.create_invitation(jsonb_build_object(
      'entity_id', '00000000-0000-4000-8000-000000000201',
      'invited_account_id', '00000000-0000-4000-8000-000000000104',
      'recipient_mode', 'account',
      'invitation_type', 'entity_administrator',
      'proposed_role', 'Entity administrator'
    ));
    raise exception 'ROLE_MATRIX_FAILED: entity administrator granted entity administrator';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;

reset role;

-- Member sees member data but cannot create management records.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"t34-member@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
declare
  visible_groups integer;
begin
  select count(*) into visible_groups
  from hearthland.community_working_groups
  where community_entity_id = '00000000-0000-4000-8000-000000000201';
  if visible_groups <> 2 then
    raise exception 'ROLE_MATRIX_FAILED: active member did not see member groups';
  end if;

  if exists (
    select 1 from hearthland.working_group_members
    where working_group_id = '00000000-0000-4000-8000-000000000302'
      and account_id = '00000000-0000-4000-8000-000000000102'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: member saw another group member identity';
  end if;

  begin
    update hearthland.community_working_groups
    set community_entity_id = '00000000-0000-4000-8000-000000000204'
    where id = '00000000-0000-4000-8000-000000000301';
    raise exception 'ROLE_MATRIX_FAILED: coordinator reparented a working group';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into hearthland.community_working_groups (
      community_entity_id, slug, title, created_by_account_id
    ) values (
      '00000000-0000-4000-8000-000000000201',
      'member-forbidden-group', 'Forbidden Group',
      '00000000-0000-4000-8000-000000000103'
    );
    raise exception 'ROLE_MATRIX_FAILED: member created manager record';
  exception when insufficient_privilege then
    null;
  end;

  insert into hearthland.entity_memberships (
    entity_id,
    account_id,
    membership_type,
    status,
    created_by_account_id
  ) values (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000103',
    'self_activation_probe',
    'requested',
    '00000000-0000-4000-8000-000000000103'
  );

  begin
    update hearthland.entity_memberships
    set status = 'active'
    where entity_id = '00000000-0000-4000-8000-000000000201'
      and account_id = '00000000-0000-4000-8000-000000000103'
      and membership_type = 'self_activation_probe';
    raise exception 'ROLE_MATRIX_FAILED: member bypassed self-activation guard';
  exception when others then
    if sqlerrm = 'ROLE_MATRIX_FAILED: member bypassed self-activation guard'
       or position('Members cannot activate or promote' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end
$matrix$;

insert into hearthland.project_participation_requests (
  id, project_entity_id, applicant_account_id, participation_type,
  message, status
)
values (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000103',
  'volunteer', 'I can help with the pilot.', 'new'
);

insert into hearthland.camp_applications (
  id, camp_entity_id, applicant_account_id, selected_roles, message, status
)
values (
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000103',
  array['master_teacher']::text[],
  'I can teach during the Camp.', 'new'
);
do $matrix$
begin
  begin
    update hearthland.camp_applications
    set status = 'accepted'
    where id = '00000000-0000-4000-8000-000000000402';
    raise exception 'ROLE_MATRIX_FAILED: Camp applicant accepted themselves';
  exception when others then
    if sqlerrm = 'ROLE_MATRIX_FAILED: Camp applicant accepted themselves'
       or position('Applicants may only withdraw or cancel' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  begin
    update hearthland.camp_applications
    set message = 'forged after submission'
    where id = '00000000-0000-4000-8000-000000000402';
    raise exception 'ROLE_MATRIX_FAILED: Camp applicant rewrote submitted content';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;
reset role;

-- Unrelated user receives no private member or request data.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000107","role":"authenticated","email":"t34-storage-unrelated@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  if exists (
    select 1 from hearthland.community_working_groups
    where community_entity_id = '00000000-0000-4000-8000-000000000201'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: unrelated user saw member groups';
  end if;
  if exists (
    select 1 from hearthland.project_participation_requests
    where id = '00000000-0000-4000-8000-000000000401'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: unrelated user saw participation request';
  end if;

  begin
    perform *
    from hearthland.get_camp_application_manager_details(
      '00000000-0000-4000-8000-000000000203'
    );
    raise exception 'ROLE_MATRIX_FAILED: unrelated user read Camp applicant identity';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;

reset role;

-- Suspended identities are blocked by the restrictive active-account gate.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000106","role":"authenticated","email":"t34-suspended@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  if exists (
    select 1 from hearthland.community_working_groups
    where community_entity_id = '00000000-0000-4000-8000-000000000201'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: suspended member read gated data';
  end if;

  begin
    insert into hearthland.project_participation_requests (
      project_entity_id, applicant_account_id, participation_type, status
    ) values (
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000106',
      'supporter', 'new'
    );
    raise exception 'ROLE_MATRIX_FAILED: suspended user created participation request';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;

reset role;

-- Owner accepts the persisted request; the accepted relationship is created.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"t34-owner@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  begin
    update hearthland.building_camps
    set host_entity_id = '00000000-0000-4000-8000-000000000204'
    where entity_id = '00000000-0000-4000-8000-000000000203';
    raise exception 'ROLE_MATRIX_FAILED: Camp owner reattributed a published Camp';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;
update hearthland.project_participation_requests
set status = 'accepted'
where id = '00000000-0000-4000-8000-000000000401';
do $matrix$
begin
  begin
    update hearthland.project_participation_requests
    set status = 'declined'
    where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'ROLE_MATRIX_FAILED: accepted request was reversed';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;

do $matrix$
begin
  if not exists (
    select 1
    from hearthland.get_camp_application_manager_details(
      '00000000-0000-4000-8000-000000000203'
    ) details
    where details.application_id = '00000000-0000-4000-8000-000000000402'
      and details.applicant_account_id = '00000000-0000-4000-8000-000000000103'
      and details.display_name = 'T34 Member'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: Camp manager could not read applicant summary';
  end if;
end
$matrix$;

update hearthland.camp_applications
set status = 'accepted'
where id = '00000000-0000-4000-8000-000000000402';

do $matrix$
begin
  begin
    update hearthland.camp_applications
    set status = 'waiting_list'
    where id = '00000000-0000-4000-8000-000000000402';
    raise exception 'ROLE_MATRIX_FAILED: accepted Camp application was reversed';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;

do $matrix$
begin
  begin
    update hearthland.camp_participants
    set account_id = '00000000-0000-4000-8000-000000000107'
    where camp_entity_id = '00000000-0000-4000-8000-000000000203'
      and account_id = '00000000-0000-4000-8000-000000000103';
    raise exception 'ROLE_MATRIX_FAILED: manager rewrote Camp participant identity';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from hearthland.camp_participants
    where camp_entity_id = '00000000-0000-4000-8000-000000000203'
      and account_id = '00000000-0000-4000-8000-000000000103';
    raise exception 'ROLE_MATRIX_FAILED: manager deleted active Camp participant';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;
reset role;

do $matrix$
begin
  if not exists (
    select 1
    from hearthland.entity_memberships
    where entity_id = '00000000-0000-4000-8000-000000000202'
      and account_id = '00000000-0000-4000-8000-000000000103'
      and membership_type = 'volunteer'
      and status = 'active'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: accepted participation did not create membership';
  end if;
  if not exists (
    select 1 from hearthland.camp_participants
    where camp_entity_id = '00000000-0000-4000-8000-000000000203'
      and account_id = '00000000-0000-4000-8000-000000000103'
      and participant_status = 'accepted'
      and 'master_teacher' = any(roles)
  ) then
    raise exception 'ROLE_MATRIX_FAILED: accepted Camp application did not create participant';
  end if;
  if not exists (
    select 1 from hearthland.camp_team
    where camp_entity_id = '00000000-0000-4000-8000-000000000203'
      and account_id = '00000000-0000-4000-8000-000000000103'
      and role = 'master_teacher'
      and is_master
  ) then
    raise exception 'ROLE_MATRIX_FAILED: accepted Master application did not create Camp team role';
  end if;
end
$matrix$;

-- Invitation authority is server-derived and bounded.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"t34-owner@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  begin
    perform hearthland.create_invitation(jsonb_build_object(
      'entity_id', '00000000-0000-4000-8000-000000000201',
      'invited_account_id', '00000000-0000-4000-8000-000000000104',
      'recipient_mode', 'account',
      'invitation_type', 'community_member',
      'proposed_role', 'Member',
      'membership_role', 'owner'
    ));
    raise exception 'ROLE_MATRIX_FAILED: browser supplied permission role';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform hearthland.create_invitation(jsonb_build_object(
      'entity_id', '00000000-0000-4000-8000-000000000201',
      'invited_account_id', '00000000-0000-4000-8000-000000000101',
      'recipient_mode', 'account',
      'invitation_type', 'community_member',
      'proposed_role', 'Member'
    ));
    raise exception 'ROLE_MATRIX_FAILED: self invitation was accepted';
  exception when others then
    if sqlerrm = 'ROLE_MATRIX_FAILED: self invitation was accepted' then
      raise;
    end if;
  end;
end
$matrix$;

insert into t34_invitation_tokens (purpose, raw_token)
select
  'owner_grants_entity_admin',
  result ->> 'raw_token'
from (
  select hearthland.create_invitation(jsonb_build_object(
    'entity_id', '00000000-0000-4000-8000-000000000201',
    'invited_account_id', '00000000-0000-4000-8000-000000000104',
    'recipient_mode', 'account',
    'invitation_type', 'entity_administrator',
    'proposed_role', 'Entity administrator'
  )) as result
) invitation;

insert into t34_invitation_tokens (purpose, raw_token)
select
  'shareable_member',
  result ->> 'raw_token'
from (
  select hearthland.create_invitation(jsonb_build_object(
    'entity_id', '00000000-0000-4000-8000-000000000201',
    'recipient_mode', 'link',
    'invitation_type', 'community_member',
    'proposed_role', 'Shareable member'
  )) as result
) invitation;

insert into t34_invitation_tokens (purpose, raw_token)
select
  'account_camp_master',
  result ->> 'raw_token'
from (
  select hearthland.create_invitation(jsonb_build_object(
    'entity_id', '00000000-0000-4000-8000-000000000203',
    'invited_account_id', '00000000-0000-4000-8000-000000000102',
    'recipient_mode', 'account',
    'invitation_type', 'camp_master',
    'proposed_role', 'Camp Master'
  )) as result
) invitation;

insert into t34_invitation_tokens (purpose, raw_token)
select
  'external_email',
  result ->> 'raw_token'
from (
  select hearthland.create_invitation(jsonb_build_object(
    'entity_id', '00000000-0000-4000-8000-000000000201',
    'invited_email', 't34-member@example.invalid',
    'recipient_mode', 'email',
    'invitation_type', 'specialist',
    'proposed_role', 'External specialist'
  )) as result
) invitation;

insert into t34_invitation_tokens (purpose, raw_token)
select
  'expired_link',
  result ->> 'raw_token'
from (
  select hearthland.create_invitation(jsonb_build_object(
    'entity_id', '00000000-0000-4000-8000-000000000201',
    'recipient_mode', 'link',
    'invitation_type', 'supporter',
    'proposed_role', 'Expired supporter'
  )) as result
) invitation;

do $matrix$
declare
  created jsonb;
begin
  created := hearthland.create_invitation(jsonb_build_object(
    'entity_id', '00000000-0000-4000-8000-000000000201',
    'recipient_mode', 'link',
    'invitation_type', 'volunteer',
    'proposed_role', 'Revoked volunteer'
  ));
  insert into t34_invitation_tokens (purpose, raw_token)
  values ('revoked_link', created ->> 'raw_token');
  perform hearthland.revoke_invitation(
    (created ->> 'invitation_id')::uuid
  );
end
$matrix$;
reset role;

-- Simulate time passing without retaining any test data after rollback.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update hearthland.invitations i
set expires_at = now() - interval '1 minute'
from t34_invitation_tokens token
where token.purpose = 'expired_link'
  and i.token_hash = encode(
    extensions.digest(convert_to(token.raw_token, 'UTF8'), 'sha256'),
    'hex'
  );

-- A shareable bearer invitation cannot message before it is claimed. After
-- acceptance, messaging works and conversation membership cannot be rewritten.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"t34-member@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
declare
  preview jsonb;
  token_value text;
  external_token text;
  expired_token text;
  revoked_token text;
  replay jsonb;
begin
  select raw_token into token_value
  from t34_invitation_tokens where purpose = 'shareable_member';
  preview := hearthland.get_invitation_preview(token_value);
  if preview is null or not (preview ? 'can_message') then
    raise exception 'ROLE_MATRIX_FAILED: invitation preview omitted messaging authority';
  end if;
  if (preview ->> 'can_message')::boolean then
    raise exception 'ROLE_MATRIX_FAILED: unclaimed link allowed invitation messaging';
  end if;
  begin
    perform hearthland.start_context_conversation(
      'invitation', token_value, 'Can we discuss this invitation?'
    );
    raise exception 'ROLE_MATRIX_FAILED: unclaimed link started a conversation';
  exception when insufficient_privilege then
    null;
  end;

  perform hearthland.respond_to_invitation(token_value, 'accepted');
  replay := hearthland.respond_to_invitation(token_value, 'accepted');
  if coalesce((replay ->> 'idempotent_replay')::boolean, false) is not true then
    raise exception 'ROLE_MATRIX_FAILED: duplicate invitation acceptance was not idempotent';
  end if;

  select raw_token into external_token
  from t34_invitation_tokens where purpose = 'external_email';
  replay := hearthland.respond_to_invitation(external_token, 'accepted');
  if replay ->> 'status' <> 'accepted' then
    raise exception 'ROLE_MATRIX_FAILED: matching external email invitation failed';
  end if;
  if not exists (
    select 1 from hearthland.invitations i
    where i.invited_account_id = '00000000-0000-4000-8000-000000000103'
      and i.proposed_role = 'External specialist'
      and length(i.token_hash) = 64
      and i.token_hash <> external_token
  ) then
    raise exception 'ROLE_MATRIX_FAILED: invitation did not retain hash-only token storage';
  end if;

  select raw_token into expired_token
  from t34_invitation_tokens where purpose = 'expired_link';
  begin
    perform hearthland.respond_to_invitation(expired_token, 'accepted');
    raise exception 'ROLE_MATRIX_FAILED: expired invitation was accepted';
  exception when others then
    if sqlerrm = 'ROLE_MATRIX_FAILED: expired invitation was accepted'
       or position('INVITATION_EXPIRED' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  select raw_token into revoked_token
  from t34_invitation_tokens where purpose = 'revoked_link';
  begin
    perform hearthland.respond_to_invitation(revoked_token, 'accepted');
    raise exception 'ROLE_MATRIX_FAILED: revoked invitation was accepted';
  exception when others then
    if sqlerrm = 'ROLE_MATRIX_FAILED: revoked invitation was accepted'
       or position('INVITATION_REVOKED' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end
$matrix$;

insert into t34_conversation_ids (purpose, conversation_id)
select 'shareable_invitation',
       (hearthland.start_context_conversation(
         'invitation', raw_token, 'Thank you. I accepted the invitation.'
       ) ->> 'conversation_id')::uuid
from t34_invitation_tokens
where purpose = 'shareable_member';

do $matrix$
declare
  target_conversation_id uuid;
begin
  select conversation_id into target_conversation_id
  from t34_conversation_ids where purpose = 'shareable_invitation';
  begin
    update hearthland.conversation_members
    set account_id = '00000000-0000-4000-8000-000000000107'
    where conversation_id = target_conversation_id
      and account_id = '00000000-0000-4000-8000-000000000101';
    raise exception 'ROLE_MATRIX_FAILED: conversation creator replaced counterpart';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update hearthland.conversations
    set archived_at = now(),
        subject = 'forged subject',
        last_message_at = now() + interval '1 year'
    where id = target_conversation_id;
    raise exception 'ROLE_MATRIX_FAILED: conversation member rewrote shared thread state';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;
reset role;

-- Account-bound invitations can be accepted and messaged from the received
-- inbox using the invitation UUID; no raw token needs to be persisted there.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"t34-entity-admin@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
declare
  account_invitation_id uuid;
  response jsonb;
  conversation jsonb;
begin
  select i.id into account_invitation_id
  from hearthland.invitations i
  where i.entity_id = '00000000-0000-4000-8000-000000000203'
    and i.invited_account_id = '00000000-0000-4000-8000-000000000102'
    and i.invitation_type = 'camp_master';
  if account_invitation_id is null then
    raise exception 'ROLE_MATRIX_FAILED: account invitation missing from received inbox';
  end if;
  response := hearthland.respond_to_invitation(
    account_invitation_id::text, 'accepted'
  );
  if response ->> 'status' <> 'accepted' then
    raise exception 'ROLE_MATRIX_FAILED: account invitation UUID was not accepted';
  end if;
  conversation := hearthland.start_context_conversation(
    'invitation', account_invitation_id::text,
    'I accepted the Camp Master invitation.'
  );
  if nullif(conversation ->> 'conversation_id', '') is null then
    raise exception 'ROLE_MATRIX_FAILED: account invitation message was not created';
  end if;
end
$matrix$;
reset role;

do $matrix$
begin
  if not exists (
    select 1 from hearthland.camp_team
    where camp_entity_id = '00000000-0000-4000-8000-000000000203'
      and account_id = '00000000-0000-4000-8000-000000000102'
      and is_master
  ) or not exists (
    select 1 from hearthland.camp_participants
    where camp_entity_id = '00000000-0000-4000-8000-000000000203'
      and account_id = '00000000-0000-4000-8000-000000000102'
      and participant_status = 'accepted'
      and 'master_teacher' = any(roles)
  ) then
    raise exception 'ROLE_MATRIX_FAILED: invited Camp Master lacks operational access';
  end if;
end
$matrix$;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated","email":"t34-unrelated@example.invalid"}',
  true
);
set local role authenticated;
select hearthland.respond_to_invitation(raw_token, 'accepted')
from t34_invitation_tokens
where purpose = 'owner_grants_entity_admin';
reset role;

do $matrix$
begin
  if not exists (
    select 1 from hearthland.entity_roles
    where entity_id = '00000000-0000-4000-8000-000000000201'
      and account_id = '00000000-0000-4000-8000-000000000104'
      and role = 'administrator'
      and status = 'active'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: authorised entity administrator grant missing';
  end if;
  if exists (
    select 1 from hearthland.entity_roles
    where entity_id = '00000000-0000-4000-8000-000000000201'
      and account_id = '00000000-0000-4000-8000-000000000104'
      and role = 'owner'
  ) or exists (
    select 1 from hearthland.platform_roles
    where account_id = '00000000-0000-4000-8000-000000000104'
      and revoked_at is null
  ) then
    raise exception 'ROLE_MATRIX_FAILED: invitation escalated beyond entity administrator';
  end if;
end
$matrix$;

-- A newly granted entity administrator still cannot grant administrators.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated","email":"t34-unrelated@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  begin
    perform hearthland.create_invitation(jsonb_build_object(
      'entity_id', '00000000-0000-4000-8000-000000000201',
      'invited_account_id', '00000000-0000-4000-8000-000000000103',
      'recipient_mode', 'account',
      'invitation_type', 'entity_administrator',
      'proposed_role', 'Entity administrator'
    ));
    raise exception 'ROLE_MATRIX_FAILED: delegated administrator re-granted privilege';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;
reset role;

-- Platform admin retains the intended privileged control path.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000105","role":"authenticated","email":"t34-platform-admin@example.invalid"}',
  true
);
set local role authenticated;
insert into t34_invitation_tokens (purpose, raw_token)
select
  'platform_admin_grant',
  result ->> 'raw_token'
from (
  select hearthland.create_invitation(jsonb_build_object(
    'entity_id', '00000000-0000-4000-8000-000000000201',
    'invited_account_id', '00000000-0000-4000-8000-000000000103',
    'recipient_mode', 'account',
    'invitation_type', 'entity_administrator',
    'proposed_role', 'Entity administrator'
  )) as result
) invitation;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"t34-member@example.invalid"}',
  true
);
set local role authenticated;
select hearthland.respond_to_invitation(raw_token, 'accepted')
from t34_invitation_tokens
where purpose = 'platform_admin_grant';
reset role;

do $matrix$
begin
  if not exists (
    select 1 from hearthland.entity_roles
    where entity_id = '00000000-0000-4000-8000-000000000201'
      and account_id = '00000000-0000-4000-8000-000000000103'
      and role = 'administrator'
      and status = 'active'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: platform admin grant path did not provision role';
  end if;
end
$matrix$;

-- Prepare a real public Master record with private details.
update hearthland.entities
set publication_status = 'published', visibility = 'public', published_at = now()
where id = (
  select entity_id from hearthland.person_profiles
  where account_id = '00000000-0000-4000-8000-000000000103'
);
update hearthland.person_profiles
set discoverable = true
where account_id = '00000000-0000-4000-8000-000000000103';

insert into hearthland.teaching_profiles (
  profile_entity_id, is_available, teaching_bio, teaching_formats,
  travel_regions, languages, availability, compensation_preference,
  portfolio_links, teaching_mode, travel_scope, selected_countries,
  professional_arrangements, arrangement_notes
)
select
  entity_id, true, 'Public teaching introduction', array['Practical workshops'],
  array['Bohemia'], array['English'], 'Private calendar detail', 'Private rate',
  '[]'::jsonb, 'practical', 'local', '{}'::text[],
  array['discuss'], 'Private organiser note'
from hearthland.person_profiles
where account_id = '00000000-0000-4000-8000-000000000103';

insert into hearthland.skills (
  id, category, name, slug, is_active
)
values (
  '00000000-0000-4000-8000-000000000501',
  'Building', 'T34 Timber Framing', 't34-timber-framing', true
);

insert into hearthland.person_skills (
  id, profile_entity_id, skill_id, experience_level, can_teach,
  practical_workshops, theoretical_sessions, willing_to_contribute
)
select
  '00000000-0000-4000-8000-000000000502', entity_id,
  '00000000-0000-4000-8000-000000000501', 'expert', true,
  true, false, true
from hearthland.person_profiles
where account_id = '00000000-0000-4000-8000-000000000103';

-- Anonymous callers get only the sanitized available-Master projections.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $matrix$
declare
  teacher_profile_id uuid;
begin
  select entity_id into teacher_profile_id
  from hearthland.person_profiles
  where account_id = '00000000-0000-4000-8000-000000000103';

  if not exists (
    select 1 from hearthland.get_public_teaching_profiles()
    where profile_entity_id = teacher_profile_id
      and teaching_bio = 'Public teaching introduction'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: public Master projection missing';
  end if;
  if exists (
    select 1 from hearthland.teaching_profiles
    where profile_entity_id = teacher_profile_id
  ) then
    raise exception 'ROLE_MATRIX_FAILED: anonymous caller read private teaching row';
  end if;
end
$matrix$;
reset role;

-- An entity administrator is not automatically a manager of private profile data.
insert into hearthland.entity_roles (
  entity_id, account_id, role, status, granted_by_account_id
)
select
  pp.entity_id,
  '00000000-0000-4000-8000-000000000104',
  'administrator', 'active',
  '00000000-0000-4000-8000-000000000101'
from hearthland.person_profiles pp
where pp.account_id = '00000000-0000-4000-8000-000000000103';

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated","email":"t34-unrelated@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  if exists (
    select 1 from hearthland.teaching_profiles tp
    join hearthland.person_profiles pp on pp.entity_id = tp.profile_entity_id
    where pp.account_id = '00000000-0000-4000-8000-000000000103'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: entity manager read private Master data';
  end if;
end
$matrix$;
reset role;

-- Profile owner sees their private teaching row.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"t34-member@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  if not exists (
    select 1 from hearthland.teaching_profiles tp
    join hearthland.person_profiles pp on pp.entity_id = tp.profile_entity_id
    where pp.account_id = '00000000-0000-4000-8000-000000000103'
      and tp.arrangement_notes = 'Private organiser note'
      and tp.availability = 'Private calendar detail'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: profile owner could not read private Master data';
  end if;
end
$matrix$;
reset role;

-- Platform administrator can audit the protected record.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000105","role":"authenticated","email":"t34-platform-admin@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  if not exists (
    select 1 from hearthland.teaching_profiles tp
    join hearthland.person_profiles pp on pp.entity_id = tp.profile_entity_id
    where pp.account_id = '00000000-0000-4000-8000-000000000103'
      and tp.arrangement_notes = 'Private organiser note'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: platform admin could not audit Master data';
  end if;
end
$matrix$;
reset role;

-- Unavailable teachers disappear publicly and teaching flags are masked.
update hearthland.teaching_profiles
set is_available = false
where profile_entity_id = (
  select entity_id from hearthland.person_profiles
  where account_id = '00000000-0000-4000-8000-000000000103'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $matrix$
declare
  teacher_profile_id uuid;
begin
  select entity_id into teacher_profile_id
  from hearthland.person_profiles
  where account_id = '00000000-0000-4000-8000-000000000103';
  if exists (
    select 1 from hearthland.get_public_teaching_profiles()
    where profile_entity_id = teacher_profile_id
  ) then
    raise exception 'ROLE_MATRIX_FAILED: unavailable Master remained public';
  end if;
  if exists (
    select 1 from hearthland.get_public_person_skills()
    where profile_entity_id = teacher_profile_id
      and (can_teach or practical_workshops or theoretical_sessions)
  ) then
    raise exception 'ROLE_MATRIX_FAILED: unavailable teaching flags leaked';
  end if;
end
$matrix$;
reset role;

-- Storage RLS: authorised upload/replacement/deletion and public/private reads.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"t34-member@example.invalid"}',
  true
);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  'hearthland-avatars',
  'users/00000000-0000-4000-8000-000000000103/avatar.webp',
  '00000000-0000-4000-8000-000000000103',
  '{"mimetype":"image/webp","size":1024}'::jsonb
);
update storage.objects
set metadata = '{"mimetype":"image/webp","size":2048}'::jsonb
where bucket_id = 'hearthland-avatars'
  and name = 'users/00000000-0000-4000-8000-000000000103/avatar.webp';
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"t34-owner@example.invalid"}',
  true
);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  (
    'hearthland-entity-media',
    'entities/00000000-0000-4000-8000-000000000201/cover.webp',
    '00000000-0000-4000-8000-000000000101',
    '{"mimetype":"image/webp","size":2048}'::jsonb
  ),
  (
    'hearthland-project-files',
    'projects/00000000-0000-4000-8000-000000000202/plan.pdf',
    '00000000-0000-4000-8000-000000000101',
    '{"mimetype":"application/pdf","size":4096}'::jsonb
  );
insert into hearthland.media_assets (
  id, entity_id, uploader_account_id, bucket_id, object_path,
  media_kind, category, alt_text, mime_type, size_bytes, visibility
)
values (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'hearthland-entity-media',
  'entities/00000000-0000-4000-8000-000000000201/cover.webp',
  'image', 'role_matrix', 'T3.4 public entity media',
  'image/webp', 2048, 'public'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $matrix$
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'hearthland-avatars'
      and name = 'users/00000000-0000-4000-8000-000000000103/avatar.webp'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: public avatar was not readable';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'hearthland-entity-media'
      and name = 'entities/00000000-0000-4000-8000-000000000201/cover.webp'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: public entity media was not readable';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'hearthland-project-files'
      and name = 'projects/00000000-0000-4000-8000-000000000202/plan.pdf'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: protected project file leaked anonymously';
  end if;
end
$matrix$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"t34-member@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'hearthland-project-files'
      and name = 'projects/00000000-0000-4000-8000-000000000202/plan.pdf'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: active project participant could not read project file';
  end if;
  begin
    update storage.objects
    set metadata = '{"mimetype":"application/pdf","size":8192}'::jsonb
    where bucket_id = 'hearthland-project-files'
      and name = 'projects/00000000-0000-4000-8000-000000000202/plan.pdf';
    if found then
      raise exception 'ROLE_MATRIX_FAILED: non-manager replaced project file';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'hearthland-avatars'
  and name = 'users/00000000-0000-4000-8000-000000000103/avatar.webp';
reset role;

-- A separate active unrelated account cannot read or mutate protected files.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000107","role":"authenticated","email":"t34-storage-unrelated@example.invalid"}',
  true
);
set local role authenticated;
do $matrix$
begin
  if exists (
    select 1 from storage.objects
    where bucket_id = 'hearthland-project-files'
      and name = 'projects/00000000-0000-4000-8000-000000000202/plan.pdf'
  ) then
    raise exception 'ROLE_MATRIX_FAILED: unrelated user read protected project file';
  end if;
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'hearthland-entity-media',
      'entities/00000000-0000-4000-8000-000000000201/unauthorised.webp',
      '00000000-0000-4000-8000-000000000107',
      '{"mimetype":"image/webp","size":1024}'::jsonb
    );
    raise exception 'ROLE_MATRIX_FAILED: unrelated user uploaded entity media';
  exception when insufficient_privilege then
    null;
  end;
end
$matrix$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"t34-owner@example.invalid"}',
  true
);
set local role authenticated;
update storage.objects
set metadata = '{"mimetype":"application/pdf","size":8192}'::jsonb
where bucket_id = 'hearthland-project-files'
  and name = 'projects/00000000-0000-4000-8000-000000000202/plan.pdf';
delete from storage.objects
where (
  bucket_id = 'hearthland-entity-media'
  and name = 'entities/00000000-0000-4000-8000-000000000201/cover.webp'
) or (
  bucket_id = 'hearthland-project-files'
  and name = 'projects/00000000-0000-4000-8000-000000000202/plan.pdf'
);
reset role;

do $matrix$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'hearthland-avatars'
      and not public
      and file_size_limit = 5242880
      and allowed_mime_types @> array['image/webp']::text[]
  ) or not exists (
    select 1 from storage.buckets
    where id = 'hearthland-entity-media'
      and not public
      and file_size_limit = 15728640
  ) or not exists (
    select 1 from storage.buckets
    where id = 'hearthland-project-files'
      and not public
      and file_size_limit = 26214400
      and allowed_mime_types @> array['application/pdf']::text[]
  ) then
    raise exception 'ROLE_MATRIX_FAILED: Hearthland Storage bucket limits changed';
  end if;
end
$matrix$;

rollback;

select 'T3.4 controlled role matrix passed' as result;
