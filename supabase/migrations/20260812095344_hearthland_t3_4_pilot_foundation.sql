-- Hearthland T3.4 first-users, pilot-project, and operational-community
-- PostgreSQL foundation.
--
-- This is an additive migration over the verified T3.3 Supabase model. It
-- intentionally leaves every pre-existing COM object in `public` untouched,
-- preserves all Hearthland records, and reuses the existing entity, profile,
-- membership, camp, project, needs/offers, messaging, notification, and audit
-- systems rather than creating parallel sources of truth.

begin;

-- Supabase projects install pgcrypto in `extensions`. Invitation entrypoints
-- below use it only for 256-bit random tokens and SHA-256 token digests.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Secure invitation lifecycle
-- ---------------------------------------------------------------------------

alter table hearthland.invitations
  add column invited_name text,
  add column recipient_mode text not null default 'link',
  add column membership_role text not null default 'member',
  add column role_title text,
  add column viewed_at timestamptz;

alter table hearthland.invitations
  drop constraint if exists invitations_status_check,
  drop constraint if exists invitations_invitation_type_check,
  drop constraint if exists invitation_recipient_check;

alter table hearthland.invitations
  add constraint invitations_status_check check (
    status in ('pending', 'viewed', 'accepted', 'declined', 'expired', 'revoked')
  ),
  add constraint invitations_invitation_type_check check (
    invitation_type in (
      'team', 'community_member', 'camp_team', 'camp_master', 'partner',
      'core_team', 'future_resident', 'master_teacher', 'specialist',
      'builder', 'volunteer', 'organiser', 'supporter',
      'entity_administrator'
    )
  ),
  add constraint invitations_recipient_mode_check check (
    (
      recipient_mode = 'account'
      and invited_account_id is not null
      and invited_email is null
    )
    or (
      recipient_mode = 'email'
      and nullif(btrim(invited_email), '') is not null
    )
    or (
      recipient_mode = 'link'
      and invited_email is null
    )
  ),
  add constraint invitations_invited_name_length_check check (
    invited_name is null or length(btrim(invited_name)) between 1 and 160
  ),
  add constraint invitations_role_title_length_check check (
    role_title is null or length(btrim(role_title)) between 1 and 160
  ),
  add constraint invitations_proposed_role_length_check check (
    length(btrim(proposed_role)) between 2 and 160
  ),
  add constraint invitations_membership_role_check check (
    membership_role in (
      'administrator', 'member', 'participant', 'core_team',
      'future_resident', 'master', 'teacher', 'master_teacher',
      'specialist', 'builder', 'volunteer', 'organiser',
      'supporter', 'partner'
    )
  );

drop index if exists hearthland.invitations_pending_account_unique;
create unique index invitations_pending_account_unique
  on hearthland.invitations (entity_id, invited_account_id, proposed_role)
  where status in ('pending', 'viewed') and invited_account_id is not null;

drop index if exists hearthland.invitations_pending_email_unique;
create unique index invitations_pending_email_unique
  on hearthland.invitations (entity_id, lower(invited_email), proposed_role)
  where status in ('pending', 'viewed') and invited_email is not null;

create index invitations_active_expiry_idx
  on hearthland.invitations (expires_at, entity_id)
  where status in ('pending', 'viewed');

-- Context conversations reuse the T3.3 messaging model. The pair key remains
-- deterministic for every two-person context, while the context tuple keeps
-- separate applications, participation requests, invitations, and projects
-- from collapsing into one thread.
alter table hearthland.conversations
  drop constraint if exists conversations_conversation_kind_check;
alter table hearthland.conversations
  add constraint conversations_conversation_kind_check check (
    conversation_kind in (
      'direct', 'community_interest', 'opportunity_application',
      'camp_application', 'need_response', 'invitation', 'land_enquiry',
      'project_participation', 'project_contact'
    )
  );

create unique index conversations_active_context_pair_unique
  on hearthland.conversations (
    conversation_kind,
    context_record_type,
    context_record_id,
    direct_pair_key
  )
  where conversation_kind <> 'direct'
    and context_record_id is not null
    and direct_pair_key is not null
    and archived_at is null;

comment on column hearthland.invitations.recipient_mode is
  'Account invite, email-bound external invite, or bearer-capability link invite.';
comment on column hearthland.invitations.token_hash is
  'Lowercase hexadecimal SHA-256 digest. Raw invitation tokens are returned once and never stored.';

-- ---------------------------------------------------------------------------
-- Master / Teacher capability and learning links
-- ---------------------------------------------------------------------------

alter table hearthland.teaching_profiles
  add column teaching_mode text not null default 'both'
    check (teaching_mode in ('practical', 'theoretical', 'both')),
  add column travel_scope text not null default 'local'
    check (travel_scope in ('local', 'selected_countries', 'europe', 'international', 'online')),
  add column selected_countries text[] not null default '{}'::text[],
  add column professional_arrangements text[] not null default '{}'::text[],
  add column arrangement_notes text not null default '';

alter table hearthland.teaching_profiles
  add constraint teaching_profiles_selected_countries_check check (
    travel_scope <> 'selected_countries' or cardinality(selected_countries) > 0
  ),
  add constraint teaching_profiles_professional_arrangements_check check (
    professional_arrangements <@ array[
      'volunteer', 'expenses', 'paid', 'donation_based', 'discuss'
    ]::text[]
  );

create index teaching_profiles_master_directory_idx
  on hearthland.teaching_profiles (is_available, teaching_mode, travel_scope)
  where is_available;
create index teaching_profiles_selected_countries_gin_idx
  on hearthland.teaching_profiles using gin (selected_countries)
  where is_available;
create index teaching_profiles_languages_gin_idx
  on hearthland.teaching_profiles using gin (languages)
  where is_available;

create table hearthland.profile_teaching_topics (
  profile_entity_id uuid not null
    references hearthland.person_profiles(entity_id) on delete cascade,
  learning_topic_entity_id uuid not null
    references hearthland.learning_topics(entity_id) on delete cascade,
  teaching_type text not null default 'both'
    check (teaching_type in ('practical', 'theoretical', 'both')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_entity_id, learning_topic_entity_id)
);

create index profile_teaching_topics_discovery_idx
  on hearthland.profile_teaching_topics (
    learning_topic_entity_id, teaching_type, profile_entity_id
  );

create table hearthland.learning_topic_interests (
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  learning_topic_entity_id uuid not null
    references hearthland.learning_topics(entity_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, learning_topic_entity_id)
);

create index learning_topic_interests_topic_idx
  on hearthland.learning_topic_interests (learning_topic_entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Admin-designated pilot projects
-- ---------------------------------------------------------------------------

create table hearthland.pilot_projects (
  project_entity_id uuid primary key
    references hearthland.settlement_projects(entity_id) on delete cascade,
  pilot_status text not null default 'nominated'
    check (pilot_status in ('nominated', 'active', 'paused', 'completed')),
  cohort text,
  public_summary text not null default '',
  designated_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  designated_at timestamptz not null default now(),
  launched_at timestamptz,
  completed_at timestamptz,
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pilot_projects_lifecycle_check check (
    (pilot_status <> 'active' or launched_at is not null)
    and (pilot_status <> 'completed' or completed_at is not null)
  )
);

create index pilot_projects_directory_idx
  on hearthland.pilot_projects (pilot_status, designated_at desc);
create index pilot_projects_designated_by_idx
  on hearthland.pilot_projects (designated_by_account_id);

-- ---------------------------------------------------------------------------
-- Operational Building Camps
-- ---------------------------------------------------------------------------

alter table hearthland.camp_build_items
  add column progress_percent smallint not null default 0
    check (progress_percent between 0 and 100),
  add column progress_note text not null default '',
  add column progress_updated_by_account_id uuid
    references hearthland.accounts(id) on delete set null,
  add column progress_updated_at timestamptz;

create index camp_build_items_progress_updated_by_idx
  on hearthland.camp_build_items (progress_updated_by_account_id);

alter table hearthland.camp_schedule_items
  add column learning_topic_entity_id uuid
    references hearthland.learning_topics(entity_id) on delete set null,
  add column build_item_id uuid
    references hearthland.camp_build_items(id) on delete set null,
  add column capacity integer check (capacity is null or capacity >= 1),
  add column session_mode text
    check (session_mode is null or session_mode in ('practical', 'theoretical', 'both')),
  add column audience text not null default 'public'
    check (audience in ('public', 'participants'));

create index camp_schedule_items_learning_topic_idx
  on hearthland.camp_schedule_items (learning_topic_entity_id)
  where learning_topic_entity_id is not null;
create index camp_schedule_items_build_item_idx
  on hearthland.camp_schedule_items (build_item_id)
  where build_item_id is not null;

create table hearthland.camp_participants (
  id uuid primary key default gen_random_uuid(),
  camp_entity_id uuid not null
    references hearthland.building_camps(entity_id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  application_id uuid unique
    references hearthland.camp_applications(id) on delete set null,
  roles text[] not null default array['participant']::text[],
  participant_status text not null default 'accepted'
    check (participant_status in ('accepted', 'checked_in', 'completed', 'cancelled', 'no_show')),
  joined_via text not null default 'application'
    check (joined_via in ('application', 'invitation', 'manual')),
  public_visibility boolean not null default false,
  accepted_at timestamptz not null default now(),
  checked_in_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (camp_entity_id, account_id)
);

create index camp_participants_operational_idx
  on hearthland.camp_participants (camp_entity_id, participant_status, accepted_at);
create index camp_participants_account_idx
  on hearthland.camp_participants (account_id, participant_status, accepted_at desc);

create table hearthland.camp_application_contributions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references hearthland.camp_applications(id) on delete cascade,
  contribution_type text not null check (contribution_type in (
    'tools', 'materials', 'vehicle', 'professional_equipment',
    'knowledge', 'food', 'other'
  )),
  description text not null check (length(btrim(description)) > 0),
  quantity text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, contribution_type, description)
);

create index camp_application_contributions_application_idx
  on hearthland.camp_application_contributions (application_id, contribution_type);

create table hearthland.camp_build_item_media (
  build_item_id uuid not null
    references hearthland.camp_build_items(id) on delete cascade,
  media_asset_id uuid not null
    references hearthland.media_assets(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (build_item_id, media_asset_id)
);

create index camp_build_item_media_asset_idx
  on hearthland.camp_build_item_media (media_asset_id);

create table hearthland.camp_announcements (
  id uuid primary key default gen_random_uuid(),
  camp_entity_id uuid not null
    references hearthland.building_camps(entity_id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 180),
  body text not null check (length(btrim(body)) between 1 and 5000),
  audience text not null default 'participants'
    check (audience in ('public', 'participants')),
  notify_participants boolean not null default true,
  published_at timestamptz not null default now(),
  created_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index camp_announcements_feed_idx
  on hearthland.camp_announcements (camp_entity_id, published_at desc)
  where archived_at is null;
create index camp_announcements_created_by_idx
  on hearthland.camp_announcements (created_by_account_id);

create table hearthland.camp_preparation_sections (
  id uuid primary key default gen_random_uuid(),
  camp_entity_id uuid not null
    references hearthland.building_camps(entity_id) on delete cascade,
  section_type text not null check (section_type in (
    'what_to_bring', 'arrival', 'transport', 'accommodation', 'food',
    'tools', 'safety', 'contact', 'other'
  )),
  title text not null,
  body text not null default '',
  audience text not null default 'participants'
    check (audience in ('public', 'participants')),
  sort_order integer not null default 0,
  created_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (camp_entity_id, section_type)
);

create index camp_preparation_sections_created_by_idx
  on hearthland.camp_preparation_sections (created_by_account_id);

create table hearthland.camp_results (
  camp_entity_id uuid primary key
    references hearthland.building_camps(entity_id) on delete cascade,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published')),
  what_we_built text not null default '',
  what_we_learned text not null default '',
  main_results text not null default '',
  what_happens_next text not null default '',
  participants_count integer not null default 0 check (participants_count >= 0),
  masters_count integer not null default 0 check (masters_count >= 0),
  workshops_count integer not null default 0 check (workshops_count >= 0),
  duration_days integer not null default 0 check (duration_days >= 0),
  published_at timestamptz,
  created_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  updated_by_account_id uuid
    references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint camp_results_publication_check check (
    publication_status <> 'published' or published_at is not null
  )
);

create index camp_results_publication_idx
  on hearthland.camp_results (publication_status, published_at desc);
create index camp_results_created_by_idx
  on hearthland.camp_results (created_by_account_id);
create index camp_results_updated_by_idx
  on hearthland.camp_results (updated_by_account_id);

-- ---------------------------------------------------------------------------
-- Lightweight operating-community layer
-- ---------------------------------------------------------------------------

create table hearthland.community_working_groups (
  id uuid primary key default gen_random_uuid(),
  community_entity_id uuid not null
    references hearthland.communities(entity_id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '',
  coordinator_account_id uuid
    references hearthland.accounts(id) on delete set null,
  group_status text not null default 'active'
    check (group_status in ('active', 'paused', 'archived')),
  created_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_entity_id, slug)
);

create index community_working_groups_directory_idx
  on hearthland.community_working_groups (
    community_entity_id, group_status, title
  );
create index community_working_groups_coordinator_idx
  on hearthland.community_working_groups (coordinator_account_id)
  where coordinator_account_id is not null;
create index community_working_groups_created_by_idx
  on hearthland.community_working_groups (created_by_account_id);

create table hearthland.working_group_members (
  working_group_id uuid not null
    references hearthland.community_working_groups(id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  member_role text not null default 'member'
    check (member_role in ('coordinator', 'member')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  joined_at timestamptz not null default now(),
  created_by_account_id uuid
    references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (working_group_id, account_id)
);

create index working_group_members_account_idx
  on hearthland.working_group_members (account_id, status, joined_at desc);
create index working_group_members_created_by_idx
  on hearthland.working_group_members (created_by_account_id);

alter table hearthland.tasks
  add column working_group_id uuid
    references hearthland.community_working_groups(id) on delete set null;

create index tasks_working_group_idx
  on hearthland.tasks (working_group_id, status, due_date)
  where working_group_id is not null and archived_at is null;

create table hearthland.community_meetings (
  id uuid primary key default gen_random_uuid(),
  community_entity_id uuid not null
    references hearthland.communities(entity_id) on delete cascade,
  working_group_id uuid
    references hearthland.community_working_groups(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz,
  agenda text not null default '',
  notes text not null default '',
  meeting_status text not null default 'scheduled'
    check (meeting_status in ('scheduled', 'completed', 'cancelled')),
  visibility text not null default 'members'
    check (visibility in ('members', 'managers')),
  created_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  updated_by_account_id uuid
    references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_meetings_time_check check (
    ends_at is null or ends_at > starts_at
  )
);

create index community_meetings_calendar_idx
  on hearthland.community_meetings (
    community_entity_id, starts_at desc, meeting_status
  );
create index community_meetings_working_group_idx
  on hearthland.community_meetings (working_group_id, starts_at desc)
  where working_group_id is not null;
create index community_meetings_created_by_idx
  on hearthland.community_meetings (created_by_account_id);
create index community_meetings_updated_by_idx
  on hearthland.community_meetings (updated_by_account_id);

create table hearthland.community_meeting_attendees (
  meeting_id uuid not null
    references hearthland.community_meetings(id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  attendance_status text not null default 'invited'
    check (attendance_status in ('invited', 'confirmed', 'attended', 'absent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, account_id)
);

create index community_meeting_attendees_account_idx
  on hearthland.community_meeting_attendees (
    account_id, attendance_status, meeting_id
  );

create table hearthland.community_decisions (
  id uuid primary key default gen_random_uuid(),
  community_entity_id uuid not null
    references hearthland.communities(entity_id) on delete cascade,
  meeting_id uuid
    references hearthland.community_meetings(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '',
  decision_status text not null default 'proposed'
    check (decision_status in ('proposed', 'approved', 'rejected', 'superseded', 'archived')),
  decided_at timestamptz,
  visibility text not null default 'members'
    check (visibility in ('members', 'managers')),
  created_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  updated_by_account_id uuid
    references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_decisions_date_check check (
    decision_status not in ('approved', 'rejected', 'superseded')
    or decided_at is not null
  )
);

create index community_decisions_archive_idx
  on hearthland.community_decisions (
    community_entity_id, decision_status, decided_at desc
  );
create index community_decisions_meeting_idx
  on hearthland.community_decisions (meeting_id)
  where meeting_id is not null;
create index community_decisions_created_by_idx
  on hearthland.community_decisions (created_by_account_id);
create index community_decisions_updated_by_idx
  on hearthland.community_decisions (updated_by_account_id);

create table hearthland.community_pulse_cycles (
  id uuid primary key default gen_random_uuid(),
  community_entity_id uuid not null
    references hearthland.communities(entity_id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  opens_at timestamptz not null default now(),
  closes_at timestamptz,
  cycle_status text not null default 'open'
    check (cycle_status in ('draft', 'open', 'closed')),
  created_by_account_id uuid not null
    references hearthland.accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_pulse_cycles_time_check check (
    closes_at is null or closes_at > opens_at
  )
);

create index community_pulse_cycles_community_idx
  on hearthland.community_pulse_cycles (
    community_entity_id, cycle_status, opens_at desc
  );
create index community_pulse_cycles_created_by_idx
  on hearthland.community_pulse_cycles (created_by_account_id);

-- Individual pulse answers and comments remain private to the respondent.
-- Managers receive only thresholded aggregates from an RPC defined below.
create table hearthland.community_pulse_responses (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null
    references hearthland.community_pulse_cycles(id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  communication smallint not null check (communication between 1 and 5),
  cooperation smallint not null check (cooperation between 1 and 5),
  belonging smallint not null check (belonging between 1 and 5),
  workload smallint not null check (workload between 1 and 5),
  clarity smallint not null check (clarity between 1 and 5),
  atmosphere smallint not null check (atmosphere between 1 and 5),
  private_comment text not null default '',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, account_id)
);

create index community_pulse_responses_account_idx
  on hearthland.community_pulse_responses (account_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- Early-user feedback and internal cohort markers
-- ---------------------------------------------------------------------------

create table hearthland.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references hearthland.accounts(id) on delete set null,
  category text not null check (category in (
    'confusing', 'bug', 'feature_request',
    'community_project_suggestion', 'other'
  )),
  message text not null check (length(btrim(message)) between 1 and 10000),
  page_url text check (page_url is null or length(page_url) <= 2048),
  user_agent text check (user_agent is null or length(user_agent) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 16384
  ),
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'planned', 'resolved', 'closed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to_account_id uuid
    references hearthland.accounts(id) on delete set null,
  resolution_note text not null default '',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feedback_submissions_triage_idx
  on hearthland.feedback_submissions (status, priority, created_at desc);
create index feedback_submissions_account_idx
  on hearthland.feedback_submissions (account_id, created_at desc)
  where account_id is not null;
create index feedback_submissions_assigned_to_idx
  on hearthland.feedback_submissions (assigned_to_account_id, status)
  where assigned_to_account_id is not null;

create table hearthland.early_user_cohorts (
  account_id uuid primary key references hearthland.accounts(id) on delete cascade,
  cohort text not null check (cohort ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  enrolled_at timestamptz not null default now(),
  enrolled_by_account_id uuid
    references hearthland.accounts(id) on delete set null,
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index early_user_cohorts_cohort_idx
  on hearthland.early_user_cohorts (cohort, enrolled_at desc);
create index early_user_cohorts_enrolled_by_idx
  on hearthland.early_user_cohorts (enrolled_by_account_id)
  where enrolled_by_account_id is not null;

-- One persistent participation funnel serves every prominent pilot-project
-- CTA. Camp applications remain the operational source for a specific camp.
create table hearthland.project_participation_requests (
  id uuid primary key default gen_random_uuid(),
  project_entity_id uuid not null
    references hearthland.settlement_projects(entity_id) on delete cascade,
  applicant_account_id uuid not null
    references hearthland.accounts(id) on delete cascade,
  participation_type text not null check (participation_type in (
    'future_resident', 'core_team', 'camp_participant', 'volunteer',
    'master_teacher', 'specialist', 'supporter', 'partner'
  )),
  message text not null default '',
  availability text,
  relevant_skill_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'new' check (status in (
    'new', 'reviewing', 'contacted', 'accepted', 'declined', 'withdrawn'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (project_entity_id, applicant_account_id, participation_type)
);

create index project_participation_requests_manager_idx
  on hearthland.project_participation_requests (
    project_entity_id, status, participation_type, created_at desc
  ) where archived_at is null;
create index project_participation_requests_applicant_idx
  on hearthland.project_participation_requests (
    applicant_account_id, status, updated_at desc
  ) where archived_at is null;

-- ---------------------------------------------------------------------------
-- Authorization and integrity helpers
-- ---------------------------------------------------------------------------

create or replace function hearthland_private.hash_invitation_token(raw_token text)
returns text
language sql
immutable
strict
security invoker
set search_path = pg_catalog, extensions
as $$
  select encode(digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function hearthland_private.is_camp_participant(target_camp_entity_id uuid)
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
      from hearthland.camp_participants cp
      where cp.camp_entity_id = target_camp_entity_id
        and cp.account_id = (select auth.uid())
        and cp.participant_status in ('accepted', 'checked_in', 'completed')
    ),
    false
  );
$$;

create or replace function hearthland_private.can_manage_working_group(
  target_working_group_id uuid
)
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
      from hearthland.community_working_groups wg
      where wg.id = target_working_group_id
        and (
          wg.coordinator_account_id = (select auth.uid())
          or hearthland_private.can_manage_entity(wg.community_entity_id)
        )
    ),
    false
  );
$$;

revoke all on function hearthland_private.hash_invitation_token(text)
  from public, anon, authenticated;
revoke all on function hearthland_private.is_camp_participant(uuid)
  from public;
grant execute on function hearthland_private.is_camp_participant(uuid)
  to anon, authenticated;
revoke all on function hearthland_private.can_manage_working_group(uuid)
  from public, anon;
grant execute on function hearthland_private.can_manage_working_group(uuid)
  to authenticated;

-- Every new mutable table uses the established timestamp trigger.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profile_teaching_topics',
    'pilot_projects',
    'camp_participants',
    'camp_application_contributions',
    'camp_announcements',
    'camp_preparation_sections',
    'camp_results',
    'community_working_groups',
    'working_group_members',
    'community_meetings',
    'community_meeting_attendees',
    'community_decisions',
    'community_pulse_cycles',
    'community_pulse_responses',
    'feedback_submissions',
    'early_user_cohorts',
    'project_participation_requests'
  ]
  loop
    execute format(
      'create trigger set_hearthland_updated_at before update on hearthland.%I '
      'for each row execute function hearthland_private.set_updated_at()',
      target_table
    );
  end loop;
end;
$$;

create or replace function hearthland_private.validate_camp_schedule_links()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.build_item_id is not null and not exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = new.build_item_id
      and bi.camp_entity_id = new.camp_entity_id
  ) then
    raise exception 'Workshop build item must belong to the same Camp';
  end if;

  if new.learning_topic_entity_id is not null
     and new.item_type not in ('practical_workshop', 'lesson', 'community') then
    raise exception 'Learning topics may only be linked to workshop, lesson, or community sessions';
  end if;

  if new.session_mode is not null
     and new.item_type not in ('practical_workshop', 'lesson', 'community') then
    raise exception 'Session mode may only be set for learning sessions';
  end if;

  return new;
end;
$$;

create trigger validate_hearthland_camp_schedule_links
before insert or update on hearthland.camp_schedule_items
for each row execute function hearthland_private.validate_camp_schedule_links();

create or replace function hearthland_private.stamp_camp_build_progress()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.progress_percent is distinct from old.progress_percent
     or new.progress_note is distinct from old.progress_note
     or new.status is distinct from old.status then
    new.progress_updated_at := now();
    if (select auth.uid()) is not null then
      new.progress_updated_by_account_id := (select auth.uid());
    end if;
  end if;
  return new;
end;
$$;

create trigger stamp_hearthland_camp_build_progress
before update on hearthland.camp_build_items
for each row execute function hearthland_private.stamp_camp_build_progress();

create or replace function hearthland_private.guard_camp_application_roles()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if not coalesce(
    new.selected_roles <@ array[
      'participant', 'learner', 'volunteer', 'builder',
      'master_teacher', 'specialist', 'future_resident'
    ]::text[],
    false
  ) then
    raise exception 'Camp application roles must use stable role codes'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger guard_t3_4_camp_application_roles
before insert or update of selected_roles on hearthland.camp_applications
for each row execute function hearthland_private.guard_camp_application_roles();

create or replace function hearthland_private.sync_t3_4_camp_participant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into hearthland.camp_participants (
      camp_entity_id,
      account_id,
      application_id,
      roles,
      participant_status,
      joined_via,
      accepted_at
    ) values (
      new.camp_entity_id,
      new.applicant_account_id,
      new.id,
      case
        when cardinality(new.selected_roles) = 0 then array['participant']::text[]
        else new.selected_roles
      end,
      'accepted',
      'application',
      now()
    )
    on conflict (camp_entity_id, account_id) do update
    set application_id = excluded.application_id,
        roles = excluded.roles,
        participant_status = 'accepted',
        joined_via = 'application',
        accepted_at = excluded.accepted_at,
        updated_at = now();

    if 'master_teacher' = any(new.selected_roles) then
      insert into hearthland.camp_team (
        camp_entity_id, account_id, role, is_master, public_visibility
      ) values (
        new.camp_entity_id, new.applicant_account_id,
        'master_teacher', true, true
      )
      on conflict (camp_entity_id, account_id, role) do update
      set is_master = true,
          public_visibility = true,
          updated_at = now();
    end if;
  elsif old.status = 'accepted'
        and new.status in ('cancelled', 'withdrawn', 'declined') then
    update hearthland.camp_participants
    set participant_status = 'cancelled', updated_at = now()
    where camp_entity_id = new.camp_entity_id
      and account_id = new.applicant_account_id;
  end if;
  return new;
end;
$$;

create trigger sync_t3_4_hearthland_camp_participant
after update of status on hearthland.camp_applications
for each row execute function hearthland_private.sync_t3_4_camp_participant();

-- Acceptance grants participant-only access. Keep the accepted application
-- terminal; later attendance/cancellation state belongs to camp_participants.
create or replace function hearthland_private.guard_terminal_camp_application()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is not null
     and old.status = 'accepted'
     and new.status is distinct from 'accepted' then
    raise exception 'Accepted Camp applications are terminal'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_t3_4_terminal_camp_application
before update of status on hearthland.camp_applications
for each row execute function hearthland_private.guard_terminal_camp_application();

-- A Camp may be attributed only to a real Community/emerging Community and,
-- when supplied, a real settlement Project. Authenticated Camp managers must
-- also manage every linked entity; published Camps cannot be silently moved
-- between unrelated projects or Communities through the direct Data API.
create or replace function hearthland_private.guard_building_camp_links()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  linked_project_host uuid;
  camp_is_published boolean := false;
begin
  if not exists (
    select 1
    from hearthland.entities host
    where host.id = new.host_entity_id
      and host.entity_type in ('community', 'emerging_community')
      and host.archived_at is null
  ) then
    raise exception 'Camp host must be an active Community'
      using errcode = '23514';
  end if;

  if new.project_entity_id is not null then
    select sp.emerging_community_entity_id
    into linked_project_host
    from hearthland.settlement_projects sp
    join hearthland.entities project on project.id = sp.entity_id
    where sp.entity_id = new.project_entity_id
      and project.archived_at is null;
    if not found then
      raise exception 'Camp project must be an active settlement Project'
        using errcode = '23514';
    end if;
    if linked_project_host is not null
       and linked_project_host is distinct from new.host_entity_id then
      raise exception 'Camp host does not match the settlement Project Community'
        using errcode = '23514';
    end if;
  end if;

  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and (select auth.uid()) is not null then
    if not hearthland_private.can_manage_entity(new.host_entity_id)
       or (
         new.project_entity_id is not null
         and not hearthland_private.can_manage_entity(new.project_entity_id)
       ) then
      raise exception 'Camp links require management access to the host and Project'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE'
       and (
         new.host_entity_id is distinct from old.host_entity_id
         or new.project_entity_id is distinct from old.project_entity_id
       ) then
      select e.publication_status = 'published'
      into camp_is_published
      from hearthland.entities e
      where e.id = old.entity_id;
      if camp_is_published or old.camp_status <> 'draft' then
        raise exception 'Published Camp attribution is immutable'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_t3_4_building_camp_links
before insert or update of host_entity_id, project_entity_id
on hearthland.building_camps
for each row execute function hearthland_private.guard_building_camp_links();

-- Every operational participant needs the matching entity membership used by
-- base Camp/entity RLS. Application and invitation paths already create it;
-- this idempotent trigger also covers manager-added manual participants.
create or replace function hearthland_private.sync_camp_participant_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.participant_status in ('accepted', 'checked_in', 'completed') then
    insert into hearthland.entity_memberships (
      entity_id,
      account_id,
      membership_type,
      status,
      joined_at,
      created_by_account_id
    ) values (
      new.camp_entity_id,
      new.account_id,
      'participant',
      'active',
      coalesce(new.accepted_at, now()),
      (select auth.uid())
    )
    on conflict (entity_id, account_id, membership_type) do update
    set status = 'active',
        joined_at = coalesce(
          hearthland.entity_memberships.joined_at,
          excluded.joined_at
        ),
        updated_at = now();
  else
    update hearthland.entity_memberships
    set status = 'inactive', updated_at = now()
    where entity_id = new.camp_entity_id
      and account_id = new.account_id
      and membership_type = 'participant';
  end if;
  return new;
end;
$$;

create trigger sync_hearthland_camp_participant_membership
after insert or update of participant_status on hearthland.camp_participants
for each row execute function hearthland_private.sync_camp_participant_membership();

create or replace function hearthland_private.guard_camp_participant_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and row(
       new.id,
       new.camp_entity_id,
       new.account_id,
       new.application_id,
       new.joined_via,
       new.accepted_at,
       new.created_at
     ) is distinct from row(
       old.id,
       old.camp_entity_id,
       old.account_id,
       old.application_id,
       old.joined_via,
       old.accepted_at,
       old.created_at
     ) then
    raise exception 'Camp participant identity and provenance are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_hearthland_camp_participant_identity
before update on hearthland.camp_participants
for each row execute function hearthland_private.guard_camp_participant_identity();

create or replace function hearthland_private.notify_camp_announcement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.notify_participants and new.archived_at is null then
    insert into hearthland.notifications (
      account_id,
      notification_type,
      title,
      body,
      entity_id,
      actor_account_id,
      metadata
    )
    select distinct
      cp.account_id,
      'camp_announcement',
      new.title,
      new.body,
      new.camp_entity_id,
      new.created_by_account_id,
      jsonb_build_object('announcement_id', new.id)
    from hearthland.camp_participants cp
    where cp.camp_entity_id = new.camp_entity_id
      and cp.participant_status in ('accepted', 'checked_in');
  end if;
  return new;
end;
$$;

create trigger notify_hearthland_camp_announcement
after insert on hearthland.camp_announcements
for each row execute function hearthland_private.notify_camp_announcement();

create or replace function hearthland_private.snapshot_camp_result_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  should_snapshot boolean := false;
begin
  if new.publication_status = 'published' then
    if tg_op = 'INSERT' then
      should_snapshot := true;
    else
      should_snapshot := old.publication_status is distinct from 'published';
    end if;
  end if;

  if should_snapshot then
    select count(distinct cp.account_id)::integer
    into new.participants_count
    from hearthland.camp_participants cp
    where cp.camp_entity_id = new.camp_entity_id
      and cp.participant_status in ('accepted', 'checked_in', 'completed');

    select count(distinct ct.account_id)::integer
    into new.masters_count
    from hearthland.camp_team ct
    where ct.camp_entity_id = new.camp_entity_id
      and ct.is_master;

    select count(*)::integer
    into new.workshops_count
    from hearthland.camp_schedule_items si
    where si.camp_entity_id = new.camp_entity_id
      and si.item_type in ('practical_workshop', 'lesson', 'community');

    select (c.end_date - c.start_date + 1)::integer
    into new.duration_days
    from hearthland.building_camps c
    where c.entity_id = new.camp_entity_id;

    new.published_at := coalesce(new.published_at, now());

    -- A published completion snapshot is the canonical transition that makes
    -- public Camp results visible. Keep the Camp lifecycle in sync so the
    -- application does not depend on a separate manual SQL update.
    update hearthland.building_camps
    set camp_status = 'completed',
        updated_at = now()
    where entity_id = new.camp_entity_id
      and camp_status is distinct from 'completed';
  end if;
  return new;
end;
$$;

create trigger snapshot_hearthland_camp_result_counts
before insert or update of publication_status on hearthland.camp_results
for each row execute function hearthland_private.snapshot_camp_result_counts();

create or replace function hearthland_private.validate_operating_community_links()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  linked_community_id uuid;
begin
  if tg_table_name = 'community_meetings' and new.working_group_id is not null then
    select wg.community_entity_id into linked_community_id
    from hearthland.community_working_groups wg
    where wg.id = new.working_group_id;
    if linked_community_id is distinct from new.community_entity_id then
      raise exception 'Meeting working group must belong to the same Community';
    end if;
  elsif tg_table_name = 'community_decisions' and new.meeting_id is not null then
    select m.community_entity_id into linked_community_id
    from hearthland.community_meetings m
    where m.id = new.meeting_id;
    if linked_community_id is distinct from new.community_entity_id then
      raise exception 'Decision meeting must belong to the same Community';
    end if;
  elsif tg_table_name = 'tasks' and new.working_group_id is not null then
    select wg.community_entity_id into linked_community_id
    from hearthland.community_working_groups wg
    where wg.id = new.working_group_id;
    if linked_community_id is distinct from new.entity_id then
      raise exception 'Task working group must belong to the task Community';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_hearthland_meeting_working_group
before insert or update on hearthland.community_meetings
for each row execute function hearthland_private.validate_operating_community_links();
create trigger validate_hearthland_decision_meeting
before insert or update on hearthland.community_decisions
for each row execute function hearthland_private.validate_operating_community_links();
create trigger validate_hearthland_task_working_group
before insert or update of entity_id, working_group_id on hearthland.tasks
for each row execute function hearthland_private.validate_operating_community_links();

-- Coordinators can maintain their own group, but they must not use that access
-- to move the group (and every attached member/task/meeting) into a Community
-- they do not manage. Identity and creator provenance remain service-managed.
create or replace function hearthland_private.guard_community_working_group_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if row(
    new.id,
    new.community_entity_id,
    new.created_by_account_id,
    new.created_at
  ) is distinct from row(
    old.id,
    old.community_entity_id,
    old.created_by_account_id,
    old.created_at
  ) then
    raise exception 'Working-group identity and creator provenance are immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_hearthland_community_working_group_update
before update on hearthland.community_working_groups
for each row execute function hearthland_private.guard_community_working_group_update();

create or replace function hearthland_private.validate_working_group_people()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  target_community_id uuid;
  target_account_id uuid;
begin
  if tg_table_name = 'community_working_groups' then
    if new.coordinator_account_id is null then
      return new;
    end if;
    target_community_id := new.community_entity_id;
    target_account_id := new.coordinator_account_id;
  else
    select wg.community_entity_id into target_community_id
    from hearthland.community_working_groups wg
    where wg.id = new.working_group_id;
    target_account_id := new.account_id;
    if tg_op = 'INSERT' then
      if (select auth.uid()) is not null then
        new.created_by_account_id := (select auth.uid());
      end if;
    else
      if new.working_group_id <> old.working_group_id
         or new.account_id <> old.account_id
         or new.created_at <> old.created_at then
        raise exception 'Working-group membership identity is immutable'
          using errcode = '42501';
      end if;
      new.created_by_account_id := old.created_by_account_id;
    end if;
  end if;

  if target_community_id is null or not exists (
    select 1
    from hearthland.entity_memberships em
    where em.entity_id = target_community_id
      and em.account_id = target_account_id
      and em.status = 'active'
  ) and not exists (
    select 1
    from hearthland.entities e
    where e.id = target_community_id
      and e.owner_account_id = target_account_id
  ) and not exists (
    select 1
    from hearthland.entity_roles er
    where er.entity_id = target_community_id
      and er.account_id = target_account_id
      and er.status = 'active'
      and er.role in ('owner', 'administrator')
  ) then
    raise exception 'Working-group people require active Community membership'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger validate_hearthland_working_group_coordinator
before insert or update of community_entity_id, coordinator_account_id
on hearthland.community_working_groups
for each row execute function hearthland_private.validate_working_group_people();
create trigger validate_hearthland_working_group_member
before insert or update on hearthland.working_group_members
for each row execute function hearthland_private.validate_working_group_people();

create or replace function hearthland_private.guard_community_pulse_response()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  target_community_id uuid;
  target_cycle_status text;
  target_opens_at timestamptz;
  target_closes_at timestamptz;
begin
  if current_account_id is null then
    return new;
  end if;

  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    new.id <> old.id
    or new.cycle_id <> old.cycle_id
    or new.account_id <> old.account_id
    or new.submitted_at <> old.submitted_at
  ) then
    raise exception 'Pulse response identity is immutable' using errcode = '42501';
  end if;

  if new.account_id <> current_account_id then
    raise exception 'Pulse responses may only be submitted for the current account'
      using errcode = '42501';
  end if;

  select
    pc.community_entity_id,
    pc.cycle_status,
    pc.opens_at,
    pc.closes_at
  into
    target_community_id,
    target_cycle_status,
    target_opens_at,
    target_closes_at
  from hearthland.community_pulse_cycles pc
  where pc.id = new.cycle_id;

  if target_community_id is null then
    raise exception 'Pulse cycle is unavailable';
  end if;
  if target_cycle_status <> 'open'
     or target_opens_at > now()
     or (target_closes_at is not null and target_closes_at <= now()) then
    raise exception 'Pulse cycle is not accepting responses';
  end if;
  if not hearthland_private.is_entity_member(target_community_id) then
    raise exception 'Active Community membership is required' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_hearthland_community_pulse_response
before insert or update on hearthland.community_pulse_responses
for each row execute function hearthland_private.guard_community_pulse_response();

create or replace function hearthland_private.guard_feedback_submission()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if current_user in ('postgres', 'service_role', 'supabase_admin') then
      return new;
    end if;

    if current_account_id is not null then
      if not hearthland_private.current_account_is_active() then
        raise exception 'Hearthland account is not active' using errcode = '42501';
      end if;
      new.account_id := current_account_id;
    else
      new.account_id := null;
    end if;

    new.status := 'new';
    new.priority := 'normal';
    new.assigned_to_account_id := null;
    new.resolution_note := '';
    new.resolved_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not hearthland_private.is_platform_staff(array['admin']::text[]) then
    raise exception 'Only platform administrators may triage feedback'
      using errcode = '42501';
  end if;

  if new.id <> old.id
     or new.account_id is distinct from old.account_id
     or new.category <> old.category
     or new.message <> old.message
     or new.page_url is distinct from old.page_url
     or new.user_agent is distinct from old.user_agent
     or new.metadata <> old.metadata
     or new.created_at <> old.created_at then
    raise exception 'Feedback identity and submitted content are immutable'
      using errcode = '42501';
  end if;

  if new.status in ('resolved', 'closed') and new.resolved_at is null then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'closed') then
    new.resolved_at := null;
  end if;

  return new;
end;
$$;

create trigger guard_hearthland_feedback_submission
before insert or update on hearthland.feedback_submissions
for each row execute function hearthland_private.guard_feedback_submission();

create or replace function hearthland_private.guard_project_participation_request()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  manager_access boolean;
begin
  if current_account_id is null then
    return new;
  end if;

  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;

  manager_access := hearthland_private.can_manage_entity(
    case when tg_op = 'INSERT' then new.project_entity_id else old.project_entity_id end
  );

  if tg_op = 'INSERT' then
    if new.applicant_account_id <> current_account_id
       or new.status <> 'new'
       or new.archived_at is not null then
      raise exception 'Participation requests must start as a current-user new request'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
      from hearthland.entities e
      where e.id = new.project_entity_id
        and e.entity_type = 'settlement_project'
        and e.publication_status = 'published'
        and e.archived_at is null
        and hearthland_private.can_view_entity(e.id)
    ) then
      raise exception 'Participation requests require an available published project'
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from unnest(new.relevant_skill_ids)
        as requested_skill(requested_skill_id)
      where not exists (
        select 1
        from hearthland.person_profiles pp
        join hearthland.person_skills ps
          on ps.profile_entity_id = pp.entity_id
        where pp.account_id = current_account_id
          and ps.id = requested_skill.requested_skill_id
      )
    ) then
      raise exception 'Relevant skills must belong to the applicant profile'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.project_entity_id <> old.project_entity_id
     or new.applicant_account_id <> old.applicant_account_id
     or new.participation_type <> old.participation_type
     or new.created_at <> old.created_at then
    raise exception 'Participation request identity is immutable'
      using errcode = '42501';
  end if;

  if manager_access then
    if old.status in ('accepted', 'declined', 'withdrawn')
       and new.status <> old.status then
      raise exception 'Terminal participation decisions are immutable'
        using errcode = '42501';
    end if;
    if new.status not in ('new', 'reviewing', 'contacted', 'accepted', 'declined')
       or row(new.message, new.availability, new.relevant_skill_ids, new.archived_at)
          is distinct from
          row(old.message, old.availability, old.relevant_skill_ids, old.archived_at) then
      raise exception 'Managers cannot withdraw a participation request';
    end if;
  elsif old.applicant_account_id = current_account_id then
    if old.status not in ('new', 'reviewing', 'contacted')
       or new.status <> 'withdrawn'
       or row(new.message, new.availability, new.relevant_skill_ids, new.archived_at)
          is distinct from
          row(old.message, old.availability, old.relevant_skill_ids, old.archived_at) then
      raise exception 'Applicants may only withdraw an active pending request'
        using errcode = '42501';
    end if;
  else
    raise exception 'Participation request access denied' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_hearthland_project_participation_request
before insert or update on hearthland.project_participation_requests
for each row execute function hearthland_private.guard_project_participation_request();

create or replace function hearthland_private.sync_accepted_project_participation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into hearthland.entity_memberships (
      entity_id,
      account_id,
      membership_type,
      status,
      joined_at,
      created_by_account_id
    ) values (
      new.project_entity_id,
      new.applicant_account_id,
      new.participation_type,
      'active',
      now(),
      (select auth.uid())
    )
    on conflict (entity_id, account_id, membership_type) do update
    set status = 'active',
        joined_at = coalesce(hearthland.entity_memberships.joined_at, now()),
        updated_at = now();

    insert into hearthland.notifications (
      account_id,
      notification_type,
      title,
      body,
      entity_id,
      actor_account_id,
      metadata
    ) values (
      new.applicant_account_id,
      'project_participation_accepted',
      'Project participation accepted',
      'Your request to participate in a Hearthland project was accepted.',
      new.project_entity_id,
      (select auth.uid()),
      jsonb_build_object(
        'participation_request_id', new.id,
        'participation_type', new.participation_type
      )
    );
  end if;
  return new;
end;
$$;

create trigger sync_hearthland_accepted_project_participation
after update of status on hearthland.project_participation_requests
for each row execute function hearthland_private.sync_accepted_project_participation();

-- The T3.3 assignee guard must include the new working_group_id column so an
-- assignee cannot move a task between groups while only changing status.
create or replace function hearthland_private.guard_task_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
begin
  if current_account_id is null then
    return new;
  end if;

  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;

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
    new.working_group_id,
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
    old.working_group_id,
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

-- Preserve the direct-API self-promotion guard while allowing trusted
-- SECURITY DEFINER provisioning functions (owned by postgres) and the
-- service/Supabase-admin roles to activate memberships after they have
-- independently
-- validated an invitation/application decision. auth.uid() deliberately
-- remains the end-user identity inside those functions, so current_user is
-- the authority boundary here.
create or replace function hearthland_private.guard_membership_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.id <> old.id
     or new.entity_id <> old.entity_id
     or new.account_id <> old.account_id
     or new.membership_type <> old.membership_type then
    raise exception 'Membership identity is immutable';
  end if;

  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and (select auth.uid()) = old.account_id
     and not hearthland_private.can_manage_entity(old.entity_id)
     and new.status not in ('requested', 'inactive', 'former') then
    raise exception 'Members cannot activate or promote their own membership';
  end if;

  return new;
end;
$$;

-- Invitation acceptance provisions the existing membership and Camp-team
-- records. This replaces the T3.3 trigger function only to support `viewed`
-- and the expanded T3.4 invitation categories.
create or replace function hearthland_private.sync_accepted_invitation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_entity_type text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    if new.invited_account_id is null then
      raise exception 'Invitation must be bound before acceptance';
    end if;

    -- Revalidate grant authority at the moment the role is provisioned. A
    -- pending invitation must not preserve capabilities after the inviter is
    -- suspended, removed from the entity team, or loses platform authority.
    if not exists (
      select 1
      from hearthland.accounts inviter
      where inviter.id = new.invited_by_account_id
        and inviter.account_status = 'active'
        and inviter.archived_at is null
        and (
          exists (
            select 1 from hearthland.entities e
            where e.id = new.entity_id
              and e.owner_account_id = new.invited_by_account_id
          )
          or exists (
            select 1 from hearthland.entity_roles er
            where er.entity_id = new.entity_id
              and er.account_id = new.invited_by_account_id
              and er.role in ('owner', 'administrator')
              and er.status = 'active'
          )
          or exists (
            select 1 from hearthland.platform_roles pr
            where pr.account_id = new.invited_by_account_id
              and pr.role = 'admin'
              and pr.revoked_at is null
          )
        )
    ) then
      raise exception 'INVITATION_GRANT_AUTHORITY_REVOKED'
        using errcode = '42501';
    end if;

    if new.membership_role = 'administrator'
       and not (
         exists (
           select 1 from hearthland.entities e
           where e.id = new.entity_id
             and e.owner_account_id = new.invited_by_account_id
         )
         or exists (
           select 1 from hearthland.platform_roles pr
           where pr.account_id = new.invited_by_account_id
             and pr.role = 'admin'
             and pr.revoked_at is null
         )
       ) then
      raise exception 'ENTITY_ADMINISTRATOR_GRANT_REQUIRES_OWNER_OR_PLATFORM_ADMIN'
        using errcode = '42501';
    end if;

    new.accepted_by_account_id := new.invited_account_id;
    new.responded_at := coalesce(new.responded_at, now());
    new.viewed_at := coalesce(new.viewed_at, now());

    if new.membership_role = 'administrator' then
      insert into hearthland.entity_roles (
        entity_id,
        account_id,
        role,
        status,
        granted_by_account_id
      ) values (
        new.entity_id,
        new.invited_account_id,
        'administrator',
        'active',
        new.invited_by_account_id
      )
      on conflict (entity_id, account_id) do update
      set role = 'administrator', status = 'active', updated_at = now();
    else
      insert into hearthland.entity_memberships (
        entity_id,
        account_id,
        membership_type,
        status,
        joined_at,
        created_by_account_id
      ) values (
        new.entity_id,
        new.invited_account_id,
        new.membership_role,
        'active',
        now(),
        new.invited_by_account_id
      )
      on conflict (entity_id, account_id, membership_type) do update
      set status = 'active',
          joined_at = coalesce(hearthland.entity_memberships.joined_at, now()),
          updated_at = now();
    end if;

    select e.entity_type into target_entity_type
    from hearthland.entities e
    where e.id = new.entity_id;

    if target_entity_type = 'building_camp'
       and (
         new.invitation_type in (
           'camp_team', 'camp_master', 'master_teacher', 'organiser'
         )
         or new.membership_role in (
           'master', 'teacher', 'master_teacher', 'organiser'
         )
       ) then
      insert into hearthland.camp_team (
        camp_entity_id,
        account_id,
        role,
        is_master,
        invitation_id
      ) values (
        new.entity_id,
        new.invited_account_id,
        new.membership_role,
        new.invitation_type in ('camp_master', 'master_teacher')
          or new.membership_role in ('master', 'teacher', 'master_teacher'),
        new.id
      )
      on conflict (camp_entity_id, account_id, role) do update
      set is_master = excluded.is_master,
          invitation_id = excluded.invitation_id,
          updated_at = now();

    end if;

    if target_entity_type = 'building_camp'
       and new.membership_role in (
         'participant', 'future_resident', 'builder', 'volunteer',
         'master_teacher', 'organiser', 'specialist'
       ) then
        insert into hearthland.camp_participants (
          camp_entity_id,
          account_id,
          roles,
          participant_status,
          joined_via,
          accepted_at
        ) values (
          new.entity_id,
          new.invited_account_id,
          array[new.membership_role]::text[],
          'accepted',
          'invitation',
          now()
        )
        on conflict (camp_entity_id, account_id) do update
        set roles = case
              when excluded.roles[1] = any(hearthland.camp_participants.roles)
                then hearthland.camp_participants.roles
              else array_append(
                hearthland.camp_participants.roles,
                excluded.roles[1]
              )
            end,
            participant_status = 'accepted',
            joined_via = 'invitation',
            accepted_at = excluded.accepted_at,
            updated_at = now();
    end if;

    insert into hearthland.notifications (
      account_id,
      notification_type,
      title,
      body,
      entity_id,
      actor_account_id,
      metadata
    ) values (
      new.invited_by_account_id,
      'invitation_accepted',
      'Invitation accepted',
      'A Hearthland invitation was accepted.',
      new.entity_id,
      new.invited_account_id,
      jsonb_build_object('invitation_id', new.id)
    );
  elsif new.status in ('declined', 'revoked', 'expired')
        and old.status in ('pending', 'viewed') then
    new.responded_at := coalesce(new.responded_at, now());
  elsif new.status = 'viewed' and old.status = 'pending' then
    new.viewed_at := coalesce(new.viewed_at, now());
  end if;
  return new;
end;
$$;

create or replace function hearthland_private.guard_invitation_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  current_email text;
  manager_access boolean;
  is_valid_claim boolean := false;
begin
  if current_account_id is null then
    return new;
  end if;

  if not hearthland_private.current_account_is_active() then
    raise exception 'Hearthland account is not active' using errcode = '42501';
  end if;

  if new.id <> old.id
     or new.entity_id <> old.entity_id
     or new.invited_by_account_id <> old.invited_by_account_id
     or new.invitation_type <> old.invitation_type
     or new.proposed_role <> old.proposed_role
     or new.membership_role <> old.membership_role
     or new.role_title is distinct from old.role_title
     or new.message <> old.message
     or new.practical_arrangements <> old.practical_arrangements
     or new.token_hash is distinct from old.token_hash
     or new.recipient_mode <> old.recipient_mode
     or new.invited_email is distinct from old.invited_email
     or new.invited_name is distinct from old.invited_name
     or new.expires_at <> old.expires_at
     or new.created_at <> old.created_at then
    raise exception 'Invitation identity, content, and provenance are immutable'
      using errcode = '42501';
  end if;

  manager_access := hearthland_private.can_manage_entity(old.entity_id);

  -- The context-conversation RPC may bind an email invitation before the
  -- recipient accepts it, but only to the authenticated account whose trusted
  -- JWT email matches the invitation. Bearer/link invitations are not bound by
  -- messaging alone.
  if old.invited_account_id is null
     and new.invited_account_id = current_account_id
     and old.recipient_mode = 'email'
     and new.status = old.status
     and old.status in ('pending', 'viewed') then
    current_email := lower(nullif((select auth.jwt()) ->> 'email', ''));
    if current_email is not null
       and current_email = lower(old.invited_email) then
      return new;
    end if;
    raise exception 'Invitation email does not match the authenticated account'
      using errcode = '42501';
  end if;

  if old.invited_account_id is null
     and new.invited_account_id = current_account_id
     and old.status in ('pending', 'viewed')
     and new.status in ('accepted', 'declined') then
    if old.recipient_mode = 'email' then
      select lower(a.email) into current_email
      from hearthland.accounts a
      where a.id = current_account_id;
      is_valid_claim := current_email = lower(old.invited_email);
    elsif old.recipient_mode = 'link' then
      is_valid_claim := true;
    end if;
  end if;

  if new.status = 'viewed' and old.status = 'pending' then
    if new.invited_account_id is distinct from old.invited_account_id
       or new.accepted_by_account_id is distinct from old.accepted_by_account_id
       or new.responded_at is distinct from old.responded_at then
      raise exception 'Viewing may only change invitation view state';
    end if;
    return new;
  end if;

  if new.status = 'expired'
     and old.status in ('pending', 'viewed')
     and old.expires_at <= now()
     and new.invited_account_id is not distinct from old.invited_account_id then
    return new;
  end if;

  if manager_access
     and new.status in ('revoked', 'expired')
     and old.status in ('pending', 'viewed')
     and new.invited_account_id is not distinct from old.invited_account_id then
    return new;
  end if;

  if (
    old.invited_account_id = current_account_id or is_valid_claim
  ) and old.status in ('pending', 'viewed')
    and new.status in ('accepted', 'declined') then
    if new.invited_account_id <> current_account_id then
      raise exception 'Invitation response must bind to the current account'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Invitation transition is not allowed' using errcode = '42501';
end;
$$;

-- The older digest-level helper is no longer an application entrypoint.
revoke all on function hearthland_private.claim_invitation(text)
  from public, anon, authenticated;

create or replace function hearthland.create_invitation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  current_account_id uuid := (select auth.uid());
  target_entity_id uuid;
  target_entity_type text;
  target_entity_slug text;
  requested_account_id uuid;
  normalized_email text;
  requested_name text;
  requested_mode text;
  inferred_mode text;
  requested_type text;
  requested_role text;
  derived_membership_role text;
  requested_role_title text;
  requested_message text;
  requested_arrangements text;
  requested_expires_at timestamptz;
  expires_in_days integer;
  raw_token text;
  token_digest text;
  created_invitation_id uuid;
  attempts integer := 0;
begin
  if current_account_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'INVALID_INVITATION_PAYLOAD';
  end if;

  target_entity_id := nullif(payload ->> 'entity_id', '')::uuid;
  requested_account_id := nullif(payload ->> 'invited_account_id', '')::uuid;
  normalized_email := lower(nullif(btrim(payload ->> 'invited_email'), ''));
  requested_name := nullif(btrim(payload ->> 'invited_name'), '');
  requested_mode := nullif(payload ->> 'recipient_mode', '');
  requested_type := coalesce(nullif(payload ->> 'invitation_type', ''), 'team');
  requested_role := nullif(payload ->> 'proposed_role', '');
  requested_role_title := nullif(btrim(payload ->> 'role_title'), '');
  requested_message := coalesce(payload ->> 'message', '');
  requested_arrangements := coalesce(payload ->> 'practical_arrangements', '');

  if target_entity_id is null or requested_role is null then
    raise exception 'ENTITY_AND_ROLE_REQUIRED';
  end if;
  if not hearthland_private.can_manage_entity(target_entity_id) then
    raise exception 'INVITATION_MANAGER_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  select e.entity_type, e.slug
  into target_entity_type, target_entity_slug
  from hearthland.entities e
  where e.id = target_entity_id
    and e.entity_type in (
      'community', 'emerging_community', 'settlement_project', 'building_camp'
    )
    and e.archived_at is null
    and e.publication_status <> 'suspended';

  if target_entity_type is null then
    raise exception 'INVITATION_ENTITY_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if requested_account_id is not null and normalized_email is not null then
    raise exception 'INVITATION_RECIPIENT_MUST_USE_ONE_MODE';
  elsif requested_account_id is not null then
    inferred_mode := 'account';
  elsif normalized_email is not null then
    inferred_mode := 'email';
  else
    inferred_mode := 'link';
  end if;

  if requested_mode is not null and requested_mode <> inferred_mode then
    raise exception 'INVITATION_RECIPIENT_MODE_MISMATCH';
  end if;

  if inferred_mode = 'account' and not exists (
    select 1
    from hearthland.accounts a
    where a.id = requested_account_id
      and a.account_status = 'active'
      and a.archived_at is null
  ) then
    raise exception 'INVITED_ACCOUNT_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if requested_account_id = current_account_id then
    raise exception 'SELF_INVITATION_NOT_ALLOWED';
  end if;
  if normalized_email is not null and (
    length(normalized_email) > 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'INVALID_INVITED_EMAIL';
  end if;
  if requested_name is not null and length(requested_name) > 160 then
    raise exception 'INVITED_NAME_TOO_LONG';
  end if;
  if requested_type not in (
    'team', 'community_member', 'camp_team', 'camp_master', 'partner',
    'core_team', 'future_resident', 'master_teacher', 'specialist',
    'builder', 'volunteer', 'organiser', 'supporter',
    'entity_administrator'
  ) then
    raise exception 'INVALID_INVITATION_TYPE';
  end if;
  if length(requested_role) > 160 then
    raise exception 'INVALID_INVITATION_ROLE';
  end if;

  -- Permission-bearing roles are derived from the validated invitation type.
  -- Never trust a browser-provided `membership_role`: ordinary invitations
  -- cannot mint entity owners, entity administrators, or platform staff.
  if payload ? 'membership_role' then
    raise exception 'INVITATION_MEMBERSHIP_ROLE_IS_SERVER_MANAGED'
      using errcode = '42501';
  end if;

  derived_membership_role := case requested_type
    when 'entity_administrator' then 'administrator'
    when 'core_team' then 'core_team'
    when 'future_resident' then 'future_resident'
    when 'master_teacher' then 'master_teacher'
    when 'specialist' then 'specialist'
    when 'builder' then 'builder'
    when 'volunteer' then 'volunteer'
    when 'organiser' then 'organiser'
    when 'supporter' then 'supporter'
    when 'partner' then 'partner'
    when 'camp_master' then 'master_teacher'
    when 'camp_team' then 'organiser'
    else 'member'
  end;

  if derived_membership_role = 'administrator'
     and not (
       hearthland_private.owns_entity(target_entity_id)
       or hearthland_private.is_platform_staff(array['admin']::text[])
     ) then
    raise exception 'ENTITY_ADMINISTRATOR_GRANT_REQUIRES_OWNER_OR_PLATFORM_ADMIN'
      using errcode = '42501';
  end if;
  if requested_role_title is not null and length(requested_role_title) > 160 then
    raise exception 'INVITATION_ROLE_TITLE_TOO_LONG';
  end if;
  if length(requested_message) > 5000
     or length(requested_arrangements) > 5000 then
    raise exception 'INVITATION_MESSAGE_TOO_LONG';
  end if;

  if payload ? 'expires_at' and nullif(payload ->> 'expires_at', '') is not null then
    requested_expires_at := (payload ->> 'expires_at')::timestamptz;
  else
    expires_in_days := coalesce(nullif(payload ->> 'expires_in_days', '')::integer, 14);
    if expires_in_days not between 1 and 90 then
      raise exception 'INVITATION_EXPIRY_DAYS_OUT_OF_RANGE';
    end if;
    requested_expires_at := now() + make_interval(days => expires_in_days);
  end if;

  if requested_expires_at < now() + interval '1 hour'
     or requested_expires_at > now() + interval '90 days' then
    raise exception 'INVITATION_EXPIRY_OUT_OF_RANGE';
  end if;

  -- Expired rows must not hold the partial uniqueness slot forever. Managers
  -- can issue a replacement without waiting for the recipient to preview the
  -- stale invitation first.
  update hearthland.invitations i
  set status = 'expired',
      responded_at = coalesce(i.responded_at, now()),
      updated_at = now()
  where i.entity_id = target_entity_id
    and i.status in ('pending', 'viewed')
    and i.expires_at <= now();

  loop
    attempts := attempts + 1;
    raw_token := rtrim(
      translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'),
      '='
    );
    token_digest := hearthland_private.hash_invitation_token(raw_token);
    exit when not exists (
      select 1 from hearthland.invitations i where i.token_hash = token_digest
    );
    if attempts >= 5 then
      raise exception 'INVITATION_TOKEN_GENERATION_FAILED';
    end if;
  end loop;

  insert into hearthland.invitations (
    entity_id,
    invited_account_id,
    invited_email,
    invited_name,
    recipient_mode,
    invitation_type,
    proposed_role,
    membership_role,
    role_title,
    message,
    practical_arrangements,
    token_hash,
    status,
    invited_by_account_id,
    expires_at
  ) values (
    target_entity_id,
    requested_account_id,
    normalized_email,
    requested_name,
    inferred_mode,
    requested_type,
    requested_role,
    derived_membership_role,
    coalesce(
      requested_role_title,
      requested_role
    ),
    requested_message,
    requested_arrangements,
    token_digest,
    'pending',
    current_account_id,
    requested_expires_at
  ) returning id into created_invitation_id;

  if requested_account_id is not null then
    insert into hearthland.notifications (
      account_id,
      notification_type,
      title,
      body,
      target_url,
      entity_id,
      actor_account_id,
      metadata
    ) values (
      requested_account_id,
      'invitation_received',
      'You have a Hearthland invitation',
      coalesce(requested_role_title, requested_role),
      '/manage?direction=received',
      target_entity_id,
      current_account_id,
      jsonb_build_object('invitation_id', created_invitation_id)
    );
  end if;

  return jsonb_build_object(
    'id', created_invitation_id,
    'invitation_id', created_invitation_id,
    'raw_token', raw_token,
    'token', raw_token,
    'status', 'pending',
    'expires_at', requested_expires_at,
    'recipient_mode', inferred_mode,
    'entity_id', target_entity_id,
    'entity_slug', target_entity_slug
  );
end;
$$;

create or replace function hearthland.get_invitation_preview(raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  current_email text := lower(nullif((select auth.jwt()) ->> 'email', ''));
  token_digest text;
  invitation_locator_id uuid;
  invitation_row hearthland.invitations%rowtype;
  preview jsonb;
begin
  if current_account_id is not null
     and not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if raw_token is null then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if raw_token ~ '^[A-Za-z0-9_-]{43}$' then
    token_digest := hearthland_private.hash_invitation_token(raw_token);
    select i.* into invitation_row
    from hearthland.invitations i
    where i.token_hash = token_digest
    for update;
  elsif raw_token ~* (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
    || '[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    invitation_locator_id := raw_token::uuid;
    select i.* into invitation_row
    from hearthland.invitations i
    where i.id = invitation_locator_id
      and i.recipient_mode = 'account'
      and i.invited_account_id = current_account_id
    for update;
  else
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if invitation_row.status in ('pending', 'viewed')
     and invitation_row.expires_at <= now() then
    update hearthland.invitations
    set status = 'expired', responded_at = coalesce(responded_at, now())
    where id = invitation_row.id
    returning * into invitation_row;
  elsif invitation_row.status = 'pending' then
    update hearthland.invitations
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = invitation_row.id
    returning * into invitation_row;
  end if;

  select jsonb_build_object(
    'invitation_id', invitation_row.id,
    'status', invitation_row.status,
    'recipient_mode', invitation_row.recipient_mode,
    'can_message',
      invitation_row.status in ('pending', 'viewed', 'accepted')
      and current_account_id is not null
      and (
        invitation_row.invited_account_id = current_account_id
        or (
          invitation_row.invited_by_account_id = current_account_id
          and invitation_row.invited_account_id is not null
        )
        or (
          invitation_row.invited_account_id is null
          and invitation_row.recipient_mode = 'email'
          and current_email is not null
          and current_email = lower(invitation_row.invited_email)
        )
      ),
    'invited_name', invitation_row.invited_name,
    'invitation_type', invitation_row.invitation_type,
    'proposed_role', invitation_row.proposed_role,
    'membership_role', invitation_row.membership_role,
    'role_title', invitation_row.role_title,
    'message', invitation_row.message,
    'practical_arrangements', invitation_row.practical_arrangements,
    'created_at', invitation_row.created_at,
    'viewed_at', invitation_row.viewed_at,
    'expires_at', invitation_row.expires_at,
    'entity', jsonb_build_object(
      'id', e.id,
      'type', e.entity_type,
      'slug', e.slug,
      'title', e.title
    ),
    'inviter', jsonb_build_object(
      'display_name', a.display_name
    ),
    'dates', case
      when c.entity_id is null then null
      else jsonb_build_object('start_date', c.start_date, 'end_date', c.end_date)
    end
  )
  into preview
  from hearthland.entities e
  join hearthland.accounts a on a.id = invitation_row.invited_by_account_id
  left join hearthland.building_camps c on c.entity_id = e.id
  where e.id = invitation_row.entity_id;

  if preview is null then
    raise exception 'INVITATION_ENTITY_UNAVAILABLE' using errcode = 'P0002';
  end if;
  return preview;
end;
$$;

create or replace function hearthland.respond_to_invitation(
  raw_token text,
  response_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  current_email text;
  token_digest text;
  invitation_locator_id uuid;
  invitation_row hearthland.invitations%rowtype;
  target_slug text;
  target_entity_type text;
  idempotent_replay boolean := false;
begin
  if current_account_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if response_status not in ('accepted', 'declined') then
    raise exception 'INVALID_INVITATION_RESPONSE';
  end if;
  if raw_token is null then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if raw_token ~ '^[A-Za-z0-9_-]{43}$' then
    token_digest := hearthland_private.hash_invitation_token(raw_token);
    select i.* into invitation_row
    from hearthland.invitations i
    where i.token_hash = token_digest
    for update;
  elsif raw_token ~* (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
    || '[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    invitation_locator_id := raw_token::uuid;
    select i.* into invitation_row
    from hearthland.invitations i
    where i.id = invitation_locator_id
      and i.recipient_mode = 'account'
      and i.invited_account_id = current_account_id
    for update;
  else
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if invitation_row.invited_account_id is not null
     and invitation_row.invited_account_id <> current_account_id then
    raise exception 'INVITATION_RECIPIENT_MISMATCH' using errcode = '42501';
  end if;

  if invitation_row.recipient_mode = 'email' then
    select lower(a.email) into current_email
    from hearthland.accounts a
    where a.id = current_account_id;
    if current_email is distinct from lower(invitation_row.invited_email) then
      raise exception 'INVITATION_RECIPIENT_MISMATCH' using errcode = '42501';
    end if;
  end if;

  if invitation_row.status in ('accepted', 'declined') then
    if invitation_row.invited_account_id = current_account_id
       and invitation_row.status = response_status then
      idempotent_replay := true;
    else
      raise exception 'INVITATION_ALREADY_RESPONDED';
    end if;
  elsif invitation_row.status = 'revoked' then
    raise exception 'INVITATION_REVOKED';
  elsif invitation_row.status = 'expired'
        or invitation_row.expires_at <= now() then
    raise exception 'INVITATION_EXPIRED';
  elsif invitation_row.status not in ('pending', 'viewed') then
    raise exception 'INVITATION_UNAVAILABLE';
  else
    update hearthland.invitations
    set invited_account_id = current_account_id,
        status = response_status,
        accepted_by_account_id = case
          when response_status = 'accepted' then current_account_id
          else null
        end,
        viewed_at = coalesce(viewed_at, now()),
        responded_at = now()
    where id = invitation_row.id
    returning * into invitation_row;
  end if;

  select e.slug, e.entity_type into target_slug, target_entity_type
  from hearthland.entities e
  where e.id = invitation_row.entity_id;

  return jsonb_build_object(
    'invitation_id', invitation_row.id,
    'status', invitation_row.status,
    'entity_id', invitation_row.entity_id,
    'entity_slug', target_slug,
    'entity_type', target_entity_type,
    'invitation_type', invitation_row.invitation_type,
    'proposed_role', invitation_row.proposed_role,
    'membership_role', invitation_row.membership_role,
    'role_title', invitation_row.role_title,
    'responded_at', invitation_row.responded_at,
    'idempotent_replay', idempotent_replay
  );
end;
$$;

create or replace function hearthland.revoke_invitation(target_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  invitation_row hearthland.invitations%rowtype;
  idempotent_replay boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  select i.* into invitation_row
  from hearthland.invitations i
  where i.id = target_invitation_id
  for update;

  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not hearthland_private.can_manage_entity(invitation_row.entity_id) then
    raise exception 'INVITATION_MANAGER_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  if invitation_row.status = 'revoked' then
    idempotent_replay := true;
  elsif invitation_row.status in ('pending', 'viewed') then
    update hearthland.invitations
    set status = 'revoked', responded_at = coalesce(responded_at, now())
    where id = invitation_row.id
    returning * into invitation_row;
  else
    raise exception 'INVITATION_CANNOT_BE_REVOKED';
  end if;

  return jsonb_build_object(
    'invitation_id', invitation_row.id,
    'status', invitation_row.status,
    'responded_at', invitation_row.responded_at,
    'idempotent_replay', idempotent_replay
  );
end;
$$;

create or replace function hearthland.start_context_conversation(
  context_kind text,
  context_locator text,
  initial_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  current_email text := lower(nullif((select auth.jwt()) ->> 'email', ''));
  normalized_kind text := lower(btrim(coalesce(context_kind, '')));
  normalized_locator text := btrim(coalesce(context_locator, ''));
  message_body text := btrim(coalesce(initial_message, ''));
  locator_id uuid;
  counterpart_account_id uuid;
  applicant_account_id uuid;
  target_entity_id uuid;
  target_record_id uuid;
  target_record_type text;
  resolved_conversation_kind text;
  pair_key text;
  resolved_conversation_id uuid;
  conversation_created boolean := false;
  caller_member_role text := 'participant';
  counterpart_member_role text := 'participant';
  needs_entity_manager boolean := false;
  invitation_row hearthland.invitations%rowtype;
  message_created_at timestamptz;
begin
  if current_account_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if length(message_body) not between 1 and 10000 then
    raise exception 'MESSAGE_LENGTH_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if normalized_kind not in (
    'direct', 'invitation', 'camp_application',
    'project_participation', 'project'
  ) then
    raise exception 'UNSUPPORTED_CONVERSATION_CONTEXT' using errcode = '22023';
  end if;

  if normalized_kind = 'invitation' then
    if normalized_locator ~ '^[A-Za-z0-9_-]{43}$' then
      select i.* into invitation_row
      from hearthland.invitations i
      where i.token_hash = hearthland_private.hash_invitation_token(
        normalized_locator
      )
      for update;
    elsif normalized_locator ~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
      || '[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      select i.* into invitation_row
      from hearthland.invitations i
      where i.id = normalized_locator::uuid
        and i.recipient_mode = 'account'
        and (
          i.invited_account_id = current_account_id
          or i.invited_by_account_id = current_account_id
        )
      for update;
    else
      raise exception 'CONVERSATION_CONTEXT_NOT_FOUND' using errcode = 'P0002';
    end if;

    if not found
       or invitation_row.status not in ('pending', 'viewed', 'accepted')
       or (
         invitation_row.status in ('pending', 'viewed')
         and invitation_row.expires_at <= now()
       ) then
      raise exception 'CONVERSATION_CONTEXT_NOT_FOUND' using errcode = 'P0002';
    end if;

    if invitation_row.invited_by_account_id = current_account_id then
      if invitation_row.invited_account_id is null then
        raise exception 'CONVERSATION_NOT_ALLOWED' using errcode = '42501';
      end if;
      counterpart_account_id := invitation_row.invited_account_id;
      caller_member_role := 'manager';
    elsif invitation_row.invited_account_id = current_account_id then
      counterpart_account_id := invitation_row.invited_by_account_id;
      counterpart_member_role := 'manager';
    elsif invitation_row.invited_account_id is null
          and invitation_row.recipient_mode = 'email'
          and current_email is not null
          and current_email = lower(invitation_row.invited_email) then
      update hearthland.invitations
      set invited_account_id = current_account_id,
          updated_at = now()
      where id = invitation_row.id
      returning * into invitation_row;
      counterpart_account_id := invitation_row.invited_by_account_id;
      counterpart_member_role := 'manager';
    else
      raise exception 'CONVERSATION_NOT_ALLOWED'
        using errcode = '42501';
    end if;

    target_entity_id := invitation_row.entity_id;
    target_record_id := invitation_row.id;
    target_record_type := 'invitation';
    resolved_conversation_kind := 'invitation';
  else
    if normalized_locator !~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
      || '[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'CONVERSATION_CONTEXT_NOT_FOUND' using errcode = 'P0002';
    end if;
    locator_id := normalized_locator::uuid;

    if normalized_kind = 'direct' then
      select a.id into counterpart_account_id
      from hearthland.accounts a
      join hearthland.person_profiles pp on pp.account_id = a.id
      where a.id = locator_id
        and a.account_status = 'active'
        and a.archived_at is null
        and pp.archived_at is null
        and hearthland_private.can_view_profile(pp.entity_id)
        and (
          pp.allow_connection_requests
          or hearthland_private.is_connected_with(a.id)
        );
      if counterpart_account_id is null then
        raise exception 'CONVERSATION_CONTEXT_NOT_FOUND' using errcode = 'P0002';
      end if;
      resolved_conversation_kind := 'direct';

    elsif normalized_kind = 'camp_application' then
      select ca.camp_entity_id, ca.applicant_account_id
      into target_entity_id, applicant_account_id
      from hearthland.camp_applications ca
      where ca.id = locator_id
        and ca.archived_at is null;
      if target_entity_id is null then
        raise exception 'CONVERSATION_CONTEXT_NOT_FOUND' using errcode = 'P0002';
      end if;
      if applicant_account_id = current_account_id then
        needs_entity_manager := true;
        caller_member_role := 'participant';
        counterpart_member_role := 'manager';
      elsif hearthland_private.can_manage_entity(target_entity_id) then
        counterpart_account_id := applicant_account_id;
        caller_member_role := 'manager';
      else
        raise exception 'CONVERSATION_NOT_ALLOWED'
          using errcode = '42501';
      end if;
      target_record_id := locator_id;
      target_record_type := 'camp_application';
      resolved_conversation_kind := 'camp_application';

    elsif normalized_kind = 'project_participation' then
      select pr.project_entity_id, pr.applicant_account_id
      into target_entity_id, applicant_account_id
      from hearthland.project_participation_requests pr
      where pr.id = locator_id
        and pr.archived_at is null;
      if target_entity_id is null then
        raise exception 'CONVERSATION_CONTEXT_NOT_FOUND' using errcode = 'P0002';
      end if;
      if applicant_account_id = current_account_id then
        needs_entity_manager := true;
        caller_member_role := 'participant';
        counterpart_member_role := 'manager';
      elsif hearthland_private.can_manage_entity(target_entity_id) then
        counterpart_account_id := applicant_account_id;
        caller_member_role := 'manager';
      else
        raise exception 'CONVERSATION_NOT_ALLOWED'
          using errcode = '42501';
      end if;
      target_record_id := locator_id;
      target_record_type := 'project_participation';
      resolved_conversation_kind := 'project_participation';

    else
      select e.id into target_entity_id
      from hearthland.entities e
      join hearthland.settlement_projects sp on sp.entity_id = e.id
      where e.id = locator_id
        and e.entity_type = 'settlement_project'
        and e.publication_status = 'published'
        and e.visibility = 'public'
        and e.archived_at is null;
      if target_entity_id is null then
        raise exception 'CONVERSATION_CONTEXT_NOT_FOUND' using errcode = 'P0002';
      end if;
      needs_entity_manager := true;
      counterpart_member_role := 'manager';
      target_record_id := locator_id;
      target_record_type := 'settlement_project';
      resolved_conversation_kind := 'project_contact';
    end if;
  end if;

  if needs_entity_manager then
    select manager.account_id into counterpart_account_id
    from (
      select
        e.owner_account_id as account_id,
        0 as role_priority,
        e.created_at as granted_at
      from hearthland.entities e
      join hearthland.accounts a on a.id = e.owner_account_id
      where e.id = target_entity_id
        and e.owner_account_id is not null
        and a.account_status = 'active'
        and a.archived_at is null
      union all
      select
        er.account_id,
        case er.role when 'owner' then 1 else 2 end as role_priority,
        er.created_at as granted_at
      from hearthland.entity_roles er
      join hearthland.accounts a on a.id = er.account_id
      where er.entity_id = target_entity_id
        and er.role in ('owner', 'administrator')
        and er.status = 'active'
        and a.account_status = 'active'
        and a.archived_at is null
    ) manager
    where manager.account_id <> current_account_id
    order by manager.role_priority, manager.granted_at, manager.account_id
    limit 1;
  end if;

  if counterpart_account_id is null or counterpart_account_id = current_account_id then
    raise exception 'CONVERSATION_NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from hearthland.accounts a
    where a.id = counterpart_account_id
      and a.account_status = 'active'
      and a.archived_at is null
  ) then
    raise exception 'CONVERSATION_NOT_ALLOWED' using errcode = '42501';
  end if;
  if hearthland_private.is_blocked_with(counterpart_account_id) then
    raise exception 'CONVERSATION_NOT_ALLOWED' using errcode = '42501';
  end if;

  pair_key := least(current_account_id::text, counterpart_account_id::text)
    || ':' || greatest(current_account_id::text, counterpart_account_id::text);

  perform pg_advisory_xact_lock(
    hashtextextended(
      'hearthland.start_context_conversation|'
      || resolved_conversation_kind || '|'
      || coalesce(target_record_id::text, '') || '|'
      || pair_key,
      0
    )
  );

  if resolved_conversation_kind = 'direct' then
    select c.id into resolved_conversation_id
    from hearthland.conversations c
    where c.conversation_kind = 'direct'
      and c.direct_pair_key = pair_key
      and c.archived_at is null
    for update;
  else
    select c.id into resolved_conversation_id
    from hearthland.conversations c
    where c.conversation_kind = resolved_conversation_kind
      and c.context_record_type = target_record_type
      and c.context_record_id = target_record_id
      and c.direct_pair_key = pair_key
      and c.archived_at is null
    for update;
  end if;

  if resolved_conversation_id is null then
    insert into hearthland.conversations (
      conversation_kind,
      context_entity_id,
      context_record_type,
      context_record_id,
      direct_pair_key,
      subject,
      created_by_account_id
    ) values (
      resolved_conversation_kind,
      target_entity_id,
      target_record_type,
      target_record_id,
      pair_key,
      case resolved_conversation_kind
        when 'invitation' then 'Hearthland invitation'
        when 'camp_application' then 'Building Camp application'
        when 'project_participation' then 'Project participation'
        when 'project_contact' then 'Settlement Project enquiry'
        else null
      end,
      current_account_id
    )
    returning id into resolved_conversation_id;
    conversation_created := true;
  end if;

  insert into hearthland.conversation_members (
    conversation_id,
    account_id,
    member_role,
    left_at
  ) values
    (
      resolved_conversation_id,
      current_account_id,
      caller_member_role,
      null
    ),
    (
      resolved_conversation_id,
      counterpart_account_id,
      counterpart_member_role,
      null
    )
  on conflict (conversation_id, account_id) do update
  set member_role = excluded.member_role,
      left_at = null;

  insert into hearthland.messages (
    conversation_id,
    sender_account_id,
    body
  ) values (
    resolved_conversation_id,
    current_account_id,
    message_body
  )
  returning created_at into message_created_at;

  update hearthland.conversations
  set last_message_at = message_created_at,
      updated_at = message_created_at
  where id = resolved_conversation_id;

  return jsonb_build_object(
    'conversation_id', resolved_conversation_id,
    'created', conversation_created,
    'conversation_kind', resolved_conversation_kind,
    'context_entity_id', target_entity_id,
    'context_record_id', target_record_id
  );
end;
$$;

revoke all on function hearthland.create_invitation(jsonb)
  from public, anon;
grant execute on function hearthland.create_invitation(jsonb)
  to authenticated;
revoke all on function hearthland.get_invitation_preview(text)
  from public;
grant execute on function hearthland.get_invitation_preview(text)
  to anon, authenticated;
revoke all on function hearthland.respond_to_invitation(text, text)
  from public, anon;
grant execute on function hearthland.respond_to_invitation(text, text)
  to authenticated;
revoke all on function hearthland.revoke_invitation(uuid)
  from public, anon;
grant execute on function hearthland.revoke_invitation(uuid)
  to authenticated;
revoke all on function hearthland.start_context_conversation(text, text, text)
  from public, anon;
grant execute on function hearthland.start_context_conversation(text, text, text)
  to authenticated;

-- Extend the existing atomic profile-save entrypoint instead of introducing a
-- second Master profile writer. Omitted fields retain their current values;
-- `topics`, when supplied, replaces the caller's teaching-topic links.
alter function hearthland.save_my_profile(jsonb)
  rename to save_my_profile_t3_3_v2;
alter function hearthland.save_my_profile_t3_3_v2(jsonb)
  set schema hearthland_private;
revoke all on function hearthland_private.save_my_profile_t3_3_v2(jsonb)
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
  teaching_payload jsonb;
  topic_item jsonb;
  topic_entity_id uuid;
  saved_profile jsonb;
  saved_teaching_profile jsonb;
begin
  if current_account_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  if payload ? 'teaching_profile'
     and jsonb_typeof(payload -> 'teaching_profile') <> 'object' then
    raise exception 'teaching_profile must be an object';
  end if;

  -- The verified T3.3 saver remains authoritative for all existing profile,
  -- location, contact, intention, skill, value, and preference fields.
  saved_profile := hearthland_private.save_my_profile_t3_3_v2(payload);

  select pp.entity_id into profile_id
  from hearthland.person_profiles pp
  where pp.account_id = current_account_id;

  if profile_id is null then
    raise exception 'Hearthland profile was not initialized for this account';
  end if;

  if payload ? 'teaching_profile' then
    teaching_payload := payload -> 'teaching_profile';

    if teaching_payload ? 'is_available'
       and jsonb_typeof(teaching_payload -> 'is_available') <> 'boolean' then
      raise exception 'teaching_profile.is_available must be boolean';
    end if;
    if teaching_payload ? 'teaching_mode'
       and teaching_payload ->> 'teaching_mode' not in (
         'practical', 'theoretical', 'both'
       ) then
      raise exception 'Invalid teaching_profile.teaching_mode';
    end if;
    if teaching_payload ? 'travel_scope'
       and teaching_payload ->> 'travel_scope' not in (
         'local', 'selected_countries', 'europe', 'international', 'online'
       ) then
      raise exception 'Invalid teaching_profile.travel_scope';
    end if;

    if (teaching_payload ? 'selected_countries'
        and jsonb_typeof(teaching_payload -> 'selected_countries') <> 'array')
       or (teaching_payload ? 'travel_regions'
        and jsonb_typeof(teaching_payload -> 'travel_regions') <> 'array')
       or (teaching_payload ? 'languages'
        and jsonb_typeof(teaching_payload -> 'languages') <> 'array')
       or (teaching_payload ? 'professional_arrangements'
        and jsonb_typeof(teaching_payload -> 'professional_arrangements') <> 'array')
       or (teaching_payload ? 'portfolio_links'
        and jsonb_typeof(teaching_payload -> 'portfolio_links') <> 'array')
       or (teaching_payload ? 'topics'
        and jsonb_typeof(teaching_payload -> 'topics') <> 'array') then
      raise exception 'Teaching profile list fields must be arrays';
    end if;

    if teaching_payload ? 'professional_arrangements' and exists (
      select 1
      from jsonb_array_elements_text(
        teaching_payload -> 'professional_arrangements'
      ) arrangement(value)
      where arrangement.value not in (
        'volunteer', 'expenses', 'paid', 'donation_based', 'discuss'
      )
    ) then
      raise exception 'Invalid teaching_profile.professional_arrangements value';
    end if;

    insert into hearthland.teaching_profiles (
      profile_entity_id,
      is_available,
      teaching_bio,
      teaching_mode,
      teaching_formats,
      travel_scope,
      selected_countries,
      travel_regions,
      languages,
      availability,
      professional_arrangements,
      arrangement_notes,
      portfolio_links
    ) values (
      profile_id,
      coalesce((teaching_payload ->> 'is_available')::boolean, false),
      coalesce(teaching_payload ->> 'teaching_bio', ''),
      coalesce(teaching_payload ->> 'teaching_mode', 'both'),
      case
        when teaching_payload ? 'teaching_mode' then
          case teaching_payload ->> 'teaching_mode'
            when 'practical' then array['practical']::text[]
            when 'theoretical' then array['theoretical']::text[]
            else array['practical', 'theoretical']::text[]
          end
        else '{}'::text[]
      end,
      coalesce(teaching_payload ->> 'travel_scope', 'local'),
      case when teaching_payload ? 'selected_countries'
        then array(
          select jsonb_array_elements_text(
            teaching_payload -> 'selected_countries'
          )
        )
        else '{}'::text[] end,
      case when teaching_payload ? 'travel_regions'
        then array(
          select jsonb_array_elements_text(teaching_payload -> 'travel_regions')
        )
        else '{}'::text[] end,
      case when teaching_payload ? 'languages'
        then array(
          select jsonb_array_elements_text(teaching_payload -> 'languages')
        )
        else '{}'::text[] end,
      nullif(teaching_payload ->> 'availability', ''),
      case when teaching_payload ? 'professional_arrangements'
        then array(
          select jsonb_array_elements_text(
            teaching_payload -> 'professional_arrangements'
          )
        )
        else '{}'::text[] end,
      coalesce(teaching_payload ->> 'arrangement_notes', ''),
      coalesce(teaching_payload -> 'portfolio_links', '[]'::jsonb)
    )
    on conflict (profile_entity_id) do update
    set is_available = case when teaching_payload ? 'is_available'
          then excluded.is_available else hearthland.teaching_profiles.is_available end,
        teaching_bio = case when teaching_payload ? 'teaching_bio'
          then excluded.teaching_bio else hearthland.teaching_profiles.teaching_bio end,
        teaching_mode = case when teaching_payload ? 'teaching_mode'
          then excluded.teaching_mode else hearthland.teaching_profiles.teaching_mode end,
        teaching_formats = case when teaching_payload ? 'teaching_mode'
          then excluded.teaching_formats else hearthland.teaching_profiles.teaching_formats end,
        travel_scope = case when teaching_payload ? 'travel_scope'
          then excluded.travel_scope else hearthland.teaching_profiles.travel_scope end,
        selected_countries = case when teaching_payload ? 'selected_countries'
          then excluded.selected_countries else hearthland.teaching_profiles.selected_countries end,
        travel_regions = case when teaching_payload ? 'travel_regions'
          then excluded.travel_regions else hearthland.teaching_profiles.travel_regions end,
        languages = case when teaching_payload ? 'languages'
          then excluded.languages else hearthland.teaching_profiles.languages end,
        availability = case when teaching_payload ? 'availability'
          then excluded.availability else hearthland.teaching_profiles.availability end,
        professional_arrangements = case
          when teaching_payload ? 'professional_arrangements'
            then excluded.professional_arrangements
          else hearthland.teaching_profiles.professional_arrangements end,
        arrangement_notes = case when teaching_payload ? 'arrangement_notes'
          then excluded.arrangement_notes else hearthland.teaching_profiles.arrangement_notes end,
        portfolio_links = case when teaching_payload ? 'portfolio_links'
          then excluded.portfolio_links else hearthland.teaching_profiles.portfolio_links end,
        updated_at = now();

    if teaching_payload ? 'topics' then
      delete from hearthland.profile_teaching_topics ptt
      where ptt.profile_entity_id = profile_id;

      for topic_item in
        select value from jsonb_array_elements(teaching_payload -> 'topics')
      loop
        if jsonb_typeof(topic_item) <> 'object'
           or nullif(topic_item ->> 'learning_topic_entity_id', '') is null then
          raise exception 'Each teaching topic requires learning_topic_entity_id';
        end if;
        if coalesce(topic_item ->> 'teaching_type', 'both') not in (
          'practical', 'theoretical', 'both'
        ) then
          raise exception 'Invalid teaching topic teaching_type';
        end if;

        topic_entity_id := (topic_item ->> 'learning_topic_entity_id')::uuid;
        if not exists (
          select 1
          from hearthland.entities e
          where e.id = topic_entity_id
            and e.entity_type = 'learning_topic'
            and e.publication_status = 'published'
            and e.archived_at is null
        ) then
          raise exception 'Teaching topic is unavailable' using errcode = 'P0002';
        end if;

        insert into hearthland.profile_teaching_topics (
          profile_entity_id,
          learning_topic_entity_id,
          teaching_type,
          notes
        ) values (
          profile_id,
          topic_entity_id,
          coalesce(topic_item ->> 'teaching_type', 'both'),
          coalesce(topic_item ->> 'notes', '')
        );
      end loop;
    end if;
  end if;

  select jsonb_build_object(
    'is_available', tp.is_available,
    'teaching_bio', tp.teaching_bio,
    'teaching_mode', tp.teaching_mode,
    'travel_scope', tp.travel_scope,
    'selected_countries', tp.selected_countries,
    'travel_regions', tp.travel_regions,
    'languages', tp.languages,
    'availability', tp.availability,
    'professional_arrangements', tp.professional_arrangements,
    'arrangement_notes', tp.arrangement_notes,
    'portfolio_links', tp.portfolio_links,
    'topics', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'learning_topic_entity_id', ptt.learning_topic_entity_id,
          'teaching_type', ptt.teaching_type,
          'notes', ptt.notes
        ) order by e.title
      )
      from hearthland.profile_teaching_topics ptt
      join hearthland.entities e on e.id = ptt.learning_topic_entity_id
      where ptt.profile_entity_id = profile_id
    ), '[]'::jsonb)
  ) into saved_teaching_profile
  from hearthland.teaching_profiles tp
  where tp.profile_entity_id = profile_id;

  return saved_profile || jsonb_build_object(
    'teaching_profile', saved_teaching_profile
  );
end;
$$;

revoke all on function hearthland.save_my_profile(jsonb)
  from public, anon;
grant execute on function hearthland.save_my_profile(jsonb)
  to authenticated;

-- Public Master discovery is deliberately projected through fixed, sanitized
-- RPCs. The base tables contain private availability and arrangement details
-- and are readable only by the profile owner or platform staff below.
create or replace function hearthland.get_public_teaching_profiles()
returns table (
  profile_entity_id uuid,
  is_available boolean,
  teaching_bio text,
  teaching_formats text[],
  teaching_mode text,
  travel_scope text,
  selected_countries text[],
  travel_regions text[],
  languages text[],
  portfolio_links jsonb
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    tp.profile_entity_id,
    tp.is_available,
    tp.teaching_bio,
    tp.teaching_formats,
    tp.teaching_mode,
    tp.travel_scope,
    tp.selected_countries,
    tp.travel_regions,
    tp.languages,
    tp.portfolio_links
  from hearthland.teaching_profiles tp
  join hearthland.person_profiles pp
    on pp.entity_id = tp.profile_entity_id
  join hearthland.entities e
    on e.id = tp.profile_entity_id
  where tp.is_available
    and pp.discoverable
    and pp.archived_at is null
    and e.entity_type = 'person_profile'
    and e.publication_status = 'published'
    and e.visibility = 'public'
    and e.archived_at is null
    and hearthland_private.can_view_profile(tp.profile_entity_id);
$$;

create or replace function hearthland.get_public_teaching_topics()
returns table (
  profile_entity_id uuid,
  learning_topic_entity_id uuid,
  teaching_type text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    ptt.profile_entity_id,
    ptt.learning_topic_entity_id,
    ptt.teaching_type
  from hearthland.profile_teaching_topics ptt
  join hearthland.teaching_profiles tp
    on tp.profile_entity_id = ptt.profile_entity_id
  join hearthland.person_profiles pp
    on pp.entity_id = ptt.profile_entity_id
  join hearthland.entities profile_entity
    on profile_entity.id = ptt.profile_entity_id
  join hearthland.entities topic_entity
    on topic_entity.id = ptt.learning_topic_entity_id
  where tp.is_available
    and pp.discoverable
    and pp.archived_at is null
    and profile_entity.entity_type = 'person_profile'
    and profile_entity.publication_status = 'published'
    and profile_entity.visibility = 'public'
    and profile_entity.archived_at is null
    and topic_entity.entity_type = 'learning_topic'
    and topic_entity.publication_status = 'published'
    and topic_entity.archived_at is null
    and hearthland_private.can_view_profile(ptt.profile_entity_id);
$$;

create or replace function hearthland.get_public_person_skills()
returns table (
  id uuid,
  profile_entity_id uuid,
  skill_id uuid,
  experience_level text,
  years_experience numeric,
  can_teach boolean,
  practical_workshops boolean,
  theoretical_sessions boolean,
  willing_to_contribute boolean
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    ps.id,
    ps.profile_entity_id,
    ps.skill_id,
    ps.experience_level,
    ps.years_experience,
    (
      coalesce(tp.is_available, false)
      and ps.can_teach
    ) as can_teach,
    (
      coalesce(tp.is_available, false)
      and ps.can_teach
      and ps.practical_workshops
    ) as practical_workshops,
    (
      coalesce(tp.is_available, false)
      and ps.can_teach
      and ps.theoretical_sessions
    ) as theoretical_sessions,
    ps.willing_to_contribute
  from hearthland.person_skills ps
  join hearthland.person_profiles pp
    on pp.entity_id = ps.profile_entity_id
  join hearthland.entities e
    on e.id = ps.profile_entity_id
  left join hearthland.teaching_profiles tp
    on tp.profile_entity_id = ps.profile_entity_id
  where pp.discoverable
    and pp.archived_at is null
    and e.entity_type = 'person_profile'
    and e.publication_status = 'published'
    and e.visibility = 'public'
    and e.archived_at is null
    and hearthland_private.can_view_profile(ps.profile_entity_id);
$$;

revoke all on function hearthland.get_public_teaching_profiles()
  from public, anon, authenticated;
grant execute on function hearthland.get_public_teaching_profiles()
  to anon, authenticated, service_role;
revoke all on function hearthland.get_public_teaching_topics()
  from public, anon, authenticated;
grant execute on function hearthland.get_public_teaching_topics()
  to anon, authenticated, service_role;
revoke all on function hearthland.get_public_person_skills()
  from public, anon, authenticated;
grant execute on function hearthland.get_public_person_skills()
  to anon, authenticated, service_role;

comment on function hearthland.get_public_teaching_profiles() is
  'Public Master directory projection. Omits availability, compensation, professional arrangements, arrangement notes, and other private profile fields.';
comment on function hearthland.get_public_teaching_topics() is
  'Public Master topic projection. Omits private teaching-topic notes.';
comment on function hearthland.get_public_person_skills() is
  'Public profile skill projection. Teaching flags are visible only while the profile is publicly available as a Master.';

-- ---------------------------------------------------------------------------
-- Data API grants and Row Level Security
-- ---------------------------------------------------------------------------

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profile_teaching_topics',
    'learning_topic_interests',
    'pilot_projects',
    'camp_participants',
    'camp_application_contributions',
    'camp_build_item_media',
    'camp_announcements',
    'camp_preparation_sections',
    'camp_results',
    'community_working_groups',
    'working_group_members',
    'community_meetings',
    'community_meeting_attendees',
    'community_decisions',
    'community_pulse_cycles',
    'community_pulse_responses',
    'feedback_submissions',
    'early_user_cohorts',
    'project_participation_requests'
  ]
  loop
    execute format('alter table hearthland.%I enable row level security', target_table);
    execute format(
      'drop policy if exists active_authenticated_account_gate on hearthland.%I',
      target_table
    );
    execute format(
      'create policy active_authenticated_account_gate on hearthland.%I '
      'as restrictive for all to authenticated '
      'using ((select hearthland_private.current_account_is_active())) '
      'with check ((select hearthland_private.current_account_is_active()))',
      target_table
    );
  end loop;
end;
$$;

revoke all on table
  hearthland.profile_teaching_topics,
  hearthland.learning_topic_interests,
  hearthland.pilot_projects,
  hearthland.camp_participants,
  hearthland.camp_application_contributions,
  hearthland.camp_build_item_media,
  hearthland.camp_announcements,
  hearthland.camp_preparation_sections,
  hearthland.camp_results,
  hearthland.community_working_groups,
  hearthland.working_group_members,
  hearthland.community_meetings,
  hearthland.community_meeting_attendees,
  hearthland.community_decisions,
  hearthland.community_pulse_cycles,
  hearthland.community_pulse_responses,
  hearthland.feedback_submissions,
  hearthland.early_user_cohorts,
  hearthland.project_participation_requests
from anon, authenticated;

grant all on table
  hearthland.profile_teaching_topics,
  hearthland.learning_topic_interests,
  hearthland.pilot_projects,
  hearthland.camp_participants,
  hearthland.camp_application_contributions,
  hearthland.camp_build_item_media,
  hearthland.camp_announcements,
  hearthland.camp_preparation_sections,
  hearthland.camp_results,
  hearthland.community_working_groups,
  hearthland.working_group_members,
  hearthland.community_meetings,
  hearthland.community_meeting_attendees,
  hearthland.community_decisions,
  hearthland.community_pulse_cycles,
  hearthland.community_pulse_responses,
  hearthland.feedback_submissions,
  hearthland.early_user_cohorts,
  hearthland.project_participation_requests
to service_role;

grant select on table
  hearthland.profile_teaching_topics,
  hearthland.pilot_projects,
  hearthland.camp_build_item_media,
  hearthland.camp_announcements,
  hearthland.camp_preparation_sections,
  hearthland.camp_results
to anon;
grant insert on hearthland.feedback_submissions to anon;

grant select on table
  hearthland.profile_teaching_topics,
  hearthland.learning_topic_interests,
  hearthland.pilot_projects,
  hearthland.camp_participants,
  hearthland.camp_application_contributions,
  hearthland.camp_build_item_media,
  hearthland.camp_announcements,
  hearthland.camp_preparation_sections,
  hearthland.camp_results,
  hearthland.community_working_groups,
  hearthland.working_group_members,
  hearthland.community_meetings,
  hearthland.community_meeting_attendees,
  hearthland.community_decisions,
  hearthland.community_pulse_cycles,
  hearthland.community_pulse_responses,
  hearthland.feedback_submissions,
  hearthland.early_user_cohorts,
  hearthland.project_participation_requests
to authenticated;

grant insert, update, delete on table
  hearthland.profile_teaching_topics,
  hearthland.learning_topic_interests,
  hearthland.pilot_projects,
  hearthland.camp_participants,
  hearthland.camp_application_contributions,
  hearthland.camp_build_item_media,
  hearthland.camp_announcements,
  hearthland.camp_preparation_sections,
  hearthland.camp_results,
  hearthland.community_working_groups,
  hearthland.working_group_members,
  hearthland.community_meetings,
  hearthland.community_meeting_attendees,
  hearthland.community_decisions,
  hearthland.community_pulse_cycles,
  hearthland.community_pulse_responses,
  hearthland.early_user_cohorts
to authenticated;
grant insert, update on hearthland.feedback_submissions to authenticated;
grant insert, update on hearthland.project_participation_requests to authenticated;

-- Invitations are now writable only through the token-safe RPCs.
revoke insert, update, delete on hearthland.invitations from authenticated;

-- Application bodies and identities are immutable after submission. The
-- applicant/manager RLS policies and guard_application_update trigger still
-- decide which status transitions are allowed, while column grants prevent a
-- status update from smuggling arbitrary content or ownership changes.
revoke update on hearthland.opportunity_applications from authenticated;
revoke update on hearthland.community_interests from authenticated;
revoke update on hearthland.camp_applications from authenticated;
grant update (status) on hearthland.opportunity_applications to authenticated;
grant update (pipeline_status) on hearthland.community_interests to authenticated;
grant update (status) on hearthland.camp_applications to authenticated;

-- Conversation membership must be established atomically by the hardened
-- context RPC. Authenticated members may still send messages under the T3.3
-- membership/block RLS policy and update their own read state.
revoke insert on hearthland.conversations from authenticated;
revoke update on hearthland.conversations from authenticated;
revoke insert on hearthland.conversation_members from authenticated;
revoke update on hearthland.conversation_members from authenticated;
grant update (last_read_at, muted_at, left_at)
on hearthland.conversation_members to authenticated;

drop policy if exists conversation_members_update
  on hearthland.conversation_members;
create policy conversation_members_update
on hearthland.conversation_members
for update to authenticated
using (account_id = (select auth.uid()))
with check (account_id = (select auth.uid()));

create or replace function hearthland_private.guard_conversation_member_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and (
       new.conversation_id is distinct from old.conversation_id
       or new.account_id is distinct from old.account_id
       or new.member_role is distinct from old.member_role
       or new.joined_at is distinct from old.joined_at
     ) then
    raise exception 'Conversation membership identity is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_t3_4_conversation_member_identity
before update on hearthland.conversation_members
for each row execute function hearthland_private.guard_conversation_member_identity();

drop policy if exists profile_data_select on hearthland.teaching_profiles;
drop policy if exists teaching_profiles_owner_staff_select
  on hearthland.teaching_profiles;
create policy teaching_profiles_owner_staff_select
on hearthland.teaching_profiles
for select to authenticated
using (
  hearthland_private.owns_entity(profile_entity_id)
  or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
);

drop policy if exists profile_data_select on hearthland.person_skills;
drop policy if exists person_skills_owner_staff_select
  on hearthland.person_skills;
create policy person_skills_owner_staff_select
on hearthland.person_skills
for select to authenticated
using (
  hearthland_private.owns_entity(profile_entity_id)
  or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
);

drop policy if exists profile_teaching_topics_select
  on hearthland.profile_teaching_topics;
create policy profile_teaching_topics_select
on hearthland.profile_teaching_topics
for select to authenticated
using (
  hearthland_private.owns_entity(profile_entity_id)
  or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
);

create policy profile_teaching_topics_insert
on hearthland.profile_teaching_topics
for insert to authenticated
with check (hearthland_private.owns_entity(profile_entity_id));
create policy profile_teaching_topics_update
on hearthland.profile_teaching_topics
for update to authenticated
using (hearthland_private.owns_entity(profile_entity_id))
with check (hearthland_private.owns_entity(profile_entity_id));
create policy profile_teaching_topics_delete
on hearthland.profile_teaching_topics
for delete to authenticated
using (hearthland_private.owns_entity(profile_entity_id));

create policy learning_topic_interests_select
on hearthland.learning_topic_interests
for select to authenticated
using (account_id = (select auth.uid()));
create policy learning_topic_interests_insert
on hearthland.learning_topic_interests
for insert to authenticated
with check (
  account_id = (select auth.uid())
  and exists (
    select 1
    from hearthland.entities e
    where e.id = learning_topic_entity_id
      and e.entity_type = 'learning_topic'
      and e.publication_status = 'published'
      and e.archived_at is null
  )
);
create policy learning_topic_interests_delete
on hearthland.learning_topic_interests
for delete to authenticated
using (account_id = (select auth.uid()));
create policy learning_topic_interests_update
on hearthland.learning_topic_interests
for update to authenticated
using (account_id = (select auth.uid()))
with check (
  account_id = (select auth.uid())
  and exists (
    select 1
    from hearthland.entities e
    where e.id = learning_topic_entity_id
      and e.entity_type = 'learning_topic'
      and e.publication_status = 'published'
      and e.archived_at is null
  )
);

create policy pilot_projects_select
on hearthland.pilot_projects
for select to anon, authenticated
using (
  (
    pilot_status in ('active', 'completed')
    and hearthland_private.can_view_entity(project_entity_id)
  )
  or hearthland_private.can_manage_entity(project_entity_id)
  or hearthland_private.is_platform_staff(array['admin']::text[])
);
create policy pilot_projects_insert
on hearthland.pilot_projects
for insert to authenticated
with check (
  designated_by_account_id = (select auth.uid())
  and hearthland_private.is_platform_staff(array['admin']::text[])
);
create policy pilot_projects_update
on hearthland.pilot_projects
for update to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]))
with check (hearthland_private.is_platform_staff(array['admin']::text[]));
create policy pilot_projects_delete
on hearthland.pilot_projects
for delete to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]));

create policy camp_participants_select
on hearthland.camp_participants
for select to authenticated
using (
  account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(camp_entity_id)
);
create policy camp_participants_insert
on hearthland.camp_participants
for insert to authenticated
with check (hearthland_private.can_manage_entity(camp_entity_id));
create policy camp_participants_update
on hearthland.camp_participants
for update to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id))
with check (hearthland_private.can_manage_entity(camp_entity_id));
revoke delete on hearthland.camp_participants from authenticated;

create policy camp_application_contributions_select
on hearthland.camp_application_contributions
for select to authenticated
using (
  exists (
    select 1
    from hearthland.camp_applications ca
    where ca.id = application_id
      and (
        ca.applicant_account_id = (select auth.uid())
        or hearthland_private.can_manage_entity(ca.camp_entity_id)
      )
  )
);
create policy camp_application_contributions_insert
on hearthland.camp_application_contributions
for insert to authenticated
with check (
  exists (
    select 1
    from hearthland.camp_applications ca
    where ca.id = application_id
      and ca.applicant_account_id = (select auth.uid())
      and ca.status in ('new', 'reviewing')
      and ca.archived_at is null
  )
);
create policy camp_application_contributions_update
on hearthland.camp_application_contributions
for update to authenticated
using (
  exists (
    select 1
    from hearthland.camp_applications ca
    where ca.id = application_id
      and ca.applicant_account_id = (select auth.uid())
      and ca.status in ('new', 'reviewing')
      and ca.archived_at is null
  )
)
with check (
  exists (
    select 1
    from hearthland.camp_applications ca
    where ca.id = application_id
      and ca.applicant_account_id = (select auth.uid())
      and ca.status in ('new', 'reviewing')
      and ca.archived_at is null
  )
);
create policy camp_application_contributions_delete
on hearthland.camp_application_contributions
for delete to authenticated
using (
  exists (
    select 1
    from hearthland.camp_applications ca
    where ca.id = application_id
      and ca.applicant_account_id = (select auth.uid())
      and ca.status in ('new', 'reviewing')
      and ca.archived_at is null
  )
);

create policy camp_build_item_media_select
on hearthland.camp_build_item_media
for select to anon, authenticated
using (
  exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_view_entity(bi.camp_entity_id)
  )
);
create policy camp_build_item_media_insert
on hearthland.camp_build_item_media
for insert to authenticated
with check (
  exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
);
create policy camp_build_item_media_update
on hearthland.camp_build_item_media
for update to authenticated
using (
  exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
)
with check (
  exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
);
create policy camp_build_item_media_delete
on hearthland.camp_build_item_media
for delete to authenticated
using (
  exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
);

create policy camp_announcements_select
on hearthland.camp_announcements
for select to anon, authenticated
using (
  archived_at is null
  and (
    (audience = 'public' and hearthland_private.can_view_entity(camp_entity_id))
    or hearthland_private.is_camp_participant(camp_entity_id)
    or hearthland_private.can_manage_entity(camp_entity_id)
  )
);
create policy camp_announcements_insert
on hearthland.camp_announcements
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(camp_entity_id)
);
create policy camp_announcements_update
on hearthland.camp_announcements
for update to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id))
with check (hearthland_private.can_manage_entity(camp_entity_id));
create policy camp_announcements_delete
on hearthland.camp_announcements
for delete to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id));

create policy camp_preparation_sections_select
on hearthland.camp_preparation_sections
for select to anon, authenticated
using (
  (audience = 'public' and hearthland_private.can_view_entity(camp_entity_id))
  or hearthland_private.is_camp_participant(camp_entity_id)
  or hearthland_private.can_manage_entity(camp_entity_id)
);
create policy camp_preparation_sections_insert
on hearthland.camp_preparation_sections
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(camp_entity_id)
);
create policy camp_preparation_sections_update
on hearthland.camp_preparation_sections
for update to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id))
with check (hearthland_private.can_manage_entity(camp_entity_id));
create policy camp_preparation_sections_delete
on hearthland.camp_preparation_sections
for delete to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id));

create policy camp_results_select
on hearthland.camp_results
for select to anon, authenticated
using (
  (
    publication_status = 'published'
    and hearthland_private.can_view_entity(camp_entity_id)
  )
  or hearthland_private.can_manage_entity(camp_entity_id)
);
create policy camp_results_insert
on hearthland.camp_results
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(camp_entity_id)
);
create policy camp_results_update
on hearthland.camp_results
for update to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id))
with check (hearthland_private.can_manage_entity(camp_entity_id));
create policy camp_results_delete
on hearthland.camp_results
for delete to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id));

-- Participant-only programme rows supersede the previous inherited public
-- SELECT policy; manager write policies remain unchanged.
drop policy if exists entity_child_select on hearthland.camp_schedule_items;
create policy camp_schedule_items_select
on hearthland.camp_schedule_items
for select to anon, authenticated
using (
  (audience = 'public' and hearthland_private.can_view_entity(camp_entity_id))
  or hearthland_private.is_camp_participant(camp_entity_id)
  or hearthland_private.can_manage_entity(camp_entity_id)
);

create policy community_working_groups_select
on hearthland.community_working_groups
for select to authenticated
using (
  hearthland_private.is_entity_member(community_entity_id)
  or hearthland_private.can_manage_entity(community_entity_id)
);
create policy community_working_groups_insert
on hearthland.community_working_groups
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(community_entity_id)
);
create policy community_working_groups_update
on hearthland.community_working_groups
for update to authenticated
using (hearthland_private.can_manage_working_group(id))
with check (
  hearthland_private.can_manage_entity(community_entity_id)
  or coordinator_account_id = (select auth.uid())
);
create policy community_working_groups_delete
on hearthland.community_working_groups
for delete to authenticated
using (hearthland_private.can_manage_entity(community_entity_id));

create policy working_group_members_select
on hearthland.working_group_members
for select to authenticated
using (
  account_id = (select auth.uid())
  or hearthland_private.can_manage_working_group(working_group_id)
);
create policy working_group_members_insert
on hearthland.working_group_members
for insert to authenticated
with check (hearthland_private.can_manage_working_group(working_group_id));
create policy working_group_members_update
on hearthland.working_group_members
for update to authenticated
using (hearthland_private.can_manage_working_group(working_group_id))
with check (hearthland_private.can_manage_working_group(working_group_id));
create policy working_group_members_delete
on hearthland.working_group_members
for delete to authenticated
using (hearthland_private.can_manage_working_group(working_group_id));

create policy community_meetings_select
on hearthland.community_meetings
for select to authenticated
using (
  hearthland_private.can_manage_entity(community_entity_id)
  or (
    visibility = 'members'
    and hearthland_private.is_entity_member(community_entity_id)
  )
);
create policy community_meetings_insert
on hearthland.community_meetings
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and (
    hearthland_private.can_manage_entity(community_entity_id)
    or (
      working_group_id is not null
      and hearthland_private.can_manage_working_group(working_group_id)
    )
  )
);
create policy community_meetings_update
on hearthland.community_meetings
for update to authenticated
using (
  hearthland_private.can_manage_entity(community_entity_id)
  or (
    working_group_id is not null
    and hearthland_private.can_manage_working_group(working_group_id)
  )
)
with check (
  hearthland_private.can_manage_entity(community_entity_id)
  or (
    working_group_id is not null
    and hearthland_private.can_manage_working_group(working_group_id)
  )
);
create policy community_meetings_delete
on hearthland.community_meetings
for delete to authenticated
using (
  hearthland_private.can_manage_entity(community_entity_id)
  or (
    working_group_id is not null
    and hearthland_private.can_manage_working_group(working_group_id)
  )
);

create policy community_meeting_attendees_select
on hearthland.community_meeting_attendees
for select to authenticated
using (
  exists (
    select 1
    from hearthland.community_meetings m
    where m.id = meeting_id
      and (
        hearthland_private.can_manage_entity(m.community_entity_id)
        or (
          m.visibility = 'members'
          and hearthland_private.is_entity_member(m.community_entity_id)
        )
      )
  )
);
create policy community_meeting_attendees_insert
on hearthland.community_meeting_attendees
for insert to authenticated
with check (
  exists (
    select 1
    from hearthland.community_meetings m
    where m.id = meeting_id
      and (
        hearthland_private.can_manage_entity(m.community_entity_id)
        or (
          m.working_group_id is not null
          and hearthland_private.can_manage_working_group(m.working_group_id)
        )
      )
  )
);
create policy community_meeting_attendees_update
on hearthland.community_meeting_attendees
for update to authenticated
using (
  exists (
    select 1
    from hearthland.community_meetings m
    where m.id = meeting_id
      and (
        hearthland_private.can_manage_entity(m.community_entity_id)
        or (
          m.working_group_id is not null
          and hearthland_private.can_manage_working_group(m.working_group_id)
        )
      )
  )
)
with check (
  exists (
    select 1
    from hearthland.community_meetings m
    where m.id = meeting_id
      and (
        hearthland_private.can_manage_entity(m.community_entity_id)
        or (
          m.working_group_id is not null
          and hearthland_private.can_manage_working_group(m.working_group_id)
        )
      )
  )
);
create policy community_meeting_attendees_delete
on hearthland.community_meeting_attendees
for delete to authenticated
using (
  exists (
    select 1
    from hearthland.community_meetings m
    where m.id = meeting_id
      and (
        hearthland_private.can_manage_entity(m.community_entity_id)
        or (
          m.working_group_id is not null
          and hearthland_private.can_manage_working_group(m.working_group_id)
        )
      )
  )
);

create policy community_decisions_select
on hearthland.community_decisions
for select to authenticated
using (
  hearthland_private.can_manage_entity(community_entity_id)
  or (
    visibility = 'members'
    and hearthland_private.is_entity_member(community_entity_id)
  )
);
create policy community_decisions_insert
on hearthland.community_decisions
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(community_entity_id)
);
create policy community_decisions_update
on hearthland.community_decisions
for update to authenticated
using (hearthland_private.can_manage_entity(community_entity_id))
with check (hearthland_private.can_manage_entity(community_entity_id));
create policy community_decisions_delete
on hearthland.community_decisions
for delete to authenticated
using (hearthland_private.can_manage_entity(community_entity_id));

create policy community_pulse_cycles_select
on hearthland.community_pulse_cycles
for select to authenticated
using (
  hearthland_private.is_entity_member(community_entity_id)
  or hearthland_private.can_manage_entity(community_entity_id)
);
create policy community_pulse_cycles_insert
on hearthland.community_pulse_cycles
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(community_entity_id)
);
create policy community_pulse_cycles_update
on hearthland.community_pulse_cycles
for update to authenticated
using (hearthland_private.can_manage_entity(community_entity_id))
with check (hearthland_private.can_manage_entity(community_entity_id));
create policy community_pulse_cycles_delete
on hearthland.community_pulse_cycles
for delete to authenticated
using (hearthland_private.can_manage_entity(community_entity_id));

create policy community_pulse_responses_select
on hearthland.community_pulse_responses
for select to authenticated
using (account_id = (select auth.uid()));
create policy community_pulse_responses_insert
on hearthland.community_pulse_responses
for insert to authenticated
with check (
  account_id = (select auth.uid())
  and exists (
    select 1
    from hearthland.community_pulse_cycles pc
    where pc.id = cycle_id
      and pc.cycle_status = 'open'
      and pc.opens_at <= now()
      and (pc.closes_at is null or pc.closes_at > now())
      and hearthland_private.is_entity_member(pc.community_entity_id)
  )
);
create policy community_pulse_responses_update
on hearthland.community_pulse_responses
for update to authenticated
using (account_id = (select auth.uid()))
with check (account_id = (select auth.uid()));
create policy community_pulse_responses_delete
on hearthland.community_pulse_responses
for delete to authenticated
using (account_id = (select auth.uid()));

create policy feedback_submissions_insert_anon
on hearthland.feedback_submissions
for insert to anon
with check (
  account_id is null
  and status = 'new'
  and priority = 'normal'
  and assigned_to_account_id is null
  and resolved_at is null
);
create policy feedback_submissions_insert_authenticated
on hearthland.feedback_submissions
for insert to authenticated
with check (
  account_id = (select auth.uid())
  and status = 'new'
  and priority = 'normal'
  and assigned_to_account_id is null
  and resolved_at is null
);
create policy feedback_submissions_select
on hearthland.feedback_submissions
for select to authenticated
using (
  account_id = (select auth.uid())
  or hearthland_private.is_platform_staff(array['admin']::text[])
);
create policy feedback_submissions_update
on hearthland.feedback_submissions
for update to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]))
with check (hearthland_private.is_platform_staff(array['admin']::text[]));

create policy early_user_cohorts_select
on hearthland.early_user_cohorts
for select to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]));
create policy early_user_cohorts_insert
on hearthland.early_user_cohorts
for insert to authenticated
with check (
  enrolled_by_account_id = (select auth.uid())
  and hearthland_private.is_platform_staff(array['admin']::text[])
);
create policy early_user_cohorts_update
on hearthland.early_user_cohorts
for update to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]))
with check (hearthland_private.is_platform_staff(array['admin']::text[]));
create policy early_user_cohorts_delete
on hearthland.early_user_cohorts
for delete to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]));

create policy project_participation_requests_select
on hearthland.project_participation_requests
for select to authenticated
using (
  applicant_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(project_entity_id)
);
create policy project_participation_requests_insert
on hearthland.project_participation_requests
for insert to authenticated
with check (
  applicant_account_id = (select auth.uid())
  and status = 'new'
  and archived_at is null
  and exists (
    select 1
    from hearthland.entities e
    where e.id = project_entity_id
      and e.entity_type = 'settlement_project'
      and e.publication_status = 'published'
      and e.archived_at is null
      and hearthland_private.can_view_entity(e.id)
  )
);
create policy project_participation_requests_update
on hearthland.project_participation_requests
for update to authenticated
using (
  applicant_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(project_entity_id)
)
with check (
  applicant_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(project_entity_id)
);

-- ---------------------------------------------------------------------------
-- Aggregate-only operational metrics
-- ---------------------------------------------------------------------------

create or replace function hearthland.get_community_pulse_summary(
  target_cycle_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  target_community_id uuid;
  response_count integer;
  summary jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  select pc.community_entity_id into target_community_id
  from hearthland.community_pulse_cycles pc
  where pc.id = target_cycle_id;

  if target_community_id is null then
    raise exception 'PULSE_CYCLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not hearthland_private.can_manage_entity(target_community_id) then
    raise exception 'PULSE_MANAGER_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  select count(*)::integer into response_count
  from hearthland.community_pulse_responses pr
  where pr.cycle_id = target_cycle_id;

  if response_count < 3 then
    return jsonb_build_object(
      'cycle_id', target_cycle_id,
      'response_count', response_count,
      'minimum_responses', 3,
      'insufficient_data', true,
      'averages', null
    );
  end if;

  select jsonb_build_object(
    'communication', round(avg(pr.communication)::numeric, 2),
    'cooperation', round(avg(pr.cooperation)::numeric, 2),
    'belonging', round(avg(pr.belonging)::numeric, 2),
    'workload', round(avg(pr.workload)::numeric, 2),
    'clarity', round(avg(pr.clarity)::numeric, 2),
    'atmosphere', round(avg(pr.atmosphere)::numeric, 2)
  ) into summary
  from hearthland.community_pulse_responses pr
  where pr.cycle_id = target_cycle_id;

  return jsonb_build_object(
    'cycle_id', target_cycle_id,
    'response_count', response_count,
    'minimum_responses', 3,
    'insufficient_data', false,
    'averages', summary
  );
end;
$$;

create or replace function hearthland.get_camp_operational_metrics(
  target_camp_entity_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  camp_row hearthland.building_camps%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if not hearthland_private.can_manage_entity(target_camp_entity_id) then
    raise exception 'CAMP_MANAGER_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  select c.* into camp_row
  from hearthland.building_camps c
  where c.entity_id = target_camp_entity_id;
  if not found then
    raise exception 'CAMP_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'camp_entity_id', camp_row.entity_id,
    'camp_status', camp_row.camp_status,
    'start_date', camp_row.start_date,
    'end_date', camp_row.end_date,
    'capacity', camp_row.max_participants,
    'distinct_participants', (
      select count(distinct cp.account_id)
      from hearthland.camp_participants cp
      where cp.camp_entity_id = target_camp_entity_id
        and cp.participant_status in ('accepted', 'checked_in', 'completed')
    ),
    'applications', (
      select jsonb_build_object(
        'total', count(*),
        'new', count(*) filter (where ca.status = 'new'),
        'reviewing', count(*) filter (where ca.status = 'reviewing'),
        'accepted', count(*) filter (where ca.status = 'accepted'),
        'waiting_list', count(*) filter (where ca.status = 'waiting_list'),
        'declined', count(*) filter (where ca.status = 'declined')
      )
      from hearthland.camp_applications ca
      where ca.camp_entity_id = target_camp_entity_id
        and ca.archived_at is null
    ),
    'role_breakdown', (
      select jsonb_build_object(
        'participants', count(distinct cp.account_id),
        'volunteers', count(distinct cp.account_id)
          filter (where 'volunteer' = any(cp.roles)),
        'future_residents', count(distinct cp.account_id)
          filter (where 'future_resident' = any(cp.roles)),
        'builders', count(distinct cp.account_id)
          filter (where 'builder' = any(cp.roles)),
        'learners', count(distinct cp.account_id)
          filter (where 'learner' = any(cp.roles))
      )
      from hearthland.camp_participants cp
      where cp.camp_entity_id = target_camp_entity_id
        and cp.participant_status in ('accepted', 'checked_in', 'completed')
    ),
    'team', (
      select jsonb_build_object(
        'masters', count(distinct ct.account_id) filter (where ct.is_master),
        'organisers', count(distinct ct.account_id)
          filter (where ct.role in ('organiser', 'administrator')),
        'total', count(distinct ct.account_id)
      )
      from hearthland.camp_team ct
      where ct.camp_entity_id = target_camp_entity_id
    ),
    'workshops', (
      select count(*)
      from hearthland.camp_schedule_items si
      where si.camp_entity_id = target_camp_entity_id
        and si.item_type in ('practical_workshop', 'lesson', 'community')
    ),
    'build_items', (
      select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where bi.status = 'completed'),
        'active', count(*) filter (where bi.status = 'in_progress')
      )
      from hearthland.camp_build_items bi
      where bi.camp_entity_id = target_camp_entity_id
    )
  );
end;
$$;

create or replace function hearthland.get_pilot_project_metrics(
  target_project_entity_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  emerging_entity_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if not hearthland_private.can_manage_entity(target_project_entity_id) then
    raise exception 'PROJECT_MANAGER_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  select sp.emerging_community_entity_id into emerging_entity_id
  from hearthland.settlement_projects sp
  where sp.entity_id = target_project_entity_id;
  if not found then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'project_entity_id', target_project_entity_id,
    'followers', (
      select count(distinct f.account_id)
      from hearthland.follows f
      where f.entity_id = target_project_entity_id
    ),
    'participation_requests', (
      select jsonb_build_object(
        'total', count(*),
        'new', count(*) filter (where pr.status = 'new'),
        'accepted', count(*) filter (where pr.status = 'accepted')
      )
      from hearthland.project_participation_requests pr
      where pr.project_entity_id = target_project_entity_id
        and pr.archived_at is null
    ),
    'interested_people', (
      select count(distinct ci.applicant_account_id)
      from hearthland.community_interests ci
      where ci.community_entity_id = emerging_entity_id
        and ci.archived_at is null
    ),
    'team_members', (
      select count(distinct em.account_id)
      from hearthland.entity_memberships em
      where em.entity_id = target_project_entity_id
        and em.status = 'active'
    ),
    'open_needs', (
      select count(*)
      from hearthland.needs n
      where n.entity_id = target_project_entity_id
        and n.status = 'open'
        and n.archived_at is null
    ),
    'need_responses', (
      select count(*)
      from hearthland.need_responses nr
      join hearthland.needs n on n.id = nr.need_id
      where n.entity_id = target_project_entity_id
        and n.archived_at is null
    ),
    'camps', (
      select count(*)
      from hearthland.building_camps c
      where c.project_entity_id = target_project_entity_id
        and c.camp_status <> 'archived'
    ),
    'camp_applications', (
      select count(*)
      from hearthland.camp_applications ca
      join hearthland.building_camps c on c.entity_id = ca.camp_entity_id
      where c.project_entity_id = target_project_entity_id
        and ca.archived_at is null
    ),
    'accepted_participants', (
      select count(distinct cp.account_id)
      from hearthland.camp_participants cp
      join hearthland.building_camps c on c.entity_id = cp.camp_entity_id
      where c.project_entity_id = target_project_entity_id
        and cp.participant_status in ('accepted', 'checked_in', 'completed')
    ),
    'masters', (
      select count(distinct ct.account_id)
      from hearthland.camp_team ct
      join hearthland.building_camps c on c.entity_id = ct.camp_entity_id
      where c.project_entity_id = target_project_entity_id
        and ct.is_master
    ),
    'opportunities', (
      select count(*)
      from hearthland.opportunities o
      where o.host_entity_id = target_project_entity_id
        and o.application_status = 'open'
    ),
    'invitations', (
      select jsonb_build_object(
        'sent', count(*),
        'accepted', count(*) filter (where i.status = 'accepted')
      )
      from hearthland.invitations i
      where i.entity_id = target_project_entity_id
         or i.entity_id in (
           select c.entity_id
           from hearthland.building_camps c
           where c.project_entity_id = target_project_entity_id
         )
    )
  );
end;
$$;

create or replace function hearthland.get_project_participation_manager_details(
  target_project_entity_id uuid
)
returns table (
  request_id uuid,
  applicant_account_id uuid,
  display_name text,
  headline text,
  profile_entity_id uuid,
  skill_id uuid,
  skill_name text,
  skill_category text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if not hearthland_private.can_manage_entity(target_project_entity_id) then
    raise exception 'PROJECT_MANAGER_ACCESS_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from hearthland.settlement_projects sp
    where sp.entity_id = target_project_entity_id
  ) then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    pr.id,
    pr.applicant_account_id,
    coalesce(
      nullif(btrim(pp.display_name), ''),
      nullif(btrim(a.display_name), ''),
      'Hearthland applicant'
    ),
    coalesce(pp.headline, ''),
    pp.entity_id,
    ps.id,
    s.name,
    s.category
  from hearthland.project_participation_requests pr
  join hearthland.accounts a
    on a.id = pr.applicant_account_id
  left join hearthland.person_profiles pp
    on pp.account_id = pr.applicant_account_id
   and pp.archived_at is null
  left join lateral unnest(pr.relevant_skill_ids)
    as requested_skill(person_skill_id) on true
  left join hearthland.person_skills ps
    on ps.id = requested_skill.person_skill_id
   and ps.profile_entity_id = pp.entity_id
  left join hearthland.skills s
    on s.id = ps.skill_id
   and s.is_active
  where pr.project_entity_id = target_project_entity_id
    and pr.archived_at is null
    and a.archived_at is null
  order by pr.created_at desc, s.name nulls last;
end;
$$;

create or replace function hearthland.get_camp_application_manager_details(
  target_camp_entity_id uuid
)
returns table (
  application_id uuid,
  applicant_account_id uuid,
  display_name text,
  headline text,
  location_summary text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if not hearthland_private.can_manage_entity(target_camp_entity_id) then
    raise exception 'CAMP_MANAGER_ACCESS_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from hearthland.building_camps bc
    where bc.entity_id = target_camp_entity_id
  ) then
    raise exception 'CAMP_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    ca.id,
    ca.applicant_account_id,
    coalesce(
      nullif(btrim(pp.display_name), ''),
      nullif(btrim(a.display_name), ''),
      'Hearthland applicant'
    ),
    coalesce(pp.headline, ''),
    nullif(
      concat_ws(
        ', ',
        nullif(btrim(pl.city), ''),
        nullif(btrim(pl.region), ''),
        nullif(btrim(pl.country), '')
      ),
      ''
    )
  from hearthland.camp_applications ca
  join hearthland.accounts a
    on a.id = ca.applicant_account_id
  left join hearthland.person_profiles pp
    on pp.account_id = ca.applicant_account_id
   and pp.archived_at is null
  left join hearthland.profile_locations pl
    on pl.profile_entity_id = pp.entity_id
  where ca.camp_entity_id = target_camp_entity_id
    and ca.archived_at is null
    and a.archived_at is null
  order by ca.created_at desc;
end;
$$;

create or replace function hearthland.get_platform_metrics(
  period_start timestamptz default (now() - interval '30 days')
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not hearthland_private.current_account_is_active() then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if not hearthland_private.is_platform_staff(array['admin']::text[]) then
    raise exception 'PLATFORM_ADMIN_ACCESS_REQUIRED' using errcode = '42501';
  end if;
  if period_start > now() then
    raise exception 'INVALID_METRICS_PERIOD';
  end if;

  return jsonb_build_object(
    'period_start', period_start,
    'generated_at', now(),
    'total_users', (
      select count(*) from hearthland.accounts a where a.archived_at is null
    ),
    'new_users', (
      select count(*) from hearthland.accounts a
      where a.created_at >= period_start and a.archived_at is null
    ),
    'suspended_users', (
      select count(*) from hearthland.accounts a
      where a.account_status = 'suspended' and a.archived_at is null
    ),
    'communities', (select count(*) from hearthland.communities),
    'emerging_communities', (select count(*) from hearthland.emerging_communities),
    'settlement_projects', (select count(*) from hearthland.settlement_projects),
    'pilot_projects', (
      select count(*) from hearthland.pilot_projects pp
      where pp.pilot_status in ('active', 'completed')
    ),
    'published_land', (
      select count(*)
      from hearthland.land_listings l
      join hearthland.entities e on e.id = l.entity_id
      where e.publication_status = 'published'
        and e.archived_at is null
        and l.listing_status = 'available'
    ),
    'open_opportunities', (
      select count(*) from hearthland.opportunities o
      where o.application_status = 'open'
    ),
    'upcoming_camps', (
      select count(*) from hearthland.building_camps c
      where c.end_date >= current_date
        and c.camp_status in ('published', 'applications_open', 'applications_closed')
    ),
    'applications', (
      (select count(*) from hearthland.opportunity_applications oa
       where oa.archived_at is null)
      + (select count(*) from hearthland.community_interests ci
         where ci.archived_at is null)
      + (select count(*) from hearthland.camp_applications ca
         where ca.archived_at is null)
      + (select count(*) from hearthland.project_participation_requests pr
         where pr.archived_at is null)
    ),
    'accepted_camp_participants', (
      select count(distinct (cp.camp_entity_id, cp.account_id))
      from hearthland.camp_participants cp
      where cp.participant_status in ('accepted', 'checked_in', 'completed')
    ),
    'masters', (
      select count(*) from hearthland.teaching_profiles tp where tp.is_available
    ),
    'invitations_sent', (select count(*) from hearthland.invitations),
    'invitations_accepted', (
      select count(*) from hearthland.invitations i where i.status = 'accepted'
    ),
    'open_feedback', (
      select count(*) from hearthland.feedback_submissions fs
      where fs.status in ('new', 'reviewing', 'planned')
    ),
    'early_users', (select count(*) from hearthland.early_user_cohorts)
  );
end;
$$;

revoke all on function hearthland.get_community_pulse_summary(uuid)
  from public, anon;
grant execute on function hearthland.get_community_pulse_summary(uuid)
  to authenticated;
revoke all on function hearthland.get_camp_operational_metrics(uuid)
  from public, anon;
grant execute on function hearthland.get_camp_operational_metrics(uuid)
  to authenticated;
revoke all on function hearthland.get_pilot_project_metrics(uuid)
  from public, anon;
grant execute on function hearthland.get_pilot_project_metrics(uuid)
  to authenticated;
revoke all on function hearthland.get_project_participation_manager_details(uuid)
  from public, anon;
grant execute on function hearthland.get_project_participation_manager_details(uuid)
  to authenticated;
revoke all on function hearthland.get_camp_application_manager_details(uuid)
  from public, anon;
grant execute on function hearthland.get_camp_application_manager_details(uuid)
  to authenticated;
revoke all on function hearthland.get_platform_metrics(timestamptz)
  from public, anon;
grant execute on function hearthland.get_platform_metrics(timestamptz)
  to authenticated;

comment on function hearthland.get_community_pulse_summary(uuid) is
  'Manager-only aggregate. Never returns individual scores or private comments; averages require 3 responses.';
comment on function hearthland.create_invitation(jsonb) is
  'Manager-only 256-bit invitation token creator. Returns the raw token once and persists only its SHA-256 digest.';
comment on function hearthland.get_project_participation_manager_details(uuid) is
  'Request-scoped applicant identity and explicitly shared skill labels for authorised project managers. Omits private profile fields.';
comment on function hearthland.get_camp_application_manager_details(uuid) is
  'Application-scoped applicant identity and location summary for authorised Camp managers. Omits email, contact details, and raw profile records.';

-- The entity-media bucket is private. Publicly viewable entities must not make
-- private or member-only media objects readable merely because an object path
-- is known. Managers retain access to newly uploaded objects while they create
-- the corresponding media_assets record.
drop policy if exists hearthland_entity_media_select on storage.objects;
create policy hearthland_entity_media_select on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'hearthland-entity-media'
  and hearthland_private.can_view_entity(
    hearthland_private.storage_path_uuid(name, 'entities')
  )
  and (
    hearthland_private.can_manage_entity(
      hearthland_private.storage_path_uuid(name, 'entities')
    )
    or exists (
      select 1
      from hearthland.media_assets ma
      where ma.bucket_id = storage.objects.bucket_id
        and ma.object_path = storage.objects.name
        and ma.archived_at is null
        and (
          ma.visibility = 'public'
          or (
            ma.visibility = 'members'
            and (select auth.uid()) is not null
            and hearthland_private.is_entity_member(ma.entity_id)
          )
        )
    )
  )
);

commit;
