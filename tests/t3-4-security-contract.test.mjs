import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260812095344_hearthland_t3_4_pilot_foundation.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

function section(start, end) {
  const startIndex = migration.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing SQL contract: ${start}`);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing SQL contract terminator: ${end}`);
  return migration.slice(startIndex, endIndex);
}

test("invitation permissions are server-derived and privilege-bounded", () => {
  const createInvitation = section(
    "create or replace function hearthland.create_invitation(payload jsonb)",
    "create or replace function hearthland.get_invitation_preview",
  );

  assert.match(
    createInvitation,
    /if payload \? 'membership_role' then\s+raise exception 'INVITATION_MEMBERSHIP_ROLE_IS_SERVER_MANAGED'/,
  );
  assert.doesNotMatch(
    createInvitation,
    /payload\s*->>\s*'membership_role'/,
    "A client-supplied membership_role must never be parsed as authority",
  );
  assert.match(
    createInvitation,
    /when 'entity_administrator' then 'administrator'/,
  );
  assert.match(
    createInvitation,
    /hearthland_private\.owns_entity\(target_entity_id\)\s+or hearthland_private\.is_platform_staff\(array\['admin'\]::text\[\]\)/,
  );
  assert.doesNotMatch(
    createInvitation,
    /derived_membership_role[^;]*(?:owner|platform_admin)/,
    "An ordinary invitation must not derive an owner or platform role",
  );

  const acceptanceProvisioning = section(
    "create or replace function hearthland_private.sync_accepted_invitation()",
    "create or replace function hearthland_private.guard_invitation_update()",
  );
  assert.match(
    acceptanceProvisioning,
    /inviter\.account_status = 'active'[\s\S]*INVITATION_GRANT_AUTHORITY_REVOKED/,
  );
  assert.match(
    acceptanceProvisioning,
    /new\.membership_role = 'administrator'[\s\S]*e\.owner_account_id = new\.invited_by_account_id[\s\S]*pr\.role = 'admin'/,
  );
});

test("private teaching tables are owner/staff-only", () => {
  const policies = section(
    "drop policy if exists profile_data_select on hearthland.teaching_profiles;",
    "create policy learning_topic_interests_select",
  );

  assert.match(
    policies,
    /create policy teaching_profiles_owner_staff_select[\s\S]*for select to authenticated[\s\S]*owns_entity\(profile_entity_id\)[\s\S]*is_platform_staff/,
  );
  assert.match(
    policies,
    /create policy profile_teaching_topics_select[\s\S]*for select to authenticated[\s\S]*owns_entity\(profile_entity_id\)[\s\S]*is_platform_staff/,
  );
  assert.match(
    policies,
    /create policy person_skills_owner_staff_select[\s\S]*for select to authenticated[\s\S]*owns_entity\(profile_entity_id\)[\s\S]*is_platform_staff/,
  );
  assert.doesNotMatch(
    policies,
    /(?:teaching_profiles_owner_staff_select|profile_teaching_topics_select)[\s\S]{0,120}to anon/,
  );
});

test("public Master RPCs expose only discovery-safe columns", () => {
  const profileProjection = section(
    "create or replace function hearthland.get_public_teaching_profiles()",
    "create or replace function hearthland.get_public_teaching_topics()",
  );
  const topicProjection = section(
    "create or replace function hearthland.get_public_teaching_topics()",
    "revoke all on function hearthland.get_public_teaching_profiles()",
  );

  for (const privateColumn of [
    "availability",
    "compensation_preference",
    "professional_arrangements",
    "arrangement_notes",
  ]) {
    assert.doesNotMatch(
      profileProjection,
      new RegExp(`\\btp\\.${privateColumn}\\b`),
      `${privateColumn} must remain outside the public projection`,
    );
  }
  assert.doesNotMatch(topicProjection, /\bptt\.notes\b/);
  assert.match(profileProjection, /where tp\.is_available/);
  assert.match(profileProjection, /pp\.discoverable/);
  assert.match(profileProjection, /e\.visibility = 'public'/);

  const personSkillProjection = section(
    "create or replace function hearthland.get_public_person_skills()",
    "revoke all on function hearthland.get_public_teaching_profiles()",
  );
  assert.match(
    personSkillProjection,
    /coalesce\(tp\.is_available, false\)\s+and ps\.can_teach/,
  );
  assert.match(
    personSkillProjection,
    /coalesce\(tp\.is_available, false\)[\s\S]*and ps\.practical_workshops/,
  );
  assert.match(
    personSkillProjection,
    /coalesce\(tp\.is_available, false\)[\s\S]*and ps\.theoretical_sessions/,
  );
});

test("context conversation writes stay behind one authenticated RPC", () => {
  const conversationRpc = section(
    "create or replace function hearthland.start_context_conversation(",
    "revoke all on function hearthland.create_invitation",
  );

  assert.match(conversationRpc, /security definer\s+set search_path = pg_catalog/);
  assert.match(conversationRpc, /current_account_is_active\(\)/);
  assert.match(conversationRpc, /pg_advisory_xact_lock/);
  assert.match(conversationRpc, /is_blocked_with\(counterpart_account_id\)/);
  assert.match(
    conversationRpc,
    /normalized_kind = 'direct'[\s\S]*can_view_profile\(pp\.entity_id\)/,
  );
  assert.match(
    conversationRpc,
    /pp\.allow_connection_requests\s+or hearthland_private\.is_connected_with\(a\.id\)/,
  );
  assert.match(conversationRpc, /insert into hearthland\.conversation_members/);
  assert.match(conversationRpc, /insert into hearthland\.messages/);
  assert.match(conversationRpc, /'conversation_id', resolved_conversation_id/);
  assert.match(
    migration,
    /'can_message',[\s\S]*invitation_row\.recipient_mode = 'email'/,
  );

  assert.match(
    migration,
    /revoke insert on hearthland\.conversations from authenticated;/,
  );
  assert.match(
    migration,
    /revoke update on hearthland\.conversations from authenticated;/,
  );
  assert.match(
    migration,
    /revoke update on hearthland\.conversation_members from authenticated;/,
  );
  assert.match(
    migration,
    /grant update \(last_read_at, muted_at, left_at\)[\s\S]*conversation_members to authenticated;/,
  );
  assert.match(
    migration,
    /create policy conversation_members_update[\s\S]*using \(account_id = \(select auth\.uid\(\)\)\)[\s\S]*with check \(account_id = \(select auth\.uid\(\)\)\)/,
  );
  assert.match(
    migration,
    /guard_t3_4_conversation_member_identity[\s\S]*guard_conversation_member_identity\(\)/,
  );
  assert.match(
    migration,
    /revoke insert on hearthland\.conversation_members from authenticated;/,
  );
});

test("applicants cannot withdraw terminal participation decisions", () => {
  const guard = section(
    "create or replace function hearthland_private.guard_project_participation_request()",
    "create trigger guard_hearthland_project_participation_request",
  );

  assert.match(
    guard,
    /old\.status not in \('new', 'reviewing', 'contacted'\)\s+or new\.status <> 'withdrawn'/,
  );
  assert.match(
    guard,
    /old\.status in \('accepted', 'declined', 'withdrawn'\)\s+and new\.status <> old\.status/,
  );
});

test("request-scoped participation enrichment does not loosen profile RLS", () => {
  const managerProjection = section(
    "create or replace function hearthland.get_project_participation_manager_details(",
    "create or replace function hearthland.get_platform_metrics(",
  );

  assert.match(managerProjection, /security definer\s+set search_path = pg_catalog/);
  assert.match(managerProjection, /current_account_is_active\(\)/);
  assert.match(managerProjection, /can_manage_entity\(target_project_entity_id\)/);
  assert.match(managerProjection, /pr\.relevant_skill_ids/);
  assert.doesNotMatch(managerProjection, /\bemail\b|\bbiography\b|\bcontact_details\b/);
});

test("Camp applicant identity is exposed only through a manager-scoped safe projection", () => {
  const managerProjection = section(
    "create or replace function hearthland.get_camp_application_manager_details(",
    "create or replace function hearthland.get_platform_metrics(",
  );

  assert.match(managerProjection, /security definer\s+set search_path = pg_catalog/);
  assert.match(managerProjection, /current_account_is_active\(\)/);
  assert.match(managerProjection, /can_manage_entity\(target_camp_entity_id\)/);
  assert.match(managerProjection, /raise exception 'CAMP_MANAGER_ACCESS_REQUIRED'/);
  assert.match(
    managerProjection,
    /where ca\.camp_entity_id = target_camp_entity_id\s+and ca\.archived_at is null/,
  );
  assert.match(
    managerProjection,
    /returns table \(\s*application_id uuid,\s*applicant_account_id uuid,\s*display_name text,\s*headline text,\s*location_summary text\s*\)/,
  );
  assert.match(managerProjection, /concat_ws\(\s*', '/);
  assert.doesNotMatch(
    managerProjection,
    /\ba\.email\b|profile_contacts|contact_notes|public_email|phone/,
  );
  assert.match(
    migration,
    /revoke all on function hearthland\.get_camp_application_manager_details\(uuid\)\s+from public, anon;/,
  );
  assert.match(
    migration,
    /grant execute on function hearthland\.get_camp_application_manager_details\(uuid\)\s+to authenticated;/,
  );
});

test("working-group coordinators cannot reparent groups or rewrite provenance", () => {
  const guard = section(
    "create or replace function hearthland_private.guard_community_working_group_update()",
    "create trigger guard_hearthland_community_working_group_update",
  );
  const trigger = section(
    "create trigger guard_hearthland_community_working_group_update",
    "create or replace function hearthland_private.validate_working_group_people()",
  );

  assert.match(
    guard,
    /current_user in \('postgres', 'service_role', 'supabase_admin'\)/,
  );
  for (const immutableColumn of [
    "id",
    "community_entity_id",
    "created_by_account_id",
    "created_at",
  ]) {
    assert.match(guard, new RegExp(`new\\.${immutableColumn}`));
    assert.match(guard, new RegExp(`old\\.${immutableColumn}`));
  }
  assert.match(guard, /is distinct from row\(/);
  assert.match(guard, /using errcode = '42501'/);
  assert.match(
    trigger,
    /before update on hearthland\.community_working_groups/,
  );
});

test("manual Camp participants receive the base entity membership required by RLS", () => {
  const membershipSync = section(
    "create or replace function hearthland_private.sync_camp_participant_membership()",
    "create or replace function hearthland_private.notify_camp_announcement()",
  );

  assert.match(membershipSync, /new\.participant_status in \('accepted', 'checked_in', 'completed'\)/);
  assert.match(membershipSync, /insert into hearthland\.entity_memberships/);
  assert.match(membershipSync, /membership_type[\s\S]*'participant'/);
  assert.match(membershipSync, /set status = 'inactive'/);
});

test("Camp Masters and team roles receive operational participant access", () => {
  assert.match(
    migration,
    /target_entity_type = 'building_camp'[\s\S]*'master_teacher'[\s\S]*'organiser'[\s\S]*insert into hearthland\.camp_participants/,
  );
});

test("Camp application roles are stable codes and accepted Masters join the team", () => {
  const roleGuard = section(
    "create or replace function hearthland_private.guard_camp_application_roles()",
    "create or replace function hearthland_private.sync_t3_4_camp_participant()",
  );
  const participantSync = section(
    "create or replace function hearthland_private.sync_t3_4_camp_participant()",
    "create trigger sync_t3_4_hearthland_camp_participant",
  );
  assert.match(roleGuard, /new\.selected_roles <@ array\[/);
  assert.match(roleGuard, /'master_teacher'/);
  assert.match(participantSync, /'master_teacher' = any\(new\.selected_roles\)/);
  assert.match(participantSync, /insert into hearthland\.camp_team/);
});

test("working-group membership rosters stay self-or-manager only", () => {
  const policy = section(
    "create policy working_group_members_select",
    "create policy working_group_members_insert",
  );
  assert.match(policy, /account_id = \(select auth\.uid\(\)\)/);
  assert.match(policy, /can_manage_working_group\(working_group_id\)/);
  assert.doesNotMatch(policy, /is_entity_member/);
});

test("Camp participant identity cannot leave stale access relationships", () => {
  const guard = section(
    "create or replace function hearthland_private.guard_camp_participant_identity()",
    "create trigger guard_hearthland_camp_participant_identity",
  );
  for (const immutableColumn of [
    "camp_entity_id",
    "account_id",
    "application_id",
    "joined_via",
    "accepted_at",
  ]) {
    assert.match(guard, new RegExp(`new\\.${immutableColumn}`));
    assert.match(guard, new RegExp(`old\\.${immutableColumn}`));
  }
  assert.match(migration, /revoke delete on hearthland\.camp_participants from authenticated;/);
});

test("expired invitations release their uniqueness slot before reissue", () => {
  const creator = section(
    "create or replace function hearthland.create_invitation(payload jsonb)",
    "create or replace function hearthland.get_invitation_preview(raw_token text)",
  );
  assert.match(
    creator,
    /update hearthland\.invitations i[\s\S]*i\.status in \('pending', 'viewed'\)[\s\S]*i\.expires_at <= now\(\)/,
  );
});

test("submitted applications expose only bounded status updates", () => {
  assert.match(
    migration,
    /revoke update on hearthland\.camp_applications from authenticated;[\s\S]*grant update \(status\) on hearthland\.camp_applications to authenticated;/,
  );
  assert.match(
    migration,
    /revoke update on hearthland\.opportunity_applications from authenticated;[\s\S]*grant update \(status\) on hearthland\.opportunity_applications to authenticated;/,
  );
  assert.match(
    migration,
    /revoke update on hearthland\.community_interests from authenticated;[\s\S]*grant update \(pipeline_status\) on hearthland\.community_interests to authenticated;/,
  );
});

test("Camp attribution is type checked, authority checked and immutable after publication", () => {
  const guard = section(
    "create or replace function hearthland_private.guard_building_camp_links()",
    "create trigger guard_t3_4_building_camp_links",
  );
  assert.match(guard, /host\.entity_type in \('community', 'emerging_community'\)/);
  assert.match(guard, /can_manage_entity\(new\.host_entity_id\)/);
  assert.match(guard, /can_manage_entity\(new\.project_entity_id\)/);
  assert.match(guard, /Published Camp attribution is immutable/);
});

test("published Camp results complete the Camp and public media requires an asset record", () => {
  const snapshot = section(
    "create or replace function hearthland_private.snapshot_camp_result_counts()",
    "create trigger snapshot_hearthland_camp_result_counts",
  );
  assert.match(snapshot, /update hearthland\.building_camps[\s\S]*camp_status = 'completed'/);
  assert.match(
    migration,
    /create policy hearthland_entity_media_select[\s\S]*exists \([\s\S]*from hearthland\.media_assets ma[\s\S]*ma\.object_path = storage\.objects\.name[\s\S]*ma\.visibility = 'public'/,
  );
});
