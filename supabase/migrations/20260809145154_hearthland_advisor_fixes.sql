-- Hearthland T3.3 database-advisor follow-up.
--
-- This migration is intentionally limited to the `hearthland` schema:
--   * index every foreign-key column reported by the Supabase advisor;
--   * replace five overlapping FOR ALL policies with operation-specific
--     INSERT, UPDATE, and DELETE policies;
--   * preserve the existing SELECT policies and their visibility rules;
--   * leave the pre-existing COM objects in `public` untouched.

begin;

-- ---------------------------------------------------------------------------
-- Foreign-key indexes
-- ---------------------------------------------------------------------------

create index if not exists activity_events_actor_account_id_idx
  on hearthland.activity_events (actor_account_id);

create index if not exists building_camps_project_entity_id_idx
  on hearthland.building_camps (project_entity_id);

create index if not exists camp_application_notes_created_by_account_id_idx
  on hearthland.camp_application_notes (created_by_account_id);

create index if not exists camp_build_item_skills_skill_id_idx
  on hearthland.camp_build_item_skills (skill_id);

create index if not exists camp_build_items_lead_account_id_idx
  on hearthland.camp_build_items (lead_account_id);

create index if not exists camp_learning_topics_learning_topic_entity_id_idx
  on hearthland.camp_learning_topics (learning_topic_entity_id);

create index if not exists camp_schedule_items_leader_account_id_idx
  on hearthland.camp_schedule_items (leader_account_id);

create index if not exists camp_team_account_id_idx
  on hearthland.camp_team (account_id);

create index if not exists camp_team_invitation_id_idx
  on hearthland.camp_team (invitation_id);

create index if not exists community_interest_notes_created_by_account_id_idx
  on hearthland.community_interest_notes (created_by_account_id);

create index if not exists conversations_created_by_account_id_idx
  on hearthland.conversations (created_by_account_id);

create index if not exists creation_drafts_entity_id_idx
  on hearthland.creation_drafts (entity_id);

create index if not exists entities_created_by_account_id_idx
  on hearthland.entities (created_by_account_id);

create index if not exists entities_updated_by_account_id_idx
  on hearthland.entities (updated_by_account_id);

create index if not exists entity_memberships_created_by_account_id_idx
  on hearthland.entity_memberships (created_by_account_id);

create index if not exists entity_relationships_created_by_account_id_idx
  on hearthland.entity_relationships (created_by_account_id);

create index if not exists entity_roles_granted_by_account_id_idx
  on hearthland.entity_roles (granted_by_account_id);

create index if not exists entity_skill_needs_created_by_account_id_idx
  on hearthland.entity_skill_needs (created_by_account_id);

create index if not exists entity_tags_tag_id_idx
  on hearthland.entity_tags (tag_id);

create index if not exists entity_values_value_id_idx
  on hearthland.entity_values (value_id);

create index if not exists invitations_accepted_by_account_id_idx
  on hearthland.invitations (accepted_by_account_id);

create index if not exists land_enquiries_project_entity_id_idx
  on hearthland.land_enquiries (project_entity_id);

create index if not exists land_wanted_created_by_account_id_idx
  on hearthland.land_wanted (created_by_account_id);

create index if not exists land_wanted_project_entity_id_idx
  on hearthland.land_wanted (project_entity_id);

create index if not exists land_wanted_updated_by_account_id_idx
  on hearthland.land_wanted (updated_by_account_id);

create index if not exists media_assets_uploader_account_id_idx
  on hearthland.media_assets (uploader_account_id);

create index if not exists moderation_actions_performed_by_account_id_idx
  on hearthland.moderation_actions (performed_by_account_id);

create index if not exists moderation_actions_target_account_id_idx
  on hearthland.moderation_actions (target_account_id);

create index if not exists moderation_actions_target_entity_id_idx
  on hearthland.moderation_actions (target_entity_id);

create index if not exists need_responses_offer_id_idx
  on hearthland.need_responses (offer_id);

create index if not exists needs_created_by_account_id_idx
  on hearthland.needs (created_by_account_id);

create index if not exists needs_updated_by_account_id_idx
  on hearthland.needs (updated_by_account_id);

create index if not exists notifications_actor_account_id_idx
  on hearthland.notifications (actor_account_id);

create index if not exists notifications_entity_id_idx
  on hearthland.notifications (entity_id);

create index if not exists offers_created_by_account_id_idx
  on hearthland.offers (created_by_account_id);

create index if not exists offers_provider_entity_id_idx
  on hearthland.offers (provider_entity_id);

create index if not exists offers_updated_by_account_id_idx
  on hearthland.offers (updated_by_account_id);

create index if not exists opportunity_application_notes_created_by_account_id_idx
  on hearthland.opportunity_application_notes (created_by_account_id);

create index if not exists platform_roles_granted_by_account_id_idx
  on hearthland.platform_roles (granted_by_account_id);

create index if not exists professional_profiles_organisation_entity_id_idx
  on hearthland.professional_profiles (organisation_entity_id);

create index if not exists profile_values_value_id_idx
  on hearthland.profile_values (value_id);

create index if not exists project_milestones_created_by_account_id_idx
  on hearthland.project_milestones (created_by_account_id);

create index if not exists project_milestones_updated_by_account_id_idx
  on hearthland.project_milestones (updated_by_account_id);

create index if not exists project_stage_progress_updated_by_account_id_idx
  on hearthland.project_stage_progress (updated_by_account_id);

create index if not exists project_updates_camp_entity_id_idx
  on hearthland.project_updates (camp_entity_id);

create index if not exists project_updates_created_by_account_id_idx
  on hearthland.project_updates (created_by_account_id);

create index if not exists project_updates_image_media_id_idx
  on hearthland.project_updates (image_media_id);

create index if not exists project_updates_milestone_id_idx
  on hearthland.project_updates (milestone_id);

create index if not exists project_updates_updated_by_account_id_idx
  on hearthland.project_updates (updated_by_account_id);

create index if not exists reports_assigned_to_account_id_idx
  on hearthland.reports (assigned_to_account_id);

create index if not exists reports_reported_account_id_idx
  on hearthland.reports (reported_account_id);

create index if not exists reports_reported_entity_id_idx
  on hearthland.reports (reported_entity_id);

create index if not exists reports_reporter_account_id_idx
  on hearthland.reports (reporter_account_id);

create index if not exists saved_entities_entity_id_idx
  on hearthland.saved_entities (entity_id);

create index if not exists tasks_created_by_account_id_idx
  on hearthland.tasks (created_by_account_id);

create index if not exists tasks_updated_by_account_id_idx
  on hearthland.tasks (updated_by_account_id);

-- ---------------------------------------------------------------------------
-- Non-overlapping write policies
-- ---------------------------------------------------------------------------

drop policy if exists camp_build_item_skills_manage
  on hearthland.camp_build_item_skills;

drop policy if exists camp_build_item_skills_insert
  on hearthland.camp_build_item_skills;
create policy camp_build_item_skills_insert
on hearthland.camp_build_item_skills
for insert to authenticated
with check (
  exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
);

drop policy if exists camp_build_item_skills_update
  on hearthland.camp_build_item_skills;
create policy camp_build_item_skills_update
on hearthland.camp_build_item_skills
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

drop policy if exists camp_build_item_skills_delete
  on hearthland.camp_build_item_skills;
create policy camp_build_item_skills_delete
on hearthland.camp_build_item_skills
for delete to authenticated
using (
  exists (
    select 1
    from hearthland.camp_build_items bi
    where bi.id = build_item_id
      and hearthland_private.can_manage_entity(bi.camp_entity_id)
  )
);

drop policy if exists entity_relationships_manage
  on hearthland.entity_relationships;

drop policy if exists entity_relationships_insert
  on hearthland.entity_relationships;
create policy entity_relationships_insert
on hearthland.entity_relationships
for insert to authenticated
with check (hearthland_private.can_manage_entity(source_entity_id));

drop policy if exists entity_relationships_update
  on hearthland.entity_relationships;
create policy entity_relationships_update
on hearthland.entity_relationships
for update to authenticated
using (hearthland_private.can_manage_entity(source_entity_id))
with check (hearthland_private.can_manage_entity(source_entity_id));

drop policy if exists entity_relationships_delete
  on hearthland.entity_relationships;
create policy entity_relationships_delete
on hearthland.entity_relationships
for delete to authenticated
using (hearthland_private.can_manage_entity(source_entity_id));

-- Catalogue policies use a single SELECT policy per table. Splitting the
-- administrator write access by operation avoids a second permissive SELECT
-- policy while retaining the original write authorization predicate.

drop policy if exists catalogue_manage on hearthland.skills;

drop policy if exists catalogue_insert on hearthland.skills;
create policy catalogue_insert
on hearthland.skills
for insert to authenticated
with check (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_update on hearthland.skills;
create policy catalogue_update
on hearthland.skills
for update to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]))
with check (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_delete on hearthland.skills;
create policy catalogue_delete
on hearthland.skills
for delete to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_manage on hearthland.tags;

drop policy if exists catalogue_insert on hearthland.tags;
create policy catalogue_insert
on hearthland.tags
for insert to authenticated
with check (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_update on hearthland.tags;
create policy catalogue_update
on hearthland.tags
for update to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]))
with check (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_delete on hearthland.tags;
create policy catalogue_delete
on hearthland.tags
for delete to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_manage on hearthland.values_catalog;

drop policy if exists catalogue_insert on hearthland.values_catalog;
create policy catalogue_insert
on hearthland.values_catalog
for insert to authenticated
with check (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_update on hearthland.values_catalog;
create policy catalogue_update
on hearthland.values_catalog
for update to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]))
with check (hearthland_private.is_platform_staff(array['admin']::text[]));

drop policy if exists catalogue_delete on hearthland.values_catalog;
create policy catalogue_delete
on hearthland.values_catalog
for delete to authenticated
using (hearthland_private.is_platform_staff(array['admin']::text[]));

commit;
