-- Hearthland T3.3 PostgreSQL/Supabase foundation.
--
-- Safety boundary:
--   * All Hearthland application tables live in the `hearthland` schema.
--   * Authorization helpers live in the unexposed `hearthland_private` schema.
--   * No existing table in `public` (including the earlier COM structure) is
--     dropped, renamed, altered, or reused by this migration.
--   * Storage objects are isolated in Hearthland-prefixed buckets and paths.
--
-- Deployment note: add `hearthland` to the project's exposed Data API schemas
-- before the application begins using `.schema('hearthland')`. RLS below is
-- authoritative even when the schema is exposed.

begin;

create schema if not exists hearthland;
create schema if not exists hearthland_private;

comment on schema hearthland is
  'Hearthland application data. Separate from the pre-existing COM public schema.';
comment on schema hearthland_private is
  'Non-exposed Hearthland authorization and trigger helpers.';

revoke all on schema hearthland from public;
revoke all on schema hearthland_private from public;

grant usage on schema hearthland to anon, authenticated, service_role;
grant usage on schema hearthland_private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Identity, seed provenance, and the central managed-entity registry
-- ---------------------------------------------------------------------------

create table if not exists hearthland.seed_batches (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  version integer not null default 1 check (version > 0),
  source text not null default 'hearthland_curated',
  checksum text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hearthland.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'deactivated', 'pending_deletion')),
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started', 'in_progress', 'complete', 'skipped')),
  locale text not null default 'en',
  timezone text,
  last_active_at timestamptz,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists accounts_email_lower_unique
  on hearthland.accounts (lower(email));
create index if not exists accounts_status_idx
  on hearthland.accounts (account_status, onboarding_status);

create table if not exists hearthland.platform_roles (
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  role text not null check (role in ('moderator', 'admin')),
  granted_by_account_id uuid references hearthland.accounts(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (account_id, role)
);

create index if not exists platform_roles_active_idx
  on hearthland.platform_roles (account_id, role) where revoked_at is null;

create table if not exists hearthland.entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'person_profile',
    'community',
    'emerging_community',
    'settlement_project',
    'land_listing',
    'organisation',
    'opportunity',
    'learning_topic',
    'building_camp'
  )),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) > 0),
  short_description text not null default '',
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'pending', 'published', 'unpublished', 'suspended', 'archived')),
  visibility text not null default 'public'
    check (visibility in ('public', 'members', 'connections', 'private')),
  owner_account_id uuid references hearthland.accounts(id) on delete restrict,
  created_by_account_id uuid references hearthland.accounts(id) on delete set null,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  is_seeded_demo boolean not null default false,
  seed_key text unique,
  seed_batch_id uuid references hearthland.seed_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint entities_owner_or_seed_check check (
    (is_seeded_demo and seed_key is not null)
    or (not is_seeded_demo and owner_account_id is not null)
  ),
  constraint entities_publish_timestamp_check check (
    publication_status <> 'published' or published_at is not null
  )
);

create unique index if not exists entities_type_slug_unique
  on hearthland.entities (entity_type, slug);
create index if not exists entities_public_directory_idx
  on hearthland.entities (entity_type, publication_status, visibility, updated_at desc)
  where archived_at is null;
create index if not exists entities_owner_idx
  on hearthland.entities (owner_account_id, publication_status, updated_at desc)
  where archived_at is null;
create index if not exists entities_seed_batch_idx
  on hearthland.entities (seed_batch_id) where is_seeded_demo;

-- ---------------------------------------------------------------------------
-- People, onboarding, preferences, skills, values, and teaching capability
-- ---------------------------------------------------------------------------

create table if not exists hearthland.person_profiles (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  account_id uuid unique references hearthland.accounts(id) on delete cascade,
  display_name text not null,
  headline text not null default '',
  bio text not null default '',
  languages text[] not null default '{}'::text[],
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  relocation_readiness text check (relocation_readiness in (
    'not_considering', 'curious', 'planning', 'ready', 'already_relocating'
  )),
  geographic_flexibility text,
  family_situation text,
  availability text,
  profile_completeness smallint not null default 0
    check (profile_completeness between 0 and 100),
  discoverable boolean not null default true,
  allow_connection_requests boolean not null default true,
  looking_for text[] not null default '{}'::text[],
  can_contribute text[] not null default '{}'::text[],
  contribution_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on column hearthland.person_profiles.account_id is
  'Null only for controlled seeded/demo people; real profiles link one-to-one to auth-backed accounts.';

create index if not exists person_profiles_account_idx
  on hearthland.person_profiles (account_id) where account_id is not null;
create index if not exists person_profiles_discovery_idx
  on hearthland.person_profiles (discoverable, profile_completeness desc)
  where archived_at is null;

create table if not exists hearthland.profile_contacts (
  profile_entity_id uuid primary key references hearthland.person_profiles(entity_id) on delete cascade,
  public_email text,
  phone text,
  website text,
  contact_notes text,
  visibility text not null default 'connections'
    check (visibility in ('public', 'members', 'connections', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Location is split from the public profile row so per-field privacy is
-- enforced by RLS rather than UI filtering.
create table if not exists hearthland.profile_locations (
  profile_entity_id uuid primary key references hearthland.person_profiles(entity_id) on delete cascade,
  country text,
  region text,
  city text,
  visibility text not null default 'members'
    check (visibility in ('public', 'members', 'connections', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_locations_directory_idx
  on hearthland.profile_locations (country, region, city);

create table if not exists hearthland.user_intentions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  intention text not null check (intention in (
    'find_community',
    'create_community',
    'already_creating_community',
    'represent_existing_community',
    'have_land',
    'teach_master',
    'volunteer',
    'work',
    'support_invest',
    'learn',
    'represent_organisation',
    'explore'
  )),
  created_at timestamptz not null default now(),
  unique (account_id, intention)
);

create table if not exists hearthland.profile_preferences (
  profile_entity_id uuid primary key references hearthland.person_profiles(entity_id) on delete cascade,
  preferred_countries text[] not null default '{}'::text[],
  preferred_regions text[] not null default '{}'::text[],
  desired_community_types text[] not null default '{}'::text[],
  lifestyle_interests text[] not null default '{}'::text[],
  community_size_min integer check (community_size_min is null or community_size_min >= 1),
  community_size_max integer check (community_size_max is null or community_size_max >= 1),
  communal_life_level smallint check (communal_life_level between 0 and 10),
  governance_preference text,
  ownership_preference text,
  economic_integration smallint check (economic_integration between 0 and 10),
  family_friendly_required boolean not null default false,
  privacy_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(privacy_preferences) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_preference_size_check check (
    community_size_min is null
    or community_size_max is null
    or community_size_min <= community_size_max
  )
);

create table if not exists hearthland.skills (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_active boolean not null default true,
  is_seeded_demo boolean not null default false,
  seed_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists skills_category_idx
  on hearthland.skills (category, name) where is_active;

create table if not exists hearthland.person_skills (
  id uuid primary key default gen_random_uuid(),
  profile_entity_id uuid not null references hearthland.person_profiles(entity_id) on delete cascade,
  skill_id uuid not null references hearthland.skills(id) on delete restrict,
  experience_level text not null check (experience_level in (
    'curious', 'beginner', 'intermediate', 'advanced', 'expert'
  )),
  years_experience numeric(5,2) check (years_experience is null or years_experience >= 0),
  can_teach boolean not null default false,
  practical_workshops boolean not null default false,
  theoretical_sessions boolean not null default false,
  willing_to_contribute boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_entity_id, skill_id)
);

create index if not exists person_skills_discovery_idx
  on hearthland.person_skills (skill_id, can_teach, experience_level);

create table if not exists hearthland.values_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_active boolean not null default true,
  is_seeded_demo boolean not null default false,
  seed_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hearthland.profile_values (
  profile_entity_id uuid not null references hearthland.person_profiles(entity_id) on delete cascade,
  value_id uuid not null references hearthland.values_catalog(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (profile_entity_id, value_id)
);

create table if not exists hearthland.teaching_profiles (
  profile_entity_id uuid primary key references hearthland.person_profiles(entity_id) on delete cascade,
  is_available boolean not null default false,
  teaching_bio text not null default '',
  teaching_formats text[] not null default '{}'::text[],
  travel_regions text[] not null default '{}'::text[],
  languages text[] not null default '{}'::text[],
  availability text,
  compensation_preference text,
  portfolio_links jsonb not null default '[]'::jsonb check (jsonb_typeof(portfolio_links) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Managed directory entities
-- ---------------------------------------------------------------------------

create table if not exists hearthland.communities (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  full_description text not null default '',
  country text not null,
  region text,
  nearest_city text,
  approximate_latitude numeric(9,6) check (approximate_latitude between -90 and 90),
  approximate_longitude numeric(9,6) check (approximate_longitude between -180 and 180),
  location_visibility text not null default 'approximate'
    check (location_visibility in ('exact', 'approximate', 'private')),
  community_type text not null,
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('forming', 'active', 'paused', 'closed')),
  residents integer not null default 0 check (residents >= 0),
  target_residents integer check (target_residents is null or target_residents >= 1),
  children integer check (children is null or children >= 0),
  founding_year integer check (founding_year is null or founding_year between 1800 and 2200),
  accepting_members boolean not null default false,
  membership_status text not null default 'closed'
    check (membership_status in ('open', 'limited', 'waitlist', 'closed')),
  governance_model text,
  ownership_model text,
  economic_model text,
  family_friendly boolean not null default false,
  ecology_practices text[] not null default '{}'::text[],
  shared_spaces text[] not null default '{}'::text[],
  contact_details jsonb not null default '{}'::jsonb check (jsonb_typeof(contact_details) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists communities_directory_idx
  on hearthland.communities (country, community_type, accepting_members, family_friendly);

create table if not exists hearthland.emerging_communities (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  vision text not null default '',
  target_country text,
  target_region text,
  community_type text not null,
  stage text not null default 'idea'
    check (stage in ('idea', 'vision', 'core_team', 'community_model', 'location', 'land', 'planning', 'building', 'settling')),
  current_members integer not null default 1 check (current_members >= 0),
  target_size_min integer check (target_size_min is null or target_size_min >= 1),
  target_size_max integer check (target_size_max is null or target_size_max >= 1),
  land_status text,
  lifestyle_themes text[] not null default '{}'::text[],
  current_assets text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint emerging_target_size_check check (
    target_size_min is null or target_size_max is null or target_size_min <= target_size_max
  )
);

create index if not exists emerging_communities_directory_idx
  on hearthland.emerging_communities (target_country, stage, community_type);

create table if not exists hearthland.settlement_projects (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  emerging_community_entity_id uuid references hearthland.emerging_communities(entity_id) on delete set null,
  description text not null default '',
  stage text not null default 'vision'
    check (stage in ('vision', 'core_team', 'community_model', 'location', 'land', 'legal', 'finance', 'planning', 'base_camp', 'infrastructure', 'building', 'settling', 'operating')),
  target_country text,
  target_region text,
  target_population integer check (target_population is null or target_population >= 1),
  land_requirement_ha numeric(12,3) check (land_requirement_ha is null or land_requirement_ha > 0),
  approximate_budget_eur numeric(14,2) check (approximate_budget_eur is null or approximate_budget_eur >= 0),
  funding_status text,
  next_milestone text,
  current_priorities text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists settlement_projects_directory_idx
  on hearthland.settlement_projects (target_country, stage);
create index if not exists settlement_projects_emerging_idx
  on hearthland.settlement_projects (emerging_community_entity_id);

create table if not exists hearthland.land_listings (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  full_description text not null default '',
  country text not null,
  region text,
  nearest_city text,
  approximate_latitude numeric(9,6) check (approximate_latitude between -90 and 90),
  approximate_longitude numeric(9,6) check (approximate_longitude between -180 and 180),
  location_visibility text not null default 'approximate'
    check (location_visibility in ('exact', 'approximate', 'private')),
  total_area numeric(12,3) not null check (total_area > 0),
  area_unit text not null default 'ha' check (area_unit in ('ha', 'acre', 'm2')),
  price_eur numeric(14,2) check (price_eur is null or price_eur >= 0),
  price_visibility text not null default 'public_exact'
    check (price_visibility in ('public_exact', 'public_range', 'on_request', 'private')),
  ownership_status text,
  listing_status text not null default 'available'
    check (listing_status in ('draft', 'available', 'under_discussion', 'reserved', 'unavailable', 'archived')),
  has_water boolean,
  has_buildings boolean,
  agricultural boolean,
  forest_area_ha numeric(12,3) check (forest_area_ha is null or forest_area_ha >= 0),
  zoning_known boolean,
  construction_status text,
  infrastructure text[] not null default '{}'::text[],
  planning_notes text not null default '',
  collaboration_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint land_forest_area_check check (
    forest_area_ha is null or area_unit <> 'ha' or forest_area_ha <= total_area
  )
);

create index if not exists land_listings_directory_idx
  on hearthland.land_listings (country, region, listing_status, total_area, price_eur);

-- Exact/private coordinates and address data never live on the directory row.
create table if not exists hearthland.land_private_locations (
  land_entity_id uuid primary key references hearthland.land_listings(entity_id) on delete cascade,
  exact_latitude numeric(9,6) check (exact_latitude between -90 and 90),
  exact_longitude numeric(9,6) check (exact_longitude between -180 and 180),
  address_line_1 text,
  address_line_2 text,
  postal_code text,
  cadastral_reference text,
  access_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hearthland.land_wanted (
  id uuid primary key default gen_random_uuid(),
  project_entity_id uuid not null references hearthland.settlement_projects(entity_id) on delete cascade,
  countries text[] not null default '{}'::text[],
  target_regions text[] not null default '{}'::text[],
  min_area_ha numeric(12,3) check (min_area_ha is null or min_area_ha > 0),
  max_area_ha numeric(12,3) check (max_area_ha is null or max_area_ha > 0),
  max_budget_eur numeric(14,2) check (max_budget_eur is null or max_budget_eur >= 0),
  water_required boolean not null default false,
  buildings_required boolean not null default false,
  agriculture_required boolean not null default false,
  forest_preference text,
  infrastructure_requirements text[] not null default '{}'::text[],
  max_distance_to_city_km numeric(8,2) check (max_distance_to_city_km is null or max_distance_to_city_km >= 0),
  description text not null default '',
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'fulfilled', 'archived')),
  created_by_account_id uuid references hearthland.accounts(id) on delete set null,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint land_wanted_area_check check (
    min_area_ha is null or max_area_ha is null or min_area_ha <= max_area_ha
  )
);

create index if not exists land_wanted_match_idx
  on hearthland.land_wanted (status, min_area_ha, max_budget_eur) where archived_at is null;

create table if not exists hearthland.organisations (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  organisation_type text not null,
  country text,
  description text not null default '',
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hearthland.professional_profiles (
  profile_entity_id uuid primary key references hearthland.person_profiles(entity_id) on delete cascade,
  organisation_entity_id uuid references hearthland.organisations(entity_id) on delete set null,
  headline text not null,
  availability text,
  remote_possible boolean not null default false,
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hearthland.opportunities (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  host_entity_id uuid not null references hearthland.entities(id) on delete cascade,
  opportunity_type text not null,
  description text not null,
  country text,
  region text,
  remote_possible boolean not null default false,
  start_date date,
  duration text,
  compensation_type text,
  compensation_details text,
  accommodation_included boolean not null default false,
  food_included boolean not null default false,
  positions integer not null default 1 check (positions >= 1),
  deadline date,
  application_status text not null default 'closed'
    check (application_status in ('open', 'paused', 'closed')),
  required_skills text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists opportunities_directory_idx
  on hearthland.opportunities (opportunity_type, country, remote_possible, start_date, application_status);
create index if not exists opportunities_host_idx
  on hearthland.opportunities (host_entity_id);

create table if not exists hearthland.learning_topics (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  category text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_topics_category_idx
  on hearthland.learning_topics (category);

create table if not exists hearthland.building_camps (
  entity_id uuid primary key references hearthland.entities(id) on delete cascade,
  host_entity_id uuid not null references hearthland.entities(id) on delete cascade,
  project_entity_id uuid references hearthland.settlement_projects(entity_id) on delete set null,
  location text not null,
  country text not null,
  region text,
  start_date date not null,
  end_date date not null,
  purpose text not null default '',
  full_description text not null default '',
  max_participants integer not null check (max_participants >= 1),
  application_deadline date,
  languages text[] not null default '{}'::text[],
  accommodation_type text,
  food_model text,
  contribution_type text,
  contribution_details text,
  roles_available text[] not null default '{}'::text[],
  camp_status text not null default 'draft' check (camp_status in (
    'draft', 'published', 'applications_open', 'applications_closed',
    'active', 'completed', 'cancelled', 'archived'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint building_camp_dates_check check (end_date >= start_date),
  constraint building_camp_deadline_check check (
    application_deadline is null or application_deadline <= end_date
  )
);

create index if not exists building_camps_directory_idx
  on hearthland.building_camps (country, start_date, camp_status);
create index if not exists building_camps_host_idx
  on hearthland.building_camps (host_entity_id, project_entity_id);

-- ---------------------------------------------------------------------------
-- Roles, membership, invitations, applications, and camp operations
-- ---------------------------------------------------------------------------

create table if not exists hearthland.entity_roles (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  role text not null check (role in ('owner', 'administrator', 'member', 'participant')),
  status text not null default 'active' check (status in ('active', 'inactive', 'revoked')),
  granted_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, account_id)
);

create index if not exists entity_roles_active_account_idx
  on hearthland.entity_roles (account_id, entity_id, role) where status = 'active';
create index if not exists entity_roles_active_entity_idx
  on hearthland.entity_roles (entity_id, role, account_id) where status = 'active';

create table if not exists hearthland.entity_memberships (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  membership_type text not null default 'member',
  status text not null default 'invited' check (status in (
    'invited', 'requested', 'candidate', 'active', 'inactive', 'former'
  )),
  public_visibility boolean not null default true,
  joined_at timestamptz,
  created_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, account_id, membership_type)
);

create index if not exists entity_memberships_entity_idx
  on hearthland.entity_memberships (entity_id, status, membership_type);
create index if not exists entity_memberships_account_idx
  on hearthland.entity_memberships (account_id, status, updated_at desc);

create table if not exists hearthland.invitations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  invited_account_id uuid references hearthland.accounts(id) on delete cascade,
  invited_email text,
  invitation_type text not null default 'team' check (invitation_type in (
    'team', 'community_member', 'camp_team', 'camp_master', 'partner'
  )),
  proposed_role text not null,
  message text not null default '',
  practical_arrangements text not null default '',
  token_hash text unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  invited_by_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  accepted_by_account_id uuid references hearthland.accounts(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_recipient_check check (
    invited_account_id is not null or nullif(btrim(invited_email), '') is not null
  ),
  constraint invitation_token_for_email_check check (
    invited_email is null or token_hash is not null
  )
);

create unique index if not exists invitations_pending_account_unique
  on hearthland.invitations (entity_id, invited_account_id, proposed_role)
  where status = 'pending' and invited_account_id is not null;
create unique index if not exists invitations_pending_email_unique
  on hearthland.invitations (entity_id, lower(invited_email), proposed_role)
  where status = 'pending' and invited_email is not null;
create index if not exists invitations_recipient_idx
  on hearthland.invitations (invited_account_id, status, created_at desc);
create index if not exists invitations_sender_idx
  on hearthland.invitations (invited_by_account_id, status, created_at desc);

create table if not exists hearthland.opportunity_applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_entity_id uuid not null references hearthland.opportunities(entity_id) on delete cascade,
  applicant_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  message text not null default '',
  availability text,
  relevant_skill_ids uuid[] not null default '{}'::uuid[],
  contact_preference text,
  status text not null default 'submitted' check (status in (
    'submitted', 'viewed', 'contacted', 'shortlisted', 'accepted', 'declined', 'withdrawn'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (opportunity_entity_id, applicant_account_id)
);

create index if not exists opportunity_applications_manager_idx
  on hearthland.opportunity_applications (opportunity_entity_id, status, created_at desc)
  where archived_at is null;
create index if not exists opportunity_applications_applicant_idx
  on hearthland.opportunity_applications (applicant_account_id, status, updated_at desc)
  where archived_at is null;

-- Manager notes are deliberately separated from applicant-readable data.
create table if not exists hearthland.opportunity_application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references hearthland.opportunity_applications(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  created_by_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists opportunity_application_notes_application_idx
  on hearthland.opportunity_application_notes (application_id, created_at desc)
  where archived_at is null;

create table if not exists hearthland.community_interests (
  id uuid primary key default gen_random_uuid(),
  community_entity_id uuid not null references hearthland.entities(id) on delete cascade,
  applicant_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  interest_type text not null check (interest_type in (
    'join', 'visit', 'volunteer', 'collaborate', 'learn', 'support', 'other'
  )),
  message text not null default '',
  pipeline_status text not null default 'new' check (pipeline_status in (
    'new', 'contacted', 'conversation', 'visit_planned', 'trial',
    'candidate', 'accepted', 'declined', 'withdrawn', 'archived'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (community_entity_id, applicant_account_id)
);

create index if not exists community_interests_pipeline_idx
  on hearthland.community_interests (community_entity_id, pipeline_status, created_at desc)
  where archived_at is null;
create index if not exists community_interests_applicant_idx
  on hearthland.community_interests (applicant_account_id, pipeline_status, updated_at desc)
  where archived_at is null;

create table if not exists hearthland.community_interest_notes (
  id uuid primary key default gen_random_uuid(),
  interest_id uuid not null references hearthland.community_interests(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  created_by_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists community_interest_notes_interest_idx
  on hearthland.community_interest_notes (interest_id, created_at desc)
  where archived_at is null;

create table if not exists hearthland.camp_applications (
  id uuid primary key default gen_random_uuid(),
  camp_entity_id uuid not null references hearthland.building_camps(entity_id) on delete cascade,
  applicant_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  selected_roles text[] not null default '{}'::text[],
  message text not null default '',
  skills_offered text not null default '',
  learning_interests text not null default '',
  arrival_date date,
  departure_date date,
  accommodation_requirement text,
  resources_offered text not null default '',
  future_community_interest text,
  status text not null default 'new' check (status in (
    'new', 'reviewing', 'contacted', 'accepted', 'waiting_list',
    'declined', 'cancelled', 'withdrawn'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (camp_entity_id, applicant_account_id),
  constraint camp_application_dates_check check (
    arrival_date is null or departure_date is null or departure_date >= arrival_date
  )
);

create index if not exists camp_applications_manager_idx
  on hearthland.camp_applications (camp_entity_id, status, created_at desc)
  where archived_at is null;
create index if not exists camp_applications_applicant_idx
  on hearthland.camp_applications (applicant_account_id, status, updated_at desc)
  where archived_at is null;

create table if not exists hearthland.camp_application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references hearthland.camp_applications(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  created_by_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists camp_application_notes_application_idx
  on hearthland.camp_application_notes (application_id, created_at desc)
  where archived_at is null;

create table if not exists hearthland.camp_team (
  id uuid primary key default gen_random_uuid(),
  camp_entity_id uuid not null references hearthland.building_camps(entity_id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  role text not null,
  is_master boolean not null default false,
  public_visibility boolean not null default true,
  invitation_id uuid references hearthland.invitations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (camp_entity_id, account_id, role)
);

create index if not exists camp_team_camp_idx
  on hearthland.camp_team (camp_entity_id, is_master, public_visibility);

create table if not exists hearthland.camp_build_items (
  id uuid primary key default gen_random_uuid(),
  camp_entity_id uuid not null references hearthland.building_camps(entity_id) on delete cascade,
  name text not null,
  description text not null default '',
  category text,
  lead_account_id uuid references hearthland.accounts(id) on delete set null,
  status text not null default 'planned' check (status in (
    'planned', 'preparing', 'in_progress', 'completed', 'postponed'
  )),
  target_participants_min integer check (target_participants_min is null or target_participants_min >= 0),
  target_participants_max integer check (target_participants_max is null or target_participants_max >= 0),
  materials_note text not null default '',
  tools_note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint camp_build_participants_check check (
    target_participants_min is null
    or target_participants_max is null
    or target_participants_min <= target_participants_max
  )
);

create index if not exists camp_build_items_camp_idx
  on hearthland.camp_build_items (camp_entity_id, status, sort_order);

create table if not exists hearthland.camp_build_item_skills (
  build_item_id uuid not null references hearthland.camp_build_items(id) on delete cascade,
  skill_id uuid not null references hearthland.skills(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (build_item_id, skill_id)
);

create table if not exists hearthland.camp_learning_topics (
  camp_entity_id uuid not null references hearthland.building_camps(entity_id) on delete cascade,
  learning_topic_entity_id uuid not null references hearthland.learning_topics(entity_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (camp_entity_id, learning_topic_entity_id)
);

create table if not exists hearthland.camp_schedule_items (
  id uuid primary key default gen_random_uuid(),
  camp_entity_id uuid not null references hearthland.building_camps(entity_id) on delete cascade,
  scheduled_date date not null,
  start_time time,
  end_time time,
  title text not null,
  item_type text not null check (item_type in (
    'build', 'practical_workshop', 'lesson', 'community', 'food',
    'wellbeing', 'culture', 'free_time', 'other'
  )),
  leader_account_id uuid references hearthland.accounts(id) on delete set null,
  location text,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint camp_schedule_time_check check (
    start_time is null or end_time is null or end_time > start_time
  )
);

create index if not exists camp_schedule_items_date_idx
  on hearthland.camp_schedule_items (camp_entity_id, scheduled_date, start_time, sort_order);

-- ---------------------------------------------------------------------------
-- Taxonomy, needs/offers, project work, media, relationships, and drafts
-- ---------------------------------------------------------------------------

create table if not exists hearthland.entity_skill_needs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  skill_id uuid not null references hearthland.skills(id) on delete restrict,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'discussion', 'fulfilled', 'closed')),
  notes text not null default '',
  created_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, skill_id)
);

create index if not exists entity_skill_needs_match_idx
  on hearthland.entity_skill_needs (skill_id, status, priority);

create table if not exists hearthland.entity_values (
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  value_id uuid not null references hearthland.values_catalog(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (entity_id, value_id)
);

create table if not exists hearthland.needs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  title text not null,
  category text not null check (category in (
    'people', 'skills', 'land', 'funding', 'equipment', 'materials',
    'knowledge', 'services', 'partnership', 'other'
  )),
  description text not null default '',
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'urgent')),
  quantity text,
  country text,
  status text not null default 'open' check (status in ('open', 'discussion', 'fulfilled', 'closed')),
  created_by_account_id uuid not null references hearthland.accounts(id) on delete restrict,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists needs_match_idx
  on hearthland.needs (category, status, country, urgency) where archived_at is null;
create index if not exists needs_entity_idx
  on hearthland.needs (entity_id, status, created_at desc) where archived_at is null;

create table if not exists hearthland.offers (
  id uuid primary key default gen_random_uuid(),
  provider_entity_id uuid not null references hearthland.entities(id) on delete cascade,
  title text not null,
  category text not null check (category in (
    'skill', 'teaching', 'professional_service', 'equipment', 'accommodation',
    'materials', 'knowledge', 'volunteering', 'partnership', 'other'
  )),
  description text not null default '',
  country text,
  remote_possible boolean not null default false,
  status text not null default 'open' check (status in ('draft', 'open', 'paused', 'closed', 'archived')),
  created_by_account_id uuid not null references hearthland.accounts(id) on delete restrict,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists offers_match_idx
  on hearthland.offers (category, status, country, remote_possible) where archived_at is null;

create table if not exists hearthland.need_responses (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references hearthland.needs(id) on delete cascade,
  responder_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  response_type text not null check (response_type in ('skill', 'equipment_material', 'connect', 'message')),
  message text not null default '',
  offer_id uuid references hearthland.offers(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'contacted', 'accepted', 'declined', 'withdrawn', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (need_id, responder_account_id, response_type)
);

create index if not exists need_responses_manager_idx
  on hearthland.need_responses (need_id, status, created_at desc);
create index if not exists need_responses_responder_idx
  on hearthland.need_responses (responder_account_id, status, updated_at desc);

create table if not exists hearthland.tasks (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  title text not null,
  description text not null default '',
  assignee_account_id uuid references hearthland.accounts(id) on delete set null,
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'completed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  linked_stage text,
  sort_order integer not null default 0,
  created_by_account_id uuid not null references hearthland.accounts(id) on delete restrict,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists tasks_workspace_idx
  on hearthland.tasks (entity_id, status, due_date, sort_order) where archived_at is null;
create index if not exists tasks_assignee_idx
  on hearthland.tasks (assignee_account_id, status, due_date) where archived_at is null;

create table if not exists hearthland.project_stage_progress (
  id uuid primary key default gen_random_uuid(),
  project_entity_id uuid not null references hearthland.settlement_projects(entity_id) on delete cascade,
  stage text not null,
  status text not null default 'not_started' check (status in ('not_started', 'future', 'next', 'active', 'blocked', 'completed')),
  notes text not null default '',
  sort_order integer not null default 0,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_entity_id, stage)
);

create index if not exists project_stage_progress_project_idx
  on hearthland.project_stage_progress (project_entity_id, sort_order);

create table if not exists hearthland.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_entity_id uuid not null references hearthland.settlement_projects(entity_id) on delete cascade,
  title text not null,
  description text not null default '',
  target_date date,
  completed_date date,
  status text not null default 'future' check (status in ('future', 'active', 'completed', 'delayed')),
  sort_order integer not null default 0,
  created_by_account_id uuid references hearthland.accounts(id) on delete set null,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists project_milestones_project_idx
  on hearthland.project_milestones (project_entity_id, sort_order, target_date, status)
  where archived_at is null;

create table if not exists hearthland.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_entity_id uuid not null references hearthland.settlement_projects(entity_id) on delete cascade,
  title text not null,
  body text not null,
  image_media_id uuid,
  milestone_id uuid references hearthland.project_milestones(id) on delete set null,
  camp_entity_id uuid references hearthland.building_camps(entity_id) on delete set null,
  publication_status text not null default 'draft' check (publication_status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by_account_id uuid not null references hearthland.accounts(id) on delete restrict,
  updated_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint project_update_publish_check check (
    publication_status <> 'published' or published_at is not null
  )
);

create index if not exists project_updates_project_idx
  on hearthland.project_updates (project_entity_id, publication_status, published_at desc)
  where archived_at is null;

create table if not exists hearthland.tags (
  id uuid primary key default gen_random_uuid(),
  taxonomy text not null,
  label text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_seeded_demo boolean not null default false,
  seed_key text unique,
  created_at timestamptz not null default now(),
  unique (taxonomy, slug)
);

create table if not exists hearthland.entity_tags (
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  tag_id uuid not null references hearthland.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (entity_id, tag_id)
);

create table if not exists hearthland.entity_relationships (
  id uuid primary key default gen_random_uuid(),
  source_entity_id uuid not null references hearthland.entities(id) on delete cascade,
  target_entity_id uuid not null references hearthland.entities(id) on delete cascade,
  relationship_type text not null,
  status text not null default 'active' check (status in ('pending', 'active', 'inactive', 'archived')),
  visibility text not null default 'public' check (visibility in ('public', 'members', 'private')),
  start_date date,
  created_by_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint entity_relationship_no_self_check check (source_entity_id <> target_entity_id),
  unique (source_entity_id, target_entity_id, relationship_type)
);

create index if not exists entity_relationships_source_idx
  on hearthland.entity_relationships (source_entity_id, relationship_type, status)
  where archived_at is null;
create index if not exists entity_relationships_target_idx
  on hearthland.entity_relationships (target_entity_id, relationship_type, status)
  where archived_at is null;

create table if not exists hearthland.media_assets (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references hearthland.entities(id) on delete cascade,
  profile_entity_id uuid references hearthland.person_profiles(entity_id) on delete cascade,
  uploader_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  bucket_id text not null check (bucket_id in (
    'hearthland-avatars', 'hearthland-entity-media', 'hearthland-project-files'
  )),
  object_path text not null,
  media_kind text not null default 'image' check (media_kind in ('image', 'document')),
  category text,
  alt_text text not null default '',
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  visibility text not null default 'public' check (visibility in ('public', 'members', 'private')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint media_parent_check check (
    (entity_id is not null and profile_entity_id is null)
    or (entity_id is null and profile_entity_id is not null)
  ),
  unique (bucket_id, object_path)
);

create unique index if not exists media_assets_cover_unique
  on hearthland.media_assets (coalesce(entity_id, profile_entity_id), category)
  where is_cover and archived_at is null;
create index if not exists media_assets_entity_idx
  on hearthland.media_assets (entity_id, category, sort_order) where archived_at is null;
create index if not exists media_assets_profile_idx
  on hearthland.media_assets (profile_entity_id, sort_order) where archived_at is null;

alter table hearthland.project_updates
  drop constraint if exists project_updates_image_media_id_fkey;
alter table hearthland.project_updates
  add constraint project_updates_image_media_id_fkey
  foreign key (image_media_id) references hearthland.media_assets(id) on delete set null;

create table if not exists hearthland.creation_drafts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  draft_type text not null check (draft_type in (
    'community', 'emerging_community', 'settlement_project', 'land_listing',
    'opportunity', 'building_camp', 'start_community_wizard'
  )),
  entity_id uuid references hearthland.entities(id) on delete set null,
  current_step integer not null default 1 check (current_step >= 1),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists creation_drafts_account_idx
  on hearthland.creation_drafts (account_id, draft_type, updated_at desc)
  where archived_at is null and completed_at is null;

create table if not exists hearthland.land_enquiries (
  id uuid primary key default gen_random_uuid(),
  land_entity_id uuid not null references hearthland.land_listings(entity_id) on delete cascade,
  project_entity_id uuid references hearthland.settlement_projects(entity_id) on delete set null,
  sender_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  message text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'in_discussion', 'closed', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (land_entity_id, sender_account_id, project_entity_id)
);

create index if not exists land_enquiries_land_idx
  on hearthland.land_enquiries (land_entity_id, status, created_at desc);
create index if not exists land_enquiries_sender_idx
  on hearthland.land_enquiries (sender_account_id, status, updated_at desc);

-- ---------------------------------------------------------------------------
-- Social graph, messaging, notifications, moderation, and audit
-- ---------------------------------------------------------------------------

create table if not exists hearthland.connections (
  id uuid primary key default gen_random_uuid(),
  requester_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  receiver_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  message text not null default '' check (length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connections_no_self_check check (requester_account_id <> receiver_account_id),
  unique (requester_account_id, receiver_account_id)
);

create unique index if not exists connections_undirected_unique
  on hearthland.connections (
    least(requester_account_id, receiver_account_id),
    greatest(requester_account_id, receiver_account_id)
  ) where status in ('pending', 'accepted');
create index if not exists connections_receiver_idx
  on hearthland.connections (receiver_account_id, status, created_at desc);

create table if not exists hearthland.blocks (
  blocker_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  blocked_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (blocker_account_id, blocked_account_id),
  constraint blocks_no_self_check check (blocker_account_id <> blocked_account_id)
);

create index if not exists blocks_blocked_idx
  on hearthland.blocks (blocked_account_id, blocker_account_id);

create table if not exists hearthland.follows (
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, entity_id)
);

create index if not exists follows_entity_idx
  on hearthland.follows (entity_id, created_at desc);

create table if not exists hearthland.saved_entities (
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, entity_id)
);

create index if not exists saved_entities_account_idx
  on hearthland.saved_entities (account_id, created_at desc);

create table if not exists hearthland.conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_kind text not null default 'direct' check (conversation_kind in (
    'direct', 'community_interest', 'opportunity_application', 'camp_application',
    'need_response', 'invitation', 'land_enquiry'
  )),
  context_entity_id uuid references hearthland.entities(id) on delete set null,
  context_record_type text,
  context_record_id uuid,
  direct_pair_key text,
  subject text,
  created_by_account_id uuid not null references hearthland.accounts(id) on delete restrict,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint direct_conversation_key_check check (
    conversation_kind <> 'direct' or direct_pair_key is not null
  )
);

create unique index if not exists conversations_direct_pair_unique
  on hearthland.conversations (direct_pair_key)
  where conversation_kind = 'direct' and archived_at is null;
create index if not exists conversations_context_idx
  on hearthland.conversations (context_entity_id, context_record_type, context_record_id)
  where archived_at is null;

create table if not exists hearthland.conversation_members (
  conversation_id uuid not null references hearthland.conversations(id) on delete cascade,
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  member_role text not null default 'participant' check (member_role in ('participant', 'manager')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted_at timestamptz,
  left_at timestamptz,
  primary key (conversation_id, account_id)
);

create index if not exists conversation_members_account_idx
  on hearthland.conversation_members (account_id, left_at, last_read_at);

create table if not exists hearthland.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references hearthland.conversations(id) on delete cascade,
  sender_account_id uuid not null references hearthland.accounts(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists messages_conversation_idx
  on hearthland.messages (conversation_id, created_at desc) where deleted_at is null;
create index if not exists messages_sender_idx
  on hearthland.messages (sender_account_id, created_at desc);

create table if not exists hearthland.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references hearthland.accounts(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null default '',
  target_url text,
  actor_account_id uuid references hearthland.accounts(id) on delete set null,
  entity_id uuid references hearthland.entities(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_unread_idx
  on hearthland.notifications (account_id, created_at desc) where read_at is null;
create index if not exists notifications_account_idx
  on hearthland.notifications (account_id, created_at desc);

create table if not exists hearthland.notification_preferences (
  account_id uuid primary key references hearthland.accounts(id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  connection_notifications boolean not null default true,
  invitation_notifications boolean not null default true,
  application_notifications boolean not null default true,
  message_notifications boolean not null default true,
  project_update_notifications boolean not null default true,
  upcoming_camp_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hearthland.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_account_id uuid not null references hearthland.accounts(id) on delete cascade,
  reported_entity_id uuid references hearthland.entities(id) on delete set null,
  reported_account_id uuid references hearthland.accounts(id) on delete set null,
  reason text not null check (reason in (
    'spam', 'scam', 'misleading_information', 'harassment', 'unsafe_behaviour',
    'duplicate', 'inappropriate_content', 'other'
  )),
  details text not null default '',
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  assigned_to_account_id uuid references hearthland.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint report_target_check check (
    reported_entity_id is not null or reported_account_id is not null
  )
);

create index if not exists reports_moderation_idx
  on hearthland.reports (status, created_at desc);

create table if not exists hearthland.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references hearthland.reports(id) on delete set null,
  target_entity_id uuid references hearthland.entities(id) on delete set null,
  target_account_id uuid references hearthland.accounts(id) on delete set null,
  action_type text not null check (action_type in (
    'dismiss', 'mark_reviewed', 'hide_entity', 'suspend_entity',
    'restore_entity', 'suspend_account', 'restore_account'
  )),
  reason text not null default '',
  performed_by_account_id uuid not null references hearthland.accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint moderation_target_check check (
    target_entity_id is not null or target_account_id is not null or report_id is not null
  )
);

create index if not exists moderation_actions_report_idx
  on hearthland.moderation_actions (report_id, created_at desc);

create table if not exists hearthland.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_account_id uuid references hearthland.accounts(id) on delete set null,
  entity_id uuid not null references hearthland.entities(id) on delete cascade,
  event_type text not null,
  summary text not null,
  visibility text not null default 'members' check (visibility in ('public', 'members', 'managers', 'private')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists activity_events_entity_idx
  on hearthland.activity_events (entity_id, created_at desc);

-- Transitional audit/import target for the current D1 generic event records.
-- Dedicated domain records above remain the production source of truth.
create table if not exists hearthland.action_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references hearthland.accounts(id) on delete set null,
  action_type text not null,
  entity_id uuid references hearthland.entities(id) on delete set null,
  legacy_entity_type text,
  legacy_external_id text,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  status text not null default 'imported',
  occurred_at timestamptz not null default now(),
  imported_from text not null default 'd1',
  unique (imported_from, legacy_entity_type, legacy_external_id, action_type, account_id, occurred_at)
);

create index if not exists action_events_account_idx
  on hearthland.action_events (account_id, occurred_at desc);
create index if not exists action_events_entity_idx
  on hearthland.action_events (entity_id, action_type, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Central authorization helpers
-- ---------------------------------------------------------------------------

create or replace function hearthland_private.is_platform_staff(required_roles text[] default array['admin', 'moderator']::text[])
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
      from hearthland.platform_roles pr
      where pr.account_id = (select auth.uid())
        and pr.role = any(required_roles)
        and pr.revoked_at is null
    ),
    false
  );
$$;

create or replace function hearthland_private.owns_entity(target_entity_id uuid)
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
      from hearthland.entities e
      where e.id = target_entity_id
        and e.owner_account_id = (select auth.uid())
    ),
    false
  );
$$;

create or replace function hearthland_private.can_manage_entity(target_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (select auth.uid()) is not null
    and (
      exists (
        select 1
        from hearthland.entities e
        where e.id = target_entity_id
          and e.owner_account_id = (select auth.uid())
      )
      or exists (
        select 1
        from hearthland.entity_roles er
        where er.entity_id = target_entity_id
          and er.account_id = (select auth.uid())
          and er.role in ('owner', 'administrator')
          and er.status = 'active'
      )
      or hearthland_private.is_platform_staff(array['admin']::text[])
    ),
    false
  );
$$;

create or replace function hearthland_private.is_entity_member(target_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (select auth.uid()) is not null
    and (
      hearthland_private.can_manage_entity(target_entity_id)
      or exists (
        select 1
        from hearthland.entity_roles er
        where er.entity_id = target_entity_id
          and er.account_id = (select auth.uid())
          and er.status = 'active'
      )
      or exists (
        select 1
        from hearthland.entity_memberships em
        where em.entity_id = target_entity_id
          and em.account_id = (select auth.uid())
          and em.status = 'active'
      )
    ),
    false
  );
$$;

create or replace function hearthland_private.is_blocked_with(other_account_id uuid)
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
      from hearthland.blocks b
      where (b.blocker_account_id = (select auth.uid()) and b.blocked_account_id = other_account_id)
         or (b.blocker_account_id = other_account_id and b.blocked_account_id = (select auth.uid()))
    ),
    false
  );
$$;

create or replace function hearthland_private.is_connected_with(other_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (select auth.uid()) is not null
    and not hearthland_private.is_blocked_with(other_account_id)
    and exists (
      select 1
      from hearthland.connections c
      where c.status = 'accepted'
        and (
          (c.requester_account_id = (select auth.uid()) and c.receiver_account_id = other_account_id)
          or (c.receiver_account_id = (select auth.uid()) and c.requester_account_id = other_account_id)
        )
    ),
    false
  );
$$;

create or replace function hearthland_private.can_view_entity(target_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(exists (
    select 1
    from hearthland.entities e
    where e.id = target_entity_id
      and e.archived_at is null
      and (
        (e.publication_status = 'published' and e.visibility = 'public')
        or (
          (select auth.uid()) is not null
          and e.publication_status = 'published'
          and e.visibility = 'members'
        )
        or hearthland_private.is_entity_member(e.id)
        or (
          (select auth.uid()) is not null
          and e.visibility = 'connections'
          and e.owner_account_id is not null
          and hearthland_private.is_connected_with(e.owner_account_id)
        )
        or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
      )
  ), false);
$$;

create or replace function hearthland_private.can_view_profile(target_profile_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select hearthland_private.can_view_entity(target_profile_entity_id)
    and not exists (
      select 1
      from hearthland.person_profiles p
      where p.entity_id = target_profile_entity_id
        and p.account_id is not null
        and hearthland_private.is_blocked_with(p.account_id)
    );
$$;

create or replace function hearthland_private.is_conversation_member(target_conversation_id uuid)
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
      from hearthland.conversation_members cm
      where cm.conversation_id = target_conversation_id
        and cm.account_id = (select auth.uid())
        and cm.left_at is null
    ),
    false
  );
$$;

create or replace function hearthland_private.storage_path_uuid(object_name text, expected_prefix text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  candidate text;
begin
  if split_part(object_name, '/', 1) <> expected_prefix then
    return null;
  end if;
  candidate := split_part(object_name, '/', 2);
  if candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return candidate::uuid;
end;
$$;

revoke all on function hearthland_private.is_platform_staff(text[]) from public;
revoke all on function hearthland_private.owns_entity(uuid) from public;
revoke all on function hearthland_private.can_manage_entity(uuid) from public;
revoke all on function hearthland_private.is_entity_member(uuid) from public;
revoke all on function hearthland_private.is_blocked_with(uuid) from public;
revoke all on function hearthland_private.is_connected_with(uuid) from public;
revoke all on function hearthland_private.can_view_entity(uuid) from public;
revoke all on function hearthland_private.can_view_profile(uuid) from public;
revoke all on function hearthland_private.is_conversation_member(uuid) from public;
revoke all on function hearthland_private.storage_path_uuid(text, text) from public;

grant execute on function hearthland_private.can_view_entity(uuid) to anon, authenticated;
grant execute on function hearthland_private.can_view_profile(uuid) to anon, authenticated;
grant execute on function hearthland_private.storage_path_uuid(text, text) to anon, authenticated;
-- These boolean-only helpers safely return false for anon because auth.uid()
-- is null; anon execution is needed by public SELECT policies that combine
-- public and manager/member branches.
grant execute on function hearthland_private.is_platform_staff(text[]) to anon, authenticated;
grant execute on function hearthland_private.owns_entity(uuid) to anon, authenticated;
grant execute on function hearthland_private.can_manage_entity(uuid) to anon, authenticated;
grant execute on function hearthland_private.is_entity_member(uuid) to anon, authenticated;
grant execute on function hearthland_private.is_blocked_with(uuid) to anon, authenticated;
grant execute on function hearthland_private.is_connected_with(uuid) to anon, authenticated;
grant execute on function hearthland_private.is_conversation_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Integrity and lifecycle triggers
-- ---------------------------------------------------------------------------

create or replace function hearthland_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'hearthland'
      and c.column_name = 'updated_at'
  loop
    execute format('drop trigger if exists set_hearthland_updated_at on hearthland.%I', target.table_name);
    execute format(
      'create trigger set_hearthland_updated_at before update on hearthland.%I '
      'for each row execute function hearthland_private.set_updated_at()',
      target.table_name
    );
  end loop;
end;
$$;

create or replace function hearthland_private.guard_entity_changes()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    if new.publication_status = 'published' and new.published_at is null then
      new.published_at := now();
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.entity_type <> old.entity_type
     or new.created_by_account_id is distinct from old.created_by_account_id then
    raise exception 'Immutable entity identity/provenance fields cannot be changed';
  end if;

  if (new.is_seeded_demo is distinct from old.is_seeded_demo
      or new.seed_key is distinct from old.seed_key
      or new.seed_batch_id is distinct from old.seed_batch_id)
     and not hearthland_private.is_platform_staff(array['admin']::text[]) then
    raise exception 'Seed provenance can only be changed by a platform administrator';
  end if;

  if new.owner_account_id is distinct from old.owner_account_id
     and not (
       old.owner_account_id = (select auth.uid())
       or hearthland_private.is_platform_staff(array['admin']::text[])
     ) then
    raise exception 'Only the current owner can transfer entity ownership';
  end if;

  if new.publication_status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.publication_status <> 'published' and old.publication_status = 'published' then
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_entity_changes on hearthland.entities;
create trigger guard_hearthland_entity_changes
before update on hearthland.entities
for each row execute function hearthland_private.guard_entity_changes();

create or replace function hearthland_private.sync_entity_owner_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and old.owner_account_id is distinct from new.owner_account_id then
    delete from hearthland.entity_roles
    where entity_id = new.id and account_id = old.owner_account_id and role = 'owner';
  end if;

  if new.owner_account_id is not null then
    insert into hearthland.entity_roles (
      entity_id, account_id, role, status, granted_by_account_id
    ) values (
      new.id, new.owner_account_id, 'owner', 'active', coalesce((select auth.uid()), new.owner_account_id)
    )
    on conflict (entity_id, account_id) do update
      set role = 'owner', status = 'active', updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists sync_hearthland_entity_owner_role on hearthland.entities;
create trigger sync_hearthland_entity_owner_role
after insert or update of owner_account_id on hearthland.entities
for each row execute function hearthland_private.sync_entity_owner_role();

create or replace function hearthland_private.guard_person_profile_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.account_id is null
     and not exists (
       select 1 from hearthland.entities e
       where e.id = new.entity_id and e.is_seeded_demo
     ) then
    raise exception 'Only seeded demo profiles may omit account_id';
  end if;
  if new.account_id is not null
     and not exists (
       select 1 from hearthland.entities e
       where e.id = new.entity_id and e.owner_account_id = new.account_id
     ) then
    raise exception 'Profile account must own its profile entity';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_person_profile_account on hearthland.person_profiles;
create trigger guard_hearthland_person_profile_account
before insert or update of account_id, entity_id on hearthland.person_profiles
for each row execute function hearthland_private.guard_person_profile_account();

create or replace function hearthland_private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  profile_entity_id uuid;
  chosen_name text;
begin
  chosen_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'member'), '@', 1),
    'Hearthland member'
  );

  insert into hearthland.accounts (id, email, display_name)
  values (new.id, coalesce(new.email, new.id::text || '@pending.local'), chosen_name)
  on conflict (id) do update
    set email = excluded.email,
        display_name = case
          when hearthland.accounts.display_name = '' then excluded.display_name
          else hearthland.accounts.display_name
        end,
        updated_at = now();

  select p.entity_id into profile_entity_id
  from hearthland.person_profiles p
  where p.account_id = new.id;

  if profile_entity_id is null then
    profile_entity_id := gen_random_uuid();
    insert into hearthland.entities (
      id, entity_type, slug, title, publication_status, visibility,
      owner_account_id, created_by_account_id
    ) values (
      profile_entity_id,
      'person_profile',
      'person-' || replace(new.id::text, '-', ''),
      chosen_name,
      'draft',
      'members',
      new.id,
      new.id
    );

    insert into hearthland.person_profiles (entity_id, account_id, display_name)
    values (profile_entity_id, new.id, chosen_name);
  end if;

  insert into hearthland.notification_preferences (account_id)
  values (new.id)
  on conflict (account_id) do nothing;

  return new;
end;
$$;

revoke all on function hearthland_private.handle_auth_user() from public;

drop trigger if exists on_hearthland_auth_user_changed on auth.users;
create trigger on_hearthland_auth_user_changed
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function hearthland_private.handle_auth_user();

-- Backfill auth users that existed before this migration. The statements are
-- conflict-aware and create only missing Hearthland account/profile records.
insert into hearthland.accounts (id, email, display_name)
select
  u.id,
  coalesce(u.email, u.id::text || '@pending.local'),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(u.email, 'member'), '@', 1),
    'Hearthland member'
  )
from auth.users u
on conflict (id) do nothing;

with missing_accounts as (
  select a.id, a.display_name, gen_random_uuid() as entity_id
  from hearthland.accounts a
  left join hearthland.person_profiles p on p.account_id = a.id
  where p.account_id is null
), inserted_entities as (
  insert into hearthland.entities (
    id, entity_type, slug, title, publication_status, visibility,
    owner_account_id, created_by_account_id
  )
  select
    m.entity_id,
    'person_profile',
    'person-' || replace(m.id::text, '-', ''),
    m.display_name,
    'draft',
    'members',
    m.id,
    m.id
  from missing_accounts m
  returning id, owner_account_id, title
)
insert into hearthland.person_profiles (entity_id, account_id, display_name)
select id, owner_account_id, title
from inserted_entities
on conflict (account_id) do nothing;

insert into hearthland.notification_preferences (account_id)
select id from hearthland.accounts
on conflict (account_id) do nothing;

create or replace function hearthland_private.claim_invitation(invitation_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  claimed_id uuid;
  current_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select lower(a.email) into current_email
  from hearthland.accounts a
  where a.id = (select auth.uid());

  update hearthland.invitations i
  set invited_account_id = (select auth.uid()), updated_at = now()
  where i.token_hash = invitation_token_hash
    and i.status = 'pending'
    and i.expires_at > now()
    and (i.invited_account_id is null or i.invited_account_id = (select auth.uid()))
    and (i.invited_email is null or lower(i.invited_email) = current_email)
  returning i.id into claimed_id;

  if claimed_id is null then
    raise exception 'Invitation is invalid, expired, or belongs to another account';
  end if;
  return claimed_id;
end;
$$;

revoke all on function hearthland_private.claim_invitation(text) from public;
grant execute on function hearthland_private.claim_invitation(text) to authenticated;

create or replace function hearthland_private.sync_accepted_invitation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    if new.invited_account_id is null then
      raise exception 'Invitation must be claimed before acceptance';
    end if;
    new.accepted_by_account_id := new.invited_account_id;
    new.responded_at := coalesce(new.responded_at, now());

    if new.proposed_role = 'administrator' then
      insert into hearthland.entity_roles (
        entity_id, account_id, role, status, granted_by_account_id
      ) values (
        new.entity_id, new.invited_account_id, 'administrator', 'active', new.invited_by_account_id
      )
      on conflict (entity_id, account_id) do update
        set role = 'administrator', status = 'active', updated_at = now();
    else
      insert into hearthland.entity_memberships (
        entity_id, account_id, membership_type, status, joined_at, created_by_account_id
      ) values (
        new.entity_id, new.invited_account_id, new.proposed_role, 'active', now(), new.invited_by_account_id
      )
      on conflict (entity_id, account_id, membership_type) do update
        set status = 'active', joined_at = coalesce(hearthland.entity_memberships.joined_at, now()), updated_at = now();
    end if;

    if new.invitation_type in ('camp_team', 'camp_master') then
      insert into hearthland.camp_team (
        camp_entity_id, account_id, role, is_master, invitation_id
      ) values (
        new.entity_id,
        new.invited_account_id,
        new.proposed_role,
        new.invitation_type = 'camp_master',
        new.id
      )
      on conflict (camp_entity_id, account_id, role) do update
        set is_master = excluded.is_master, invitation_id = excluded.invitation_id, updated_at = now();
    end if;

    insert into hearthland.notifications (
      account_id, notification_type, title, body, entity_id, actor_account_id
    ) values (
      new.invited_by_account_id,
      'invitation_accepted',
      'Invitation accepted',
      'A Hearthland invitation was accepted.',
      new.entity_id,
      new.invited_account_id
    );
  elsif new.status in ('declined', 'revoked', 'expired') and old.status = 'pending' then
    new.responded_at := coalesce(new.responded_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists sync_hearthland_accepted_invitation on hearthland.invitations;
create trigger sync_hearthland_accepted_invitation
before update of status on hearthland.invitations
for each row execute function hearthland_private.sync_accepted_invitation();

create or replace function hearthland_private.sync_accepted_camp_application()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into hearthland.entity_memberships (
      entity_id, account_id, membership_type, status, joined_at, created_by_account_id
    ) values (
      new.camp_entity_id, new.applicant_account_id, 'participant', 'active', now(), (select auth.uid())
    )
    on conflict (entity_id, account_id, membership_type) do update
      set status = 'active', joined_at = coalesce(hearthland.entity_memberships.joined_at, now()), updated_at = now();

    insert into hearthland.notifications (
      account_id, notification_type, title, body, entity_id, actor_account_id
    ) values (
      new.applicant_account_id,
      'camp_application_accepted',
      'Building Camp application accepted',
      'Your Building Camp application has been accepted.',
      new.camp_entity_id,
      (select auth.uid())
    );
  elsif old.status = 'accepted' and new.status in ('cancelled', 'withdrawn', 'declined') then
    update hearthland.entity_memberships
    set status = 'inactive', updated_at = now()
    where entity_id = new.camp_entity_id
      and account_id = new.applicant_account_id
      and membership_type = 'participant';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_hearthland_accepted_camp_application on hearthland.camp_applications;
create trigger sync_hearthland_accepted_camp_application
after update of status on hearthland.camp_applications
for each row execute function hearthland_private.sync_accepted_camp_application();

create or replace function hearthland_private.touch_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update hearthland.conversations
  set last_message_at = new.created_at, updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists touch_hearthland_conversation_from_message on hearthland.messages;
create trigger touch_hearthland_conversation_from_message
after insert on hearthland.messages
for each row execute function hearthland_private.touch_conversation_from_message();

create or replace function hearthland_private.guard_invitation_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_id uuid := (select auth.uid());
begin
  if current_id is null then
    return new;
  end if;

  if new.id <> old.id
     or new.entity_id <> old.entity_id
     or new.invited_by_account_id <> old.invited_by_account_id
     or new.invitation_type <> old.invitation_type
     or new.proposed_role <> old.proposed_role
     or new.message <> old.message
     or new.practical_arrangements <> old.practical_arrangements
     or new.token_hash is distinct from old.token_hash
     or new.invited_email is distinct from old.invited_email then
    raise exception 'Invitation identity and provenance are immutable';
  end if;

  if current_id = old.invited_account_id
     and not hearthland_private.can_manage_entity(old.entity_id)
     and new.status not in ('accepted', 'declined') then
    raise exception 'Invitees may only accept or decline invitations';
  end if;

  if hearthland_private.can_manage_entity(old.entity_id)
     and current_id <> old.invited_account_id
     and new.status not in ('pending', 'revoked', 'expired') then
    raise exception 'Managers may only revoke or expire pending invitations';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_invitation_update on hearthland.invitations;
create trigger guard_hearthland_invitation_update
before update on hearthland.invitations
for each row execute function hearthland_private.guard_invitation_update();

create or replace function hearthland_private.guard_application_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_id uuid := (select auth.uid());
  applicant_id uuid;
  parent_entity_id uuid;
begin
  if current_id is null then
    return new;
  end if;

  if tg_table_name = 'opportunity_applications' then
    applicant_id := old.applicant_account_id;
    parent_entity_id := old.opportunity_entity_id;
    if new.id <> old.id
       or new.applicant_account_id <> old.applicant_account_id
       or new.opportunity_entity_id <> old.opportunity_entity_id then
      raise exception 'Application identity is immutable';
    end if;
    if current_id = applicant_id
       and not hearthland_private.can_manage_entity(parent_entity_id)
       and new.status <> 'withdrawn' then
      raise exception 'Applicants may only withdraw their own submitted application';
    end if;
  elsif tg_table_name = 'camp_applications' then
    applicant_id := old.applicant_account_id;
    parent_entity_id := old.camp_entity_id;
    if new.id <> old.id
       or new.applicant_account_id <> old.applicant_account_id
       or new.camp_entity_id <> old.camp_entity_id then
      raise exception 'Application identity is immutable';
    end if;
    if current_id = applicant_id
       and not hearthland_private.can_manage_entity(parent_entity_id)
       and new.status not in ('withdrawn', 'cancelled') then
      raise exception 'Applicants may only withdraw or cancel their own application';
    end if;
  elsif tg_table_name = 'community_interests' then
    applicant_id := old.applicant_account_id;
    parent_entity_id := old.community_entity_id;
    if new.id <> old.id
       or new.applicant_account_id <> old.applicant_account_id
       or new.community_entity_id <> old.community_entity_id then
      raise exception 'Interest identity is immutable';
    end if;
    if current_id = applicant_id
       and not hearthland_private.can_manage_entity(parent_entity_id)
       and new.pipeline_status <> 'withdrawn' then
      raise exception 'Applicants may only withdraw their own interest';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_opportunity_application_update on hearthland.opportunity_applications;
create trigger guard_hearthland_opportunity_application_update
before update on hearthland.opportunity_applications
for each row execute function hearthland_private.guard_application_update();

drop trigger if exists guard_hearthland_camp_application_update on hearthland.camp_applications;
create trigger guard_hearthland_camp_application_update
before update on hearthland.camp_applications
for each row execute function hearthland_private.guard_application_update();

drop trigger if exists guard_hearthland_community_interest_update on hearthland.community_interests;
create trigger guard_hearthland_community_interest_update
before update on hearthland.community_interests
for each row execute function hearthland_private.guard_application_update();

create or replace function hearthland_private.validate_community_interest_parent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from hearthland.entities e
    where e.id = new.community_entity_id
      and e.entity_type in ('community', 'emerging_community')
  ) then
    raise exception 'Community interest parent must be a community or emerging community';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_hearthland_community_interest_parent on hearthland.community_interests;
create trigger validate_hearthland_community_interest_parent
before insert or update of community_entity_id on hearthland.community_interests
for each row execute function hearthland_private.validate_community_interest_parent();

create or replace function hearthland_private.guard_connection_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.requester_account_id <> old.requester_account_id
     or new.receiver_account_id <> old.receiver_account_id then
    raise exception 'Connection participants are immutable';
  end if;
  if (select auth.uid()) = old.receiver_account_id
     and new.status not in ('accepted', 'declined') then
    raise exception 'Receiver may only accept or decline';
  end if;
  if (select auth.uid()) = old.requester_account_id
     and new.status <> 'cancelled' then
    raise exception 'Requester may only cancel';
  end if;
  if new.status <> 'pending' then
    new.responded_at := coalesce(new.responded_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_connection_update on hearthland.connections;
create trigger guard_hearthland_connection_update
before update on hearthland.connections
for each row execute function hearthland_private.guard_connection_update();

create or replace function hearthland_private.guard_conversation_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.id <> old.id
     or new.conversation_kind <> old.conversation_kind
     or new.context_entity_id is distinct from old.context_entity_id
     or new.context_record_type is distinct from old.context_record_type
     or new.context_record_id is distinct from old.context_record_id
     or new.direct_pair_key is distinct from old.direct_pair_key
     or new.created_by_account_id <> old.created_by_account_id then
    raise exception 'Conversation identity and context are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_conversation_identity on hearthland.conversations;
create trigger guard_hearthland_conversation_identity
before update on hearthland.conversations
for each row execute function hearthland_private.guard_conversation_identity();

create or replace function hearthland_private.guard_message_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.id <> old.id
     or new.conversation_id <> old.conversation_id
     or new.sender_account_id <> old.sender_account_id
     or new.created_at <> old.created_at then
    raise exception 'Message identity is immutable';
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_message_identity on hearthland.messages;
create trigger guard_hearthland_message_identity
before update on hearthland.messages
for each row execute function hearthland_private.guard_message_identity();

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
  if (select auth.uid()) = old.account_id
     and not hearthland_private.can_manage_entity(old.entity_id)
     and new.status not in ('requested', 'inactive', 'former') then
    raise exception 'Members cannot activate or promote their own membership';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_hearthland_membership_update on hearthland.entity_memberships;
create trigger guard_hearthland_membership_update
before update on hearthland.entity_memberships
for each row execute function hearthland_private.guard_membership_update();

-- ---------------------------------------------------------------------------
-- Data API grants and Row Level Security
-- ---------------------------------------------------------------------------

revoke all on all tables in schema hearthland from anon, authenticated;
grant select on all tables in schema hearthland to anon, authenticated;
grant insert, update, delete on all tables in schema hearthland to authenticated;
grant all on all tables in schema hearthland to service_role;

-- Accounts are created by the auth trigger. Client updates are column-limited.
revoke insert, delete, update on hearthland.accounts from authenticated;
grant update (display_name, locale, timezone, last_active_at, settings, onboarding_status, archived_at)
  on hearthland.accounts to authenticated;

-- Platform roles, seed metadata, notifications, and audit records are written
-- only through trusted functions/service-side operations.
revoke insert, update, delete on hearthland.platform_roles from authenticated;
revoke insert, update, delete on hearthland.seed_batches from authenticated;
revoke insert, delete on hearthland.notifications from authenticated;
revoke update on hearthland.notifications from authenticated;
grant update (read_at) on hearthland.notifications to authenticated;
revoke insert, update, delete on hearthland.activity_events from authenticated;
revoke insert, update, delete on hearthland.action_events from authenticated;
revoke insert, update, delete on hearthland.moderation_actions from authenticated;

do $$
declare
  target record;
begin
  for target in
    select table_name
    from information_schema.tables
    where table_schema = 'hearthland' and table_type = 'BASE TABLE'
  loop
    execute format('alter table hearthland.%I enable row level security', target.table_name);
  end loop;
end;
$$;

drop policy if exists accounts_select on hearthland.accounts;
create policy accounts_select on hearthland.accounts
for select to authenticated
using (
  id = (select auth.uid())
  or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
);

drop policy if exists accounts_update on hearthland.accounts;
create policy accounts_update on hearthland.accounts
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists platform_roles_select on hearthland.platform_roles;
create policy platform_roles_select on hearthland.platform_roles
for select to authenticated
using (
  account_id = (select auth.uid())
  or hearthland_private.is_platform_staff(array['admin']::text[])
);

drop policy if exists seed_batches_select on hearthland.seed_batches;
create policy seed_batches_select on hearthland.seed_batches
for select to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists entities_select on hearthland.entities;
create policy entities_select on hearthland.entities
for select to anon, authenticated
using (hearthland_private.can_view_entity(id));

drop policy if exists entities_insert on hearthland.entities;
create policy entities_insert on hearthland.entities
for insert to authenticated
with check (
  owner_account_id = (select auth.uid())
  and created_by_account_id = (select auth.uid())
  and not is_seeded_demo
  and seed_key is null
  and seed_batch_id is null
);

drop policy if exists entities_update on hearthland.entities;
create policy entities_update on hearthland.entities
for update to authenticated
using (hearthland_private.can_manage_entity(id))
with check (hearthland_private.can_manage_entity(id));

-- One-to-one managed domain rows inherit visibility and management from their
-- central entity registry row.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'communities',
    'emerging_communities',
    'settlement_projects',
    'land_listings',
    'organisations',
    'opportunities',
    'learning_topics',
    'building_camps'
  ]
  loop
    execute format('drop policy if exists managed_entity_select on hearthland.%I', table_name);
    execute format(
      'create policy managed_entity_select on hearthland.%I for select to anon, authenticated '
      'using (hearthland_private.can_view_entity(entity_id))',
      table_name
    );
    execute format('drop policy if exists managed_entity_insert on hearthland.%I', table_name);
    execute format(
      'create policy managed_entity_insert on hearthland.%I for insert to authenticated '
      'with check (hearthland_private.can_manage_entity(entity_id))',
      table_name
    );
    execute format('drop policy if exists managed_entity_update on hearthland.%I', table_name);
    execute format(
      'create policy managed_entity_update on hearthland.%I for update to authenticated '
      'using (hearthland_private.can_manage_entity(entity_id)) '
      'with check (hearthland_private.can_manage_entity(entity_id))',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists person_profiles_select on hearthland.person_profiles;
create policy person_profiles_select on hearthland.person_profiles
for select to anon, authenticated
using (hearthland_private.can_view_profile(entity_id));

drop policy if exists person_profiles_insert on hearthland.person_profiles;
create policy person_profiles_insert on hearthland.person_profiles
for insert to authenticated
with check (
  account_id = (select auth.uid())
  and hearthland_private.owns_entity(entity_id)
);

drop policy if exists person_profiles_update on hearthland.person_profiles;
create policy person_profiles_update on hearthland.person_profiles
for update to authenticated
using (account_id = (select auth.uid()))
with check (account_id = (select auth.uid()));

drop policy if exists profile_contacts_select on hearthland.profile_contacts;
create policy profile_contacts_select on hearthland.profile_contacts
for select to anon, authenticated
using (
  hearthland_private.can_manage_entity(profile_entity_id)
  or (
    visibility = 'public'
    and hearthland_private.can_view_profile(profile_entity_id)
  )
  or (
    visibility = 'members'
    and (select auth.uid()) is not null
    and hearthland_private.can_view_profile(profile_entity_id)
  )
  or (
    visibility = 'connections'
    and exists (
      select 1 from hearthland.person_profiles p
      where p.entity_id = profile_entity_id
        and p.account_id is not null
        and hearthland_private.is_connected_with(p.account_id)
    )
  )
);

drop policy if exists profile_contacts_insert on hearthland.profile_contacts;
create policy profile_contacts_insert on hearthland.profile_contacts
for insert to authenticated
with check (hearthland_private.owns_entity(profile_entity_id));

drop policy if exists profile_contacts_update on hearthland.profile_contacts;
create policy profile_contacts_update on hearthland.profile_contacts
for update to authenticated
using (hearthland_private.owns_entity(profile_entity_id))
with check (hearthland_private.owns_entity(profile_entity_id));

drop policy if exists profile_locations_select on hearthland.profile_locations;
create policy profile_locations_select on hearthland.profile_locations
for select to anon, authenticated
using (
  hearthland_private.owns_entity(profile_entity_id)
  or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
  or (
    visibility = 'public'
    and hearthland_private.can_view_profile(profile_entity_id)
  )
  or (
    visibility = 'members'
    and (select auth.uid()) is not null
    and hearthland_private.can_view_profile(profile_entity_id)
  )
  or (
    visibility = 'connections'
    and exists (
      select 1 from hearthland.person_profiles p
      where p.entity_id = profile_entity_id
        and p.account_id is not null
        and hearthland_private.is_connected_with(p.account_id)
    )
  )
);

drop policy if exists profile_locations_insert on hearthland.profile_locations;
create policy profile_locations_insert on hearthland.profile_locations
for insert to authenticated
with check (hearthland_private.owns_entity(profile_entity_id));

drop policy if exists profile_locations_update on hearthland.profile_locations;
create policy profile_locations_update on hearthland.profile_locations
for update to authenticated
using (hearthland_private.owns_entity(profile_entity_id))
with check (hearthland_private.owns_entity(profile_entity_id));

drop policy if exists profile_locations_delete on hearthland.profile_locations;
create policy profile_locations_delete on hearthland.profile_locations
for delete to authenticated
using (hearthland_private.owns_entity(profile_entity_id));

drop policy if exists user_intentions_own on hearthland.user_intentions;
create policy user_intentions_own on hearthland.user_intentions
for all to authenticated
using (account_id = (select auth.uid()))
with check (account_id = (select auth.uid()));

do $$
declare
  table_name text;
  profile_column text;
begin
  for table_name, profile_column in values
    ('profile_preferences', 'profile_entity_id'),
    ('person_skills', 'profile_entity_id'),
    ('profile_values', 'profile_entity_id'),
    ('teaching_profiles', 'profile_entity_id'),
    ('professional_profiles', 'profile_entity_id')
  loop
    execute format('drop policy if exists profile_data_select on hearthland.%I', table_name);
    execute format(
      'create policy profile_data_select on hearthland.%I for select to anon, authenticated '
      'using (hearthland_private.can_view_profile(%I))',
      table_name, profile_column
    );
    execute format('drop policy if exists profile_data_insert on hearthland.%I', table_name);
    execute format(
      'create policy profile_data_insert on hearthland.%I for insert to authenticated '
      'with check (hearthland_private.owns_entity(%I))',
      table_name, profile_column
    );
    execute format('drop policy if exists profile_data_update on hearthland.%I', table_name);
    execute format(
      'create policy profile_data_update on hearthland.%I for update to authenticated '
      'using (hearthland_private.owns_entity(%I)) '
      'with check (hearthland_private.owns_entity(%I))',
      table_name, profile_column, profile_column
    );
    execute format('drop policy if exists profile_data_delete on hearthland.%I', table_name);
    execute format(
      'create policy profile_data_delete on hearthland.%I for delete to authenticated '
      'using (hearthland_private.owns_entity(%I))',
      table_name, profile_column
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
  active_predicate text;
begin
  for table_name, active_predicate in values
    ('skills', 'is_active'),
    ('values_catalog', 'is_active'),
    ('tags', 'true')
  loop
    execute format('drop policy if exists catalogue_select on hearthland.%I', table_name);
    execute format(
      'create policy catalogue_select on hearthland.%I for select to anon, authenticated using (%s)',
      table_name, active_predicate
    );
    execute format('drop policy if exists catalogue_manage on hearthland.%I', table_name);
    execute format(
      'create policy catalogue_manage on hearthland.%I for all to authenticated '
      'using (hearthland_private.is_platform_staff(array[''admin'']::text[])) '
      'with check (hearthland_private.is_platform_staff(array[''admin'']::text[]))',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists land_private_locations_manage on hearthland.land_private_locations;
create policy land_private_locations_manage on hearthland.land_private_locations
for all to authenticated
using (hearthland_private.can_manage_entity(land_entity_id))
with check (hearthland_private.can_manage_entity(land_entity_id));

drop policy if exists entity_roles_select on hearthland.entity_roles;
create policy entity_roles_select on hearthland.entity_roles
for select to authenticated
using (
  account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists entity_roles_insert on hearthland.entity_roles;
create policy entity_roles_insert on hearthland.entity_roles
for insert to authenticated
with check (
  hearthland_private.can_manage_entity(entity_id)
  and (
    role in ('member', 'participant')
    or hearthland_private.owns_entity(entity_id)
    or hearthland_private.is_platform_staff(array['admin']::text[])
  )
  and role <> 'owner'
);

drop policy if exists entity_roles_update on hearthland.entity_roles;
create policy entity_roles_update on hearthland.entity_roles
for update to authenticated
using (
  hearthland_private.can_manage_entity(entity_id)
  and role <> 'owner'
)
with check (
  hearthland_private.can_manage_entity(entity_id)
  and (
    role in ('member', 'participant')
    or hearthland_private.owns_entity(entity_id)
    or hearthland_private.is_platform_staff(array['admin']::text[])
  )
  and role <> 'owner'
);

drop policy if exists entity_roles_delete on hearthland.entity_roles;
create policy entity_roles_delete on hearthland.entity_roles
for delete to authenticated
using (
  role <> 'owner'
  and (
    hearthland_private.owns_entity(entity_id)
    or (
      role in ('member', 'participant')
      and hearthland_private.can_manage_entity(entity_id)
    )
  )
);

drop policy if exists entity_memberships_select on hearthland.entity_memberships;
create policy entity_memberships_select on hearthland.entity_memberships
for select to anon, authenticated
using (
  (public_visibility and status = 'active' and hearthland_private.can_view_entity(entity_id))
  or account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists entity_memberships_insert on hearthland.entity_memberships;
create policy entity_memberships_insert on hearthland.entity_memberships
for insert to authenticated
with check (
  hearthland_private.can_manage_entity(entity_id)
  or (
    account_id = (select auth.uid())
    and status = 'requested'
    and created_by_account_id = (select auth.uid())
  )
);

drop policy if exists entity_memberships_update on hearthland.entity_memberships;
create policy entity_memberships_update on hearthland.entity_memberships
for update to authenticated
using (
  account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
)
with check (
  account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists entity_memberships_delete on hearthland.entity_memberships;
create policy entity_memberships_delete on hearthland.entity_memberships
for delete to authenticated
using (
  account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists invitations_select on hearthland.invitations;
create policy invitations_select on hearthland.invitations
for select to authenticated
using (
  invited_account_id = (select auth.uid())
  or invited_by_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists invitations_insert on hearthland.invitations;
create policy invitations_insert on hearthland.invitations
for insert to authenticated
with check (
  invited_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(entity_id)
  and proposed_role <> 'owner'
  and status = 'pending'
);

drop policy if exists invitations_update on hearthland.invitations;
create policy invitations_update on hearthland.invitations
for update to authenticated
using (
  invited_account_id = (select auth.uid())
  or invited_by_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
)
with check (
  invited_account_id = (select auth.uid())
  or invited_by_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
);

do $$
declare
  table_name text;
  parent_column text;
  applicant_column text;
begin
  for table_name, parent_column, applicant_column in values
    ('opportunity_applications', 'opportunity_entity_id', 'applicant_account_id'),
    ('community_interests', 'community_entity_id', 'applicant_account_id'),
    ('camp_applications', 'camp_entity_id', 'applicant_account_id')
  loop
    execute format('drop policy if exists application_select on hearthland.%I', table_name);
    execute format(
      'create policy application_select on hearthland.%I for select to authenticated '
      'using (%I = (select auth.uid()) or hearthland_private.can_manage_entity(%I))',
      table_name, applicant_column, parent_column
    );
    execute format('drop policy if exists application_insert on hearthland.%I', table_name);
    execute format(
      'create policy application_insert on hearthland.%I for insert to authenticated '
      'with check (%I = (select auth.uid()) and hearthland_private.can_view_entity(%I))',
      table_name, applicant_column, parent_column
    );
    execute format('drop policy if exists application_update on hearthland.%I', table_name);
    execute format(
      'create policy application_update on hearthland.%I for update to authenticated '
      'using (%I = (select auth.uid()) or hearthland_private.can_manage_entity(%I)) '
      'with check (%I = (select auth.uid()) or hearthland_private.can_manage_entity(%I))',
      table_name, applicant_column, parent_column, applicant_column, parent_column
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
  application_table text;
  application_fk text;
  parent_column text;
begin
  for table_name, application_table, application_fk, parent_column in values
    ('opportunity_application_notes', 'opportunity_applications', 'application_id', 'opportunity_entity_id'),
    ('community_interest_notes', 'community_interests', 'interest_id', 'community_entity_id'),
    ('camp_application_notes', 'camp_applications', 'application_id', 'camp_entity_id')
  loop
    execute format('drop policy if exists manager_notes_select on hearthland.%I', table_name);
    execute format(
      'create policy manager_notes_select on hearthland.%I for select to authenticated using ('
      'exists (select 1 from hearthland.%I a where a.id = %I and '
      'hearthland_private.can_manage_entity(a.%I)))',
      table_name, application_table, application_fk, parent_column
    );
    execute format('drop policy if exists manager_notes_insert on hearthland.%I', table_name);
    execute format(
      'create policy manager_notes_insert on hearthland.%I for insert to authenticated with check ('
      'created_by_account_id = (select auth.uid()) and exists ('
      'select 1 from hearthland.%I a where a.id = %I and '
      'hearthland_private.can_manage_entity(a.%I)))',
      table_name, application_table, application_fk, parent_column
    );
    execute format('drop policy if exists manager_notes_update on hearthland.%I', table_name);
    execute format(
      'create policy manager_notes_update on hearthland.%I for update to authenticated using ('
      'exists (select 1 from hearthland.%I a where a.id = %I and '
      'hearthland_private.can_manage_entity(a.%I))) with check ('
      'exists (select 1 from hearthland.%I a where a.id = %I and '
      'hearthland_private.can_manage_entity(a.%I)))',
      table_name, application_table, application_fk, parent_column,
      application_table, application_fk, parent_column
    );
    execute format('drop policy if exists manager_notes_delete on hearthland.%I', table_name);
    execute format(
      'create policy manager_notes_delete on hearthland.%I for delete to authenticated using ('
      'exists (select 1 from hearthland.%I a where a.id = %I and '
      'hearthland_private.can_manage_entity(a.%I)))',
      table_name, application_table, application_fk, parent_column
    );
  end loop;
end;
$$;

-- Child records inherit the visibility of their parent managed entity.
do $$
declare
  table_name text;
  parent_column text;
begin
  for table_name, parent_column in values
    ('land_wanted', 'project_entity_id'),
    ('camp_build_items', 'camp_entity_id'),
    ('camp_learning_topics', 'camp_entity_id'),
    ('camp_schedule_items', 'camp_entity_id'),
    ('entity_skill_needs', 'entity_id'),
    ('entity_values', 'entity_id'),
    ('needs', 'entity_id'),
    ('offers', 'provider_entity_id'),
    ('project_stage_progress', 'project_entity_id'),
    ('project_milestones', 'project_entity_id'),
    ('entity_tags', 'entity_id')
  loop
    execute format('drop policy if exists entity_child_select on hearthland.%I', table_name);
    execute format(
      'create policy entity_child_select on hearthland.%I for select to anon, authenticated '
      'using (hearthland_private.can_view_entity(%I))',
      table_name, parent_column
    );
    execute format('drop policy if exists entity_child_insert on hearthland.%I', table_name);
    execute format(
      'create policy entity_child_insert on hearthland.%I for insert to authenticated '
      'with check (hearthland_private.can_manage_entity(%I))',
      table_name, parent_column
    );
    execute format('drop policy if exists entity_child_update on hearthland.%I', table_name);
    execute format(
      'create policy entity_child_update on hearthland.%I for update to authenticated '
      'using (hearthland_private.can_manage_entity(%I)) '
      'with check (hearthland_private.can_manage_entity(%I))',
      table_name, parent_column, parent_column
    );
    execute format('drop policy if exists entity_child_delete on hearthland.%I', table_name);
    execute format(
      'create policy entity_child_delete on hearthland.%I for delete to authenticated '
      'using (hearthland_private.can_manage_entity(%I))',
      table_name, parent_column
    );
  end loop;
end;
$$;

drop policy if exists tasks_select on hearthland.tasks;
create policy tasks_select on hearthland.tasks
for select to authenticated
using (
  assignee_account_id = (select auth.uid())
  or hearthland_private.is_entity_member(entity_id)
  or hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists tasks_insert on hearthland.tasks;
create policy tasks_insert on hearthland.tasks
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists tasks_update on hearthland.tasks;
create policy tasks_update on hearthland.tasks
for update to authenticated
using (
  assignee_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
)
with check (
  assignee_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(entity_id)
);

drop policy if exists tasks_delete on hearthland.tasks;
create policy tasks_delete on hearthland.tasks
for delete to authenticated
using (hearthland_private.can_manage_entity(entity_id));

drop policy if exists project_updates_select on hearthland.project_updates;
create policy project_updates_select on hearthland.project_updates
for select to anon, authenticated
using (
  (publication_status = 'published' and hearthland_private.can_view_entity(project_entity_id))
  or hearthland_private.can_manage_entity(project_entity_id)
);

drop policy if exists project_updates_insert on hearthland.project_updates;
create policy project_updates_insert on hearthland.project_updates
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and hearthland_private.can_manage_entity(project_entity_id)
);

drop policy if exists project_updates_update on hearthland.project_updates;
create policy project_updates_update on hearthland.project_updates
for update to authenticated
using (hearthland_private.can_manage_entity(project_entity_id))
with check (hearthland_private.can_manage_entity(project_entity_id));

drop policy if exists project_updates_delete on hearthland.project_updates;
create policy project_updates_delete on hearthland.project_updates
for delete to authenticated
using (hearthland_private.can_manage_entity(project_entity_id));

drop policy if exists camp_team_select on hearthland.camp_team;
create policy camp_team_select on hearthland.camp_team
for select to anon, authenticated
using (
  (public_visibility and hearthland_private.can_view_entity(camp_entity_id))
  or account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(camp_entity_id)
);

drop policy if exists camp_team_insert on hearthland.camp_team;
create policy camp_team_insert on hearthland.camp_team
for insert to authenticated
with check (hearthland_private.can_manage_entity(camp_entity_id));

drop policy if exists camp_team_update on hearthland.camp_team;
create policy camp_team_update on hearthland.camp_team
for update to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id))
with check (hearthland_private.can_manage_entity(camp_entity_id));

drop policy if exists camp_team_delete on hearthland.camp_team;
create policy camp_team_delete on hearthland.camp_team
for delete to authenticated
using (hearthland_private.can_manage_entity(camp_entity_id));

drop policy if exists camp_build_item_skills_select on hearthland.camp_build_item_skills;
create policy camp_build_item_skills_select on hearthland.camp_build_item_skills
for select to anon, authenticated
using (
  exists (
    select 1 from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_view_entity(bi.camp_entity_id)
  )
);

drop policy if exists camp_build_item_skills_manage on hearthland.camp_build_item_skills;
create policy camp_build_item_skills_manage on hearthland.camp_build_item_skills
for all to authenticated
using (
  exists (
    select 1 from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
)
with check (
  exists (
    select 1 from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
);

drop policy if exists need_responses_select on hearthland.need_responses;
create policy need_responses_select on hearthland.need_responses
for select to authenticated
using (
  responder_account_id = (select auth.uid())
  or exists (
    select 1 from hearthland.needs n
    where n.id = need_id and hearthland_private.can_manage_entity(n.entity_id)
  )
);

drop policy if exists need_responses_insert on hearthland.need_responses;
create policy need_responses_insert on hearthland.need_responses
for insert to authenticated
with check (
  responder_account_id = (select auth.uid())
  and exists (
    select 1 from hearthland.needs n
    where n.id = need_id and hearthland_private.can_view_entity(n.entity_id)
  )
);

drop policy if exists need_responses_update on hearthland.need_responses;
create policy need_responses_update on hearthland.need_responses
for update to authenticated
using (
  responder_account_id = (select auth.uid())
  or exists (
    select 1 from hearthland.needs n
    where n.id = need_id and hearthland_private.can_manage_entity(n.entity_id)
  )
)
with check (
  responder_account_id = (select auth.uid())
  or exists (
    select 1 from hearthland.needs n
    where n.id = need_id and hearthland_private.can_manage_entity(n.entity_id)
  )
);

drop policy if exists entity_relationships_select on hearthland.entity_relationships;
create policy entity_relationships_select on hearthland.entity_relationships
for select to anon, authenticated
using (
  archived_at is null
  and hearthland_private.can_view_entity(source_entity_id)
  and hearthland_private.can_view_entity(target_entity_id)
  and (
    visibility = 'public'
    or (visibility = 'members' and (select auth.uid()) is not null)
    or hearthland_private.can_manage_entity(source_entity_id)
  )
);

drop policy if exists entity_relationships_manage on hearthland.entity_relationships;
create policy entity_relationships_manage on hearthland.entity_relationships
for all to authenticated
using (hearthland_private.can_manage_entity(source_entity_id))
with check (hearthland_private.can_manage_entity(source_entity_id));

drop policy if exists media_assets_select on hearthland.media_assets;
create policy media_assets_select on hearthland.media_assets
for select to anon, authenticated
using (
  archived_at is null
  and (
    (
      entity_id is not null
      and hearthland_private.can_view_entity(entity_id)
      and (
        visibility = 'public'
        or (visibility = 'members' and (select auth.uid()) is not null)
        or hearthland_private.can_manage_entity(entity_id)
      )
    )
    or (
      profile_entity_id is not null
      and hearthland_private.can_view_profile(profile_entity_id)
      and (
        visibility = 'public'
        or (visibility = 'members' and (select auth.uid()) is not null)
        or hearthland_private.owns_entity(profile_entity_id)
      )
    )
  )
);

drop policy if exists media_assets_insert on hearthland.media_assets;
create policy media_assets_insert on hearthland.media_assets
for insert to authenticated
with check (
  uploader_account_id = (select auth.uid())
  and (
    (entity_id is not null and hearthland_private.can_manage_entity(entity_id))
    or (profile_entity_id is not null and hearthland_private.owns_entity(profile_entity_id))
  )
);

drop policy if exists media_assets_update on hearthland.media_assets;
create policy media_assets_update on hearthland.media_assets
for update to authenticated
using (
  (entity_id is not null and hearthland_private.can_manage_entity(entity_id))
  or (profile_entity_id is not null and hearthland_private.owns_entity(profile_entity_id))
)
with check (
  (entity_id is not null and hearthland_private.can_manage_entity(entity_id))
  or (profile_entity_id is not null and hearthland_private.owns_entity(profile_entity_id))
);

drop policy if exists media_assets_delete on hearthland.media_assets;
create policy media_assets_delete on hearthland.media_assets
for delete to authenticated
using (
  (entity_id is not null and hearthland_private.can_manage_entity(entity_id))
  or (profile_entity_id is not null and hearthland_private.owns_entity(profile_entity_id))
);

drop policy if exists creation_drafts_own on hearthland.creation_drafts;
create policy creation_drafts_own on hearthland.creation_drafts
for all to authenticated
using (account_id = (select auth.uid()))
with check (account_id = (select auth.uid()));

drop policy if exists land_enquiries_select on hearthland.land_enquiries;
create policy land_enquiries_select on hearthland.land_enquiries
for select to authenticated
using (
  sender_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(land_entity_id)
);

drop policy if exists land_enquiries_insert on hearthland.land_enquiries;
create policy land_enquiries_insert on hearthland.land_enquiries
for insert to authenticated
with check (
  sender_account_id = (select auth.uid())
  and hearthland_private.can_view_entity(land_entity_id)
);

drop policy if exists land_enquiries_update on hearthland.land_enquiries;
create policy land_enquiries_update on hearthland.land_enquiries
for update to authenticated
using (
  sender_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(land_entity_id)
)
with check (
  sender_account_id = (select auth.uid())
  or hearthland_private.can_manage_entity(land_entity_id)
);

drop policy if exists connections_participants on hearthland.connections;
create policy connections_participants on hearthland.connections
for select to authenticated
using (
  requester_account_id = (select auth.uid())
  or receiver_account_id = (select auth.uid())
);

drop policy if exists connections_insert on hearthland.connections;
create policy connections_insert on hearthland.connections
for insert to authenticated
with check (
  requester_account_id = (select auth.uid())
  and receiver_account_id <> (select auth.uid())
  and status = 'pending'
  and not hearthland_private.is_blocked_with(receiver_account_id)
  and exists (
    select 1
    from hearthland.person_profiles p
    where p.account_id = receiver_account_id
      and p.allow_connection_requests
      and p.archived_at is null
  )
);

drop policy if exists connections_update on hearthland.connections;
create policy connections_update on hearthland.connections
for update to authenticated
using (
  requester_account_id = (select auth.uid())
  or receiver_account_id = (select auth.uid())
)
with check (
  requester_account_id = (select auth.uid())
  or receiver_account_id = (select auth.uid())
);

drop policy if exists blocks_own on hearthland.blocks;
create policy blocks_own on hearthland.blocks
for all to authenticated
using (blocker_account_id = (select auth.uid()))
with check (blocker_account_id = (select auth.uid()));

drop policy if exists follows_own on hearthland.follows;
create policy follows_own on hearthland.follows
for all to authenticated
using (account_id = (select auth.uid()))
with check (
  account_id = (select auth.uid())
  and hearthland_private.can_view_entity(entity_id)
);

drop policy if exists saved_entities_own on hearthland.saved_entities;
create policy saved_entities_own on hearthland.saved_entities
for all to authenticated
using (account_id = (select auth.uid()))
with check (
  account_id = (select auth.uid())
  and hearthland_private.can_view_entity(entity_id)
);

drop policy if exists conversations_select on hearthland.conversations;
create policy conversations_select on hearthland.conversations
for select to authenticated
using (
  created_by_account_id = (select auth.uid())
  or hearthland_private.is_conversation_member(id)
);

drop policy if exists conversations_insert on hearthland.conversations;
create policy conversations_insert on hearthland.conversations
for insert to authenticated
with check (
  created_by_account_id = (select auth.uid())
  and (
    context_entity_id is null
    or hearthland_private.can_view_entity(context_entity_id)
  )
);

drop policy if exists conversations_update on hearthland.conversations;
create policy conversations_update on hearthland.conversations
for update to authenticated
using (
  created_by_account_id = (select auth.uid())
  or hearthland_private.is_conversation_member(id)
)
with check (
  created_by_account_id = (select auth.uid())
  or hearthland_private.is_conversation_member(id)
);

drop policy if exists conversation_members_select on hearthland.conversation_members;
create policy conversation_members_select on hearthland.conversation_members
for select to authenticated
using (hearthland_private.is_conversation_member(conversation_id));

drop policy if exists conversation_members_insert on hearthland.conversation_members;
create policy conversation_members_insert on hearthland.conversation_members
for insert to authenticated
with check (
  exists (
    select 1 from hearthland.conversations c
    where c.id = conversation_id
      and (
        c.created_by_account_id = (select auth.uid())
        or (
          c.context_entity_id is not null
          and hearthland_private.can_manage_entity(c.context_entity_id)
        )
      )
  )
  and not hearthland_private.is_blocked_with(account_id)
);

drop policy if exists conversation_members_update on hearthland.conversation_members;
create policy conversation_members_update on hearthland.conversation_members
for update to authenticated
using (
  account_id = (select auth.uid())
  or exists (
    select 1 from hearthland.conversations c
    where c.id = conversation_id
      and c.created_by_account_id = (select auth.uid())
  )
)
with check (
  account_id = (select auth.uid())
  or exists (
    select 1 from hearthland.conversations c
    where c.id = conversation_id
      and c.created_by_account_id = (select auth.uid())
  )
);

drop policy if exists messages_select on hearthland.messages;
create policy messages_select on hearthland.messages
for select to authenticated
using (hearthland_private.is_conversation_member(conversation_id));

drop policy if exists messages_insert on hearthland.messages;
create policy messages_insert on hearthland.messages
for insert to authenticated
with check (
  sender_account_id = (select auth.uid())
  and hearthland_private.is_conversation_member(conversation_id)
  and not exists (
    select 1
    from hearthland.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.account_id <> (select auth.uid())
      and hearthland_private.is_blocked_with(cm.account_id)
  )
);

drop policy if exists messages_update on hearthland.messages;
create policy messages_update on hearthland.messages
for update to authenticated
using (sender_account_id = (select auth.uid()))
with check (sender_account_id = (select auth.uid()));

drop policy if exists notifications_select on hearthland.notifications;
create policy notifications_select on hearthland.notifications
for select to authenticated
using (account_id = (select auth.uid()));

drop policy if exists notifications_update on hearthland.notifications;
create policy notifications_update on hearthland.notifications
for update to authenticated
using (account_id = (select auth.uid()))
with check (account_id = (select auth.uid()));

drop policy if exists notification_preferences_own on hearthland.notification_preferences;
create policy notification_preferences_own on hearthland.notification_preferences
for all to authenticated
using (account_id = (select auth.uid()))
with check (account_id = (select auth.uid()));

drop policy if exists reports_select on hearthland.reports;
create policy reports_select on hearthland.reports
for select to authenticated
using (
  reporter_account_id = (select auth.uid())
  or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
);

drop policy if exists reports_insert on hearthland.reports;
create policy reports_insert on hearthland.reports
for insert to authenticated
with check (reporter_account_id = (select auth.uid()) and status = 'open');

drop policy if exists reports_update on hearthland.reports;
create policy reports_update on hearthland.reports
for update to authenticated
using (hearthland_private.is_platform_staff(array['admin', 'moderator']::text[]))
with check (hearthland_private.is_platform_staff(array['admin', 'moderator']::text[]));

drop policy if exists moderation_actions_select on hearthland.moderation_actions;
create policy moderation_actions_select on hearthland.moderation_actions
for select to authenticated
using (hearthland_private.is_platform_staff(array['admin', 'moderator']::text[]));

drop policy if exists activity_events_select on hearthland.activity_events;
create policy activity_events_select on hearthland.activity_events
for select to anon, authenticated
using (
  hearthland_private.can_view_entity(entity_id)
  and (
    visibility = 'public'
    or (visibility = 'members' and hearthland_private.is_entity_member(entity_id))
    or (visibility = 'managers' and hearthland_private.can_manage_entity(entity_id))
    or (visibility = 'private' and actor_account_id = (select auth.uid()))
  )
);

drop policy if exists action_events_select on hearthland.action_events;
create policy action_events_select on hearthland.action_events
for select to authenticated
using (
  account_id = (select auth.uid())
  or (
    entity_id is not null
    and hearthland_private.can_manage_entity(entity_id)
  )
  or hearthland_private.is_platform_staff(array['admin', 'moderator']::text[])
);

-- ---------------------------------------------------------------------------
-- Authenticated atomic RPCs used by the application
-- ---------------------------------------------------------------------------

create or replace function hearthland.save_my_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_account_id uuid := (select auth.uid());
  profile_id uuid;
  skill_item jsonb;
  value_item jsonb;
  resolved_skill_id uuid;
  resolved_value_id uuid;
  resolved_display_name text;
  resolved_visibility text;
  resolved_publication_status text;
  avatar_payload jsonb;
  avatar_path text;
  avatar_mime_type text;
  avatar_size_bytes bigint;
  completeness integer := 0;
begin
  if current_account_id is null then
    raise exception 'Authentication required';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  select p.entity_id into profile_id
  from hearthland.person_profiles p
  where p.account_id = current_account_id;

  if profile_id is null then
    raise exception 'Hearthland profile was not initialized for this account';
  end if;

  select coalesce(nullif(btrim(payload ->> 'display_name'), ''), a.display_name)
  into resolved_display_name
  from hearthland.accounts a
  where a.id = current_account_id;

  if resolved_display_name is null or length(resolved_display_name) > 120 then
    raise exception 'display_name must contain 1 to 120 characters';
  end if;

  resolved_visibility := coalesce(payload ->> 'visibility', (
    select e.visibility from hearthland.entities e where e.id = profile_id
  ));
  if resolved_visibility not in ('public', 'members', 'connections', 'private') then
    raise exception 'Invalid profile visibility';
  end if;

  resolved_publication_status := coalesce(payload ->> 'publication_status', (
    select e.publication_status from hearthland.entities e where e.id = profile_id
  ));
  if resolved_publication_status not in ('draft', 'published', 'unpublished') then
    raise exception 'Invalid profile publication_status';
  end if;

  if payload ? 'languages' and jsonb_typeof(payload -> 'languages') <> 'array' then
    raise exception 'languages must be an array';
  end if;
  if payload ? 'links' and jsonb_typeof(payload -> 'links') <> 'array' then
    raise exception 'links must be an array';
  end if;
  if payload ? 'looking_for' and jsonb_typeof(payload -> 'looking_for') <> 'array' then
    raise exception 'looking_for must be an array';
  end if;
  if payload ? 'can_contribute' and jsonb_typeof(payload -> 'can_contribute') <> 'array' then
    raise exception 'can_contribute must be an array';
  end if;
  if payload ? 'account_settings' and jsonb_typeof(payload -> 'account_settings') <> 'object' then
    raise exception 'account_settings must be an object';
  end if;
  if payload ? 'contact_visibility'
     and payload ->> 'contact_visibility' not in ('public', 'members', 'connections', 'private') then
    raise exception 'Invalid contact_visibility';
  end if;

  update hearthland.accounts
  set display_name = resolved_display_name,
      onboarding_status = coalesce(payload ->> 'onboarding_status', onboarding_status),
      locale = coalesce(nullif(payload ->> 'locale', ''), locale),
      timezone = case when payload ? 'timezone' then payload ->> 'timezone' else timezone end,
      settings = case when payload ? 'account_settings'
        then settings || (payload -> 'account_settings') else settings end,
      updated_at = now()
  where id = current_account_id;

  update hearthland.entities
  set title = resolved_display_name,
      visibility = resolved_visibility,
      publication_status = resolved_publication_status,
      updated_by_account_id = current_account_id,
      updated_at = now()
  where id = profile_id and owner_account_id = current_account_id;

  update hearthland.person_profiles
  set display_name = resolved_display_name,
      headline = coalesce(payload ->> 'headline', headline),
      bio = coalesce(payload ->> 'bio', bio),
      languages = case when payload ? 'languages'
        then array(select jsonb_array_elements_text(payload -> 'languages'))
        else languages end,
      links = case when payload ? 'links' then payload -> 'links' else links end,
      relocation_readiness = case when payload ? 'relocation_readiness'
        then nullif(payload ->> 'relocation_readiness', '') else relocation_readiness end,
      geographic_flexibility = case when payload ? 'geographic_flexibility'
        then nullif(payload ->> 'geographic_flexibility', '') else geographic_flexibility end,
      family_situation = case when payload ? 'family_situation'
        then nullif(payload ->> 'family_situation', '') else family_situation end,
      availability = case when payload ? 'availability'
        then nullif(payload ->> 'availability', '') else availability end,
      discoverable = case when payload ? 'discoverable'
        then (payload ->> 'discoverable')::boolean else discoverable end,
      allow_connection_requests = case when payload ? 'allow_connection_requests'
        then (payload ->> 'allow_connection_requests')::boolean else allow_connection_requests end,
      looking_for = case when payload ? 'looking_for'
        then array(select jsonb_array_elements_text(payload -> 'looking_for'))
        else looking_for end,
      can_contribute = case when payload ? 'can_contribute'
        then array(select jsonb_array_elements_text(payload -> 'can_contribute'))
        else can_contribute end,
      contribution_note = case when payload ? 'contribution_note'
        then coalesce(payload ->> 'contribution_note', '') else contribution_note end,
      updated_at = now()
  where entity_id = profile_id and account_id = current_account_id;

  if payload ? 'country'
     or payload ? 'region'
     or payload ? 'city'
     or payload ? 'location_visibility' then
    if coalesce(payload ->> 'location_visibility', 'members') not in (
      'public', 'members', 'connections', 'private'
    ) then
      raise exception 'Invalid location_visibility';
    end if;
    insert into hearthland.profile_locations (
      profile_entity_id, country, region, city, visibility
    ) values (
      profile_id,
      nullif(payload ->> 'country', ''),
      nullif(payload ->> 'region', ''),
      nullif(payload ->> 'city', ''),
      coalesce(payload ->> 'location_visibility', 'members')
    )
    on conflict (profile_entity_id) do update set
      country = excluded.country,
      region = excluded.region,
      city = excluded.city,
      visibility = excluded.visibility,
      updated_at = now();
  end if;

  if payload ? 'contact_visibility' then
    insert into hearthland.profile_contacts (profile_entity_id, visibility)
    values (profile_id, payload ->> 'contact_visibility')
    on conflict (profile_entity_id) do update set
      visibility = excluded.visibility,
      updated_at = now();
  end if;

  if payload ? 'preferences' then
    if jsonb_typeof(payload -> 'preferences') <> 'object' then
      raise exception 'preferences must be an object';
    end if;
    if (payload -> 'preferences') ? 'preferred_countries'
       and jsonb_typeof(payload #> '{preferences,preferred_countries}') <> 'array' then
      raise exception 'preferences.preferred_countries must be an array';
    end if;
    if (payload -> 'preferences') ? 'preferred_regions'
       and jsonb_typeof(payload #> '{preferences,preferred_regions}') <> 'array' then
      raise exception 'preferences.preferred_regions must be an array';
    end if;
    if (payload -> 'preferences') ? 'desired_community_types'
       and jsonb_typeof(payload #> '{preferences,desired_community_types}') <> 'array' then
      raise exception 'preferences.desired_community_types must be an array';
    end if;
    if (payload -> 'preferences') ? 'lifestyle_interests'
       and jsonb_typeof(payload #> '{preferences,lifestyle_interests}') <> 'array' then
      raise exception 'preferences.lifestyle_interests must be an array';
    end if;

    insert into hearthland.profile_preferences (
      profile_entity_id,
      preferred_countries,
      preferred_regions,
      desired_community_types,
      lifestyle_interests,
      community_size_min,
      community_size_max,
      communal_life_level,
      governance_preference,
      ownership_preference,
      economic_integration,
      family_friendly_required,
      privacy_preferences
    ) values (
      profile_id,
      case when (payload -> 'preferences') ? 'preferred_countries'
        then array(select jsonb_array_elements_text(payload #> '{preferences,preferred_countries}'))
        else '{}'::text[] end,
      case when (payload -> 'preferences') ? 'preferred_regions'
        then array(select jsonb_array_elements_text(payload #> '{preferences,preferred_regions}'))
        else '{}'::text[] end,
      case when (payload -> 'preferences') ? 'desired_community_types'
        then array(select jsonb_array_elements_text(payload #> '{preferences,desired_community_types}'))
        else '{}'::text[] end,
      case when (payload -> 'preferences') ? 'lifestyle_interests'
        then array(select jsonb_array_elements_text(payload #> '{preferences,lifestyle_interests}'))
        else '{}'::text[] end,
      nullif(payload #>> '{preferences,community_size_min}', '')::integer,
      nullif(payload #>> '{preferences,community_size_max}', '')::integer,
      nullif(payload #>> '{preferences,communal_life_level}', '')::smallint,
      nullif(payload #>> '{preferences,governance_preference}', ''),
      nullif(payload #>> '{preferences,ownership_preference}', ''),
      nullif(payload #>> '{preferences,economic_integration}', '')::smallint,
      coalesce((payload #>> '{preferences,family_friendly_required}')::boolean, false),
      coalesce(payload #> '{preferences,privacy_preferences}', '{}'::jsonb)
    )
    on conflict (profile_entity_id) do update set
      preferred_countries = excluded.preferred_countries,
      preferred_regions = excluded.preferred_regions,
      desired_community_types = excluded.desired_community_types,
      lifestyle_interests = excluded.lifestyle_interests,
      community_size_min = excluded.community_size_min,
      community_size_max = excluded.community_size_max,
      communal_life_level = excluded.communal_life_level,
      governance_preference = excluded.governance_preference,
      ownership_preference = excluded.ownership_preference,
      economic_integration = excluded.economic_integration,
      family_friendly_required = excluded.family_friendly_required,
      privacy_preferences = excluded.privacy_preferences,
      updated_at = now();
  end if;

  if payload ? 'intentions' then
    if jsonb_typeof(payload -> 'intentions') <> 'array' then
      raise exception 'intentions must be an array';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(payload -> 'intentions') i(value)
      where i.value not in (
        'find_community', 'create_community', 'already_creating_community',
        'represent_existing_community', 'have_land', 'teach_master', 'volunteer',
        'work', 'support_invest', 'learn', 'represent_organisation', 'explore'
      )
    ) then
      raise exception 'intentions contains an unsupported value';
    end if;
    delete from hearthland.user_intentions where account_id = current_account_id;
    insert into hearthland.user_intentions (account_id, intention)
    select current_account_id, i.value
    from (
      select distinct value
      from jsonb_array_elements_text(payload -> 'intentions')
    ) i;
  end if;

  if payload ? 'skills' then
    if jsonb_typeof(payload -> 'skills') <> 'array' then
      raise exception 'skills must be an array';
    end if;
    delete from hearthland.person_skills where profile_entity_id = profile_id;
    for skill_item in select value from jsonb_array_elements(payload -> 'skills')
    loop
      if jsonb_typeof(skill_item) <> 'object'
         or coalesce(skill_item ->> 'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
         or nullif(btrim(skill_item ->> 'name'), '') is null
         or nullif(btrim(skill_item ->> 'category'), '') is null then
        raise exception 'Each skill requires valid slug, name, and category';
      end if;
      if coalesce(skill_item ->> 'experience_level', 'beginner') not in (
        'curious', 'beginner', 'intermediate', 'advanced', 'expert'
      ) then
        raise exception 'Invalid skill experience_level';
      end if;

      insert into hearthland.skills (slug, name, category, is_active, is_seeded_demo)
      values (
        skill_item ->> 'slug',
        btrim(skill_item ->> 'name'),
        btrim(skill_item ->> 'category'),
        true,
        false
      )
      on conflict (slug) do nothing;

      select s.id into resolved_skill_id
      from hearthland.skills s
      where s.slug = skill_item ->> 'slug' and s.is_active;

      if resolved_skill_id is null then
        raise exception 'Skill is unavailable';
      end if;

      insert into hearthland.person_skills (
        profile_entity_id, skill_id, experience_level, years_experience,
        can_teach, practical_workshops, theoretical_sessions, willing_to_contribute
      ) values (
        profile_id,
        resolved_skill_id,
        coalesce(skill_item ->> 'experience_level', 'beginner'),
        nullif(skill_item ->> 'years_experience', '')::numeric,
        coalesce((skill_item ->> 'can_teach')::boolean, false),
        coalesce((skill_item ->> 'practical_workshops')::boolean, false),
        coalesce((skill_item ->> 'theoretical_sessions')::boolean, false),
        coalesce((skill_item ->> 'willing_to_contribute')::boolean, true)
      );
    end loop;
  end if;

  if payload ? 'values' then
    if jsonb_typeof(payload -> 'values') <> 'array' then
      raise exception 'values must be an array';
    end if;
    delete from hearthland.profile_values where profile_entity_id = profile_id;
    for value_item in select value from jsonb_array_elements(payload -> 'values')
    loop
      if jsonb_typeof(value_item) <> 'object'
         or coalesce(value_item ->> 'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
         or nullif(btrim(value_item ->> 'name'), '') is null then
        raise exception 'Each value requires valid slug and name';
      end if;

      insert into hearthland.values_catalog (slug, name, is_active, is_seeded_demo)
      values (value_item ->> 'slug', btrim(value_item ->> 'name'), true, false)
      on conflict (slug) do nothing;

      select v.id into resolved_value_id
      from hearthland.values_catalog v
      where v.slug = value_item ->> 'slug' and v.is_active;

      if resolved_value_id is null then
        raise exception 'Value is unavailable';
      end if;

      insert into hearthland.profile_values (profile_entity_id, value_id)
      values (profile_id, resolved_value_id);
    end loop;
  end if;

  if payload ? 'avatar' then
    avatar_payload := payload -> 'avatar';
    if jsonb_typeof(avatar_payload) <> 'object' then
      raise exception 'avatar must be an object';
    end if;

    if coalesce((avatar_payload ->> 'remove')::boolean, false) then
      update hearthland.media_assets
      set archived_at = now(), is_cover = false, updated_at = now()
      where profile_entity_id = profile_id
        and category = 'avatar'
        and archived_at is null;
    else
      avatar_path := nullif(btrim(avatar_payload ->> 'path'), '');
      avatar_mime_type := nullif(btrim(avatar_payload ->> 'mime_type'), '');
      avatar_size_bytes := nullif(avatar_payload ->> 'size_bytes', '')::bigint;

      if avatar_path is null
         or hearthland_private.storage_path_uuid(avatar_path, 'users') <> current_account_id then
        raise exception 'Avatar path must be inside users/{auth.uid()}/';
      end if;
      if avatar_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
        raise exception 'Avatar must be JPG, PNG, or WebP';
      end if;
      if avatar_size_bytes is null or avatar_size_bytes <= 0 or avatar_size_bytes > 5242880 then
        raise exception 'Avatar size must be between 1 byte and 5 MiB';
      end if;
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'hearthland-avatars' and o.name = avatar_path
      ) then
        raise exception 'Uploaded avatar object was not found';
      end if;

      update hearthland.media_assets
      set archived_at = now(), is_cover = false, updated_at = now()
      where profile_entity_id = profile_id
        and category = 'avatar'
        and object_path <> avatar_path
        and archived_at is null;

      insert into hearthland.media_assets (
        profile_entity_id, uploader_account_id, bucket_id, object_path,
        media_kind, category, alt_text, mime_type, size_bytes,
        is_cover, visibility
      ) values (
        profile_id,
        current_account_id,
        'hearthland-avatars',
        avatar_path,
        'image',
        'avatar',
        coalesce(avatar_payload ->> 'alt_text', resolved_display_name || ' avatar'),
        avatar_mime_type,
        avatar_size_bytes,
        true,
        resolved_visibility
      )
      on conflict (bucket_id, object_path) do update set
        profile_entity_id = excluded.profile_entity_id,
        uploader_account_id = excluded.uploader_account_id,
        category = 'avatar',
        alt_text = excluded.alt_text,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        is_cover = true,
        visibility = excluded.visibility,
        archived_at = null,
        updated_at = now();
    end if;
  end if;

  select
    (case when nullif(btrim(p.display_name), '') is not null then 10 else 0 end)
    + (case when nullif(btrim(p.headline), '') is not null then 10 else 0 end)
    + (case when length(btrim(p.bio)) >= 80 then 15 else 0 end)
    + (case when exists (
        select 1 from hearthland.profile_locations pl
        where pl.profile_entity_id = p.entity_id and pl.country is not null
      ) then 10 else 0 end)
    + (case when cardinality(p.languages) > 0 then 5 else 0 end)
    + (case when cardinality(p.looking_for) > 0 then 10 else 0 end)
    + (case when cardinality(p.can_contribute) > 0 then 10 else 0 end)
    + (case when exists (
        select 1 from hearthland.person_skills ps where ps.profile_entity_id = p.entity_id
      ) then 15 else 0 end)
    + (case when exists (
        select 1 from hearthland.profile_preferences pp where pp.profile_entity_id = p.entity_id
      ) then 10 else 0 end)
    + (case when exists (
        select 1 from hearthland.media_assets ma
        where ma.profile_entity_id = p.entity_id and ma.category = 'avatar' and ma.archived_at is null
      ) then 5 else 0 end)
  into completeness
  from hearthland.person_profiles p
  where p.entity_id = profile_id;

  update hearthland.person_profiles
  set profile_completeness = least(100, completeness), updated_at = now()
  where entity_id = profile_id;

  -- Keep a privacy-safe presentation DTO for the existing repository during
  -- the relational migration. Restricted contact data and non-public location
  -- values are never copied into entity metadata.
  update hearthland.entities e
  set metadata = jsonb_set(
        coalesce(e.metadata, '{}'::jsonb),
        '{platformDto}',
        coalesce(e.metadata -> 'platformDto', '{}'::jsonb)
        || jsonb_build_object(
          'id', profile_id,
          'slug', e.slug,
          'name', p.display_name,
          'headline', p.headline,
          'bio', p.bio,
          'location', case when pl.visibility = 'public'
            then concat_ws(', ', nullif(pl.city, ''), nullif(pl.region, ''), nullif(pl.country, ''))
            else '' end,
          'country', case when pl.visibility = 'public' then coalesce(pl.country, '') else '' end,
          'languages', p.languages,
          'skills', coalesce((
            select jsonb_agg(s.name order by s.name)
            from hearthland.person_skills ps
            join hearthland.skills s on s.id = ps.skill_id
            where ps.profile_entity_id = p.entity_id
          ), '[]'::jsonb),
          'skillCategories', coalesce((
            select jsonb_agg(distinct s.category)
            from hearthland.person_skills ps
            join hearthland.skills s on s.id = ps.skill_id
            where ps.profile_entity_id = p.entity_id
          ), '[]'::jsonb),
          'values', coalesce((
            select jsonb_agg(v.name order by v.name)
            from hearthland.profile_values pv
            join hearthland.values_catalog v on v.id = pv.value_id
            where pv.profile_entity_id = p.entity_id
          ), '[]'::jsonb),
          'lookingFor', p.looking_for,
          'canContribute', p.can_contribute,
          'contributionNote', p.contribution_note,
          'preferredCountries', coalesce(pp.preferred_countries, '{}'::text[]),
          'preferredTypes', coalesce(pp.desired_community_types, '{}'::text[]),
          'preferredSize', jsonb_build_array(
            coalesce(pp.community_size_min, 1),
            coalesce(pp.community_size_max, 200)
          ),
          'governance', case when pp.governance_preference is null
            then '[]'::jsonb else jsonb_build_array(pp.governance_preference) end,
          'ecology', coalesce(pp.lifestyle_interests, '{}'::text[]),
          'economy', coalesce(pp.economic_integration, 3),
          'communalLife', coalesce(pp.communal_life_level, 3),
          'family', coalesce(p.family_situation, ''),
          'availability', coalesce(p.availability, ''),
          'completeness', least(100, completeness),
          'discoverable', p.discoverable,
          'allowConnectionRequests', p.allow_connection_requests,
          'avatarPath', coalesce((
            select ma.object_path
            from hearthland.media_assets ma
            where ma.profile_entity_id = p.entity_id
              and ma.category = 'avatar'
              and ma.archived_at is null
            order by ma.updated_at desc
            limit 1
          ), '')
        ),
        true
      ),
      updated_by_account_id = current_account_id,
      updated_at = now()
  from hearthland.person_profiles p
  left join hearthland.profile_preferences pp on pp.profile_entity_id = p.entity_id
  left join hearthland.profile_locations pl on pl.profile_entity_id = p.entity_id
  where e.id = profile_id and p.entity_id = profile_id;

  return jsonb_build_object(
    'account_id', current_account_id,
    'profile_entity_id', profile_id,
    'display_name', resolved_display_name,
    'profile_completeness', least(100, completeness),
    'saved_at', now()
  );
end;
$$;

comment on function hearthland.save_my_profile(jsonb) is
  'Atomically saves the authenticated caller profile/onboarding data. Never accepts an account or profile id.';
revoke all on function hearthland.save_my_profile(jsonb) from public, anon;
grant execute on function hearthland.save_my_profile(jsonb) to authenticated;

create or replace function hearthland.create_emerging_community_project(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  community_entity_id uuid := gen_random_uuid();
  project_entity_id uuid := gen_random_uuid();
  community_name text;
  project_name text;
  community_slug text;
  project_slug text;
  target_min integer;
  target_max integer;
  current_member_count integer;
  community_dto jsonb;
  project_dto jsonb;
begin
  if owner_id is null then
    raise exception 'Authentication required';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  community_name := nullif(btrim(payload ->> 'community_name'), '');
  project_name := coalesce(nullif(btrim(payload ->> 'project_name'), ''), community_name || ' Settlement Project');
  if community_name is null or length(community_name) > 160 then
    raise exception 'community_name must contain 1 to 160 characters';
  end if;
  if project_name is null or length(project_name) > 160 then
    raise exception 'project_name must contain 1 to 160 characters';
  end if;
  if nullif(btrim(payload ->> 'community_type'), '') is null then
    raise exception 'community_type is required';
  end if;

  target_min := nullif(payload ->> 'target_size_min', '')::integer;
  target_max := nullif(payload ->> 'target_size_max', '')::integer;
  if target_min is not null and target_min < 1 then
    raise exception 'target_size_min must be positive';
  end if;
  if target_max is not null and target_max < 1 then
    raise exception 'target_size_max must be positive';
  end if;
  if target_min is not null and target_max is not null and target_min > target_max then
    raise exception 'target_size_min cannot exceed target_size_max';
  end if;

  community_slug := lower(regexp_replace(regexp_replace(
    coalesce(nullif(btrim(payload ->> 'community_slug'), ''), community_name),
    '[^a-zA-Z0-9]+', '-', 'g'
  ), '(^-+|-+$)', '', 'g'));
  project_slug := lower(regexp_replace(regexp_replace(
    coalesce(nullif(btrim(payload ->> 'project_slug'), ''), project_name),
    '[^a-zA-Z0-9]+', '-', 'g'
  ), '(^-+|-+$)', '', 'g'));

  if community_slug = '' then
    community_slug := 'community-' || left(replace(community_entity_id::text, '-', ''), 10);
  end if;
  if project_slug = '' then
    project_slug := 'project-' || left(replace(project_entity_id::text, '-', ''), 10);
  end if;
  if exists (
    select 1 from hearthland.entities e
    where e.entity_type = 'emerging_community' and e.slug = community_slug
  ) then
    community_slug := community_slug || '-' || left(replace(community_entity_id::text, '-', ''), 8);
  end if;
  if exists (
    select 1 from hearthland.entities e
    where e.entity_type = 'settlement_project' and e.slug = project_slug
  ) then
    project_slug := project_slug || '-' || left(replace(project_entity_id::text, '-', ''), 8);
  end if;

  current_member_count := coalesce(nullif(payload ->> 'current_members', '')::integer, 1);
  community_dto := jsonb_build_object(
    'name', community_name,
    'image', 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1400&q=85',
    'location', concat_ws(', ', nullif(payload ->> 'target_region', ''), nullif(payload ->> 'target_country', '')),
    'country', coalesce(payload ->> 'target_country', ''),
    'region', coalesce(payload ->> 'target_region', ''),
    'type', btrim(payload ->> 'community_type'),
    'description', coalesce(payload ->> 'community_short_description', ''),
    'mission', coalesce(payload ->> 'vision', ''),
    'residents', current_member_count,
    'target', current_member_count::text || ' → ' || coalesce(target_max::text, 'growing') || ' residents',
    'accepting', true,
    'membership', 'Founding members',
    'governance', 'To be designed together',
    'ownership', 'To be defined',
    'economy', 3,
    'communalLife', 3,
    'familyFriendly', false,
    'children', 0,
    'languages', '[]'::jsonb,
    'values', '[]'::jsonb,
    'tags', case when jsonb_typeof(payload -> 'lifestyle_themes') = 'array'
      then payload -> 'lifestyle_themes' else '[]'::jsonb end,
    'ecology', case when jsonb_typeof(payload -> 'lifestyle_themes') = 'array'
      then payload -> 'lifestyle_themes' else '[]'::jsonb end,
    'housing', '[]'::jsonb,
    'needs', case when jsonb_typeof(payload -> 'current_priorities') = 'array'
      then payload -> 'current_priorities' else '[]'::jsonb end,
    'stage', coalesce(nullif(payload ->> 'community_stage', ''), 'idea'),
    'team', current_member_count,
    'landArea', coalesce(nullif(payload ->> 'land_status', ''), 'Searching'),
    'coordinates', jsonb_build_object('x', 52, 'y', 48),
    'verified', false
  );

  project_dto := jsonb_build_object(
    'name', project_name,
    'parent', community_name,
    'parentId', community_entity_id,
    'stage', coalesce(nullif(payload ->> 'project_stage', ''), 'vision'),
    'readiness', 15,
    'team', current_member_count,
    'interested', 0,
    'savedLand', 0,
    'openNeeds', case when jsonb_typeof(payload -> 'current_priorities') = 'array'
      then jsonb_array_length(payload -> 'current_priorities') else 0 end,
    'openOpportunities', 0,
    'openTasks', 0,
    'nextMilestone', coalesce(nullif(payload ->> 'next_milestone', ''), 'Build the founding team'),
    'countries', case when nullif(payload ->> 'target_country', '') is null
      then '[]'::jsonb else jsonb_build_array(payload ->> 'target_country') end,
    'targetRegion', coalesce(payload ->> 'target_region', ''),
    'targetPopulation', coalesce(nullif(payload ->> 'target_population', '')::integer, target_max, 1),
    'landRequirement', case when nullif(payload ->> 'land_requirement_ha', '') is null
      then 'Not yet defined' else (payload ->> 'land_requirement_ha') || ' ha' end,
    'requiredSkills', '[]'::jsonb,
    'availableSkills', '[]'::jsonb,
    'progress', jsonb_build_object(
      'Vision', 'in progress',
      'Core Team', 'exploring',
      'Community Model', 'not started',
      'Location', 'exploring',
      'Land', 'not started',
      'Legal', 'not started',
      'Finance', 'not started',
      'Planning', 'not started'
    )
  );

  insert into hearthland.entities (
    id, entity_type, slug, title, short_description, publication_status,
    visibility, owner_account_id, created_by_account_id, updated_by_account_id, metadata
  ) values (
    community_entity_id,
    'emerging_community',
    community_slug,
    community_name,
    coalesce(payload ->> 'community_short_description', ''),
    'draft',
    'private',
    owner_id,
    owner_id,
    owner_id,
    jsonb_build_object('platformDto', community_dto)
  );

  insert into hearthland.emerging_communities (
    entity_id, vision, target_country, target_region, community_type, stage,
    current_members, target_size_min, target_size_max, land_status,
    lifestyle_themes, current_assets
  ) values (
    community_entity_id,
    coalesce(payload ->> 'vision', ''),
    nullif(payload ->> 'target_country', ''),
    nullif(payload ->> 'target_region', ''),
    btrim(payload ->> 'community_type'),
    coalesce(nullif(payload ->> 'community_stage', ''), 'idea'),
    coalesce(nullif(payload ->> 'current_members', '')::integer, 1),
    target_min,
    target_max,
    nullif(payload ->> 'land_status', ''),
    case when jsonb_typeof(payload -> 'lifestyle_themes') = 'array'
      then array(select jsonb_array_elements_text(payload -> 'lifestyle_themes'))
      else '{}'::text[] end,
    case when jsonb_typeof(payload -> 'current_assets') = 'array'
      then array(select jsonb_array_elements_text(payload -> 'current_assets'))
      else '{}'::text[] end
  );

  insert into hearthland.entities (
    id, entity_type, slug, title, short_description, publication_status,
    visibility, owner_account_id, created_by_account_id, updated_by_account_id, metadata
  ) values (
    project_entity_id,
    'settlement_project',
    project_slug,
    project_name,
    coalesce(payload ->> 'project_short_description', payload ->> 'community_short_description', ''),
    'draft',
    'private',
    owner_id,
    owner_id,
    owner_id,
    jsonb_build_object('platformDto', project_dto)
  );

  insert into hearthland.settlement_projects (
    entity_id, emerging_community_entity_id, description, stage,
    target_country, target_region, target_population, land_requirement_ha,
    approximate_budget_eur, funding_status, next_milestone, current_priorities
  ) values (
    project_entity_id,
    community_entity_id,
    coalesce(payload ->> 'project_description', ''),
    coalesce(nullif(payload ->> 'project_stage', ''), 'vision'),
    nullif(payload ->> 'target_country', ''),
    nullif(payload ->> 'target_region', ''),
    nullif(payload ->> 'target_population', '')::integer,
    nullif(payload ->> 'land_requirement_ha', '')::numeric,
    nullif(payload ->> 'approximate_budget_eur', '')::numeric,
    nullif(payload ->> 'funding_status', ''),
    nullif(payload ->> 'next_milestone', ''),
    case when jsonb_typeof(payload -> 'current_priorities') = 'array'
      then array(select jsonb_array_elements_text(payload -> 'current_priorities'))
      else '{}'::text[] end
  );

  insert into hearthland.entity_relationships (
    source_entity_id, target_entity_id, relationship_type, status,
    visibility, created_by_account_id
  ) values (
    community_entity_id,
    project_entity_id,
    'develops_project',
    'active',
    'private',
    owner_id
  );

  return jsonb_build_object(
    'emerging_community_entity_id', community_entity_id,
    'emerging_community_slug', community_slug,
    'settlement_project_entity_id', project_entity_id,
    'settlement_project_slug', project_slug,
    'publication_status', 'draft'
  );
end;
$$;

comment on function hearthland.create_emerging_community_project(jsonb) is
  'Atomically creates a caller-owned draft emerging community and linked settlement project.';
revoke all on function hearthland.create_emerging_community_project(jsonb) from public, anon;
grant execute on function hearthland.create_emerging_community_project(jsonb) to authenticated;

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
    and hearthland_private.can_view_entity(l.entity_id);
$$;

comment on function hearthland.get_public_land_coordinates(uuid) is
  'Returns only coordinates, and only when the owner explicitly marked a publicly visible land listing as exact.';
revoke all on function hearthland.get_public_land_coordinates(uuid) from public;
grant execute on function hearthland.get_public_land_coordinates(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Supabase Storage buckets and object policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'hearthland-avatars',
    'hearthland-avatars',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'hearthland-entity-media',
    'hearthland-entity-media',
    false,
    15728640,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'hearthland-project-files',
    'hearthland-project-files',
    false,
    26214400,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do nothing;

-- Avatar object path: users/{auth-user-uuid}/{file}
drop policy if exists hearthland_avatars_select on storage.objects;
create policy hearthland_avatars_select on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'hearthland-avatars'
  and exists (
    select 1
    from hearthland.person_profiles p
    where p.account_id = hearthland_private.storage_path_uuid(name, 'users')
      and hearthland_private.can_view_profile(p.entity_id)
  )
);

drop policy if exists hearthland_avatars_insert on storage.objects;
create policy hearthland_avatars_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'hearthland-avatars'
  and hearthland_private.storage_path_uuid(name, 'users') = (select auth.uid())
);

drop policy if exists hearthland_avatars_update on storage.objects;
create policy hearthland_avatars_update on storage.objects
for update to authenticated
using (
  bucket_id = 'hearthland-avatars'
  and hearthland_private.storage_path_uuid(name, 'users') = (select auth.uid())
)
with check (
  bucket_id = 'hearthland-avatars'
  and hearthland_private.storage_path_uuid(name, 'users') = (select auth.uid())
);

drop policy if exists hearthland_avatars_delete on storage.objects;
create policy hearthland_avatars_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'hearthland-avatars'
  and hearthland_private.storage_path_uuid(name, 'users') = (select auth.uid())
);

-- Entity-media object path: entities/{entity-uuid}/{file}
drop policy if exists hearthland_entity_media_select on storage.objects;
create policy hearthland_entity_media_select on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'hearthland-entity-media'
  and hearthland_private.can_view_entity(
    hearthland_private.storage_path_uuid(name, 'entities')
  )
);

drop policy if exists hearthland_entity_media_insert on storage.objects;
create policy hearthland_entity_media_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'hearthland-entity-media'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'entities')
  )
);

drop policy if exists hearthland_entity_media_update on storage.objects;
create policy hearthland_entity_media_update on storage.objects
for update to authenticated
using (
  bucket_id = 'hearthland-entity-media'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'entities')
  )
)
with check (
  bucket_id = 'hearthland-entity-media'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'entities')
  )
);

drop policy if exists hearthland_entity_media_delete on storage.objects;
create policy hearthland_entity_media_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'hearthland-entity-media'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'entities')
  )
);

-- Private project-file path: projects/{settlement-project-entity-uuid}/{file}
drop policy if exists hearthland_project_files_select on storage.objects;
create policy hearthland_project_files_select on storage.objects
for select to authenticated
using (
  bucket_id = 'hearthland-project-files'
  and (
    hearthland_private.can_manage_entity(
      hearthland_private.storage_path_uuid(name, 'projects')
    )
    or hearthland_private.is_entity_member(
      hearthland_private.storage_path_uuid(name, 'projects')
    )
  )
);

drop policy if exists hearthland_project_files_insert on storage.objects;
create policy hearthland_project_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'hearthland-project-files'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'projects')
  )
);

drop policy if exists hearthland_project_files_update on storage.objects;
create policy hearthland_project_files_update on storage.objects
for update to authenticated
using (
  bucket_id = 'hearthland-project-files'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'projects')
  )
)
with check (
  bucket_id = 'hearthland-project-files'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'projects')
  )
);

drop policy if exists hearthland_project_files_delete on storage.objects;
create policy hearthland_project_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'hearthland-project-files'
  and hearthland_private.can_manage_entity(
    hearthland_private.storage_path_uuid(name, 'projects')
  )
);

-- Hosted Supabase Data API schema exposure is a project-level setting rather
-- than durable SQL state. Preserve existing exposed schemas (especially
-- `public`) and add `hearthland` through Dashboard/API configuration. Never
-- overwrite pgrst.db_schemas with only Hearthland.
do $$
begin
  raise notice 'Hearthland migration installed. Add `hearthland` alongside existing schemas in Data API settings before client use.';
end;
$$;

commit;
