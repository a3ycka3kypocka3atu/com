import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  archivedAt: text("archived_at"),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  accountStatus: text("account_status").notNull().default("active"),
  verificationState: text("verification_state").notNull().default("email_verified"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const userIntentions = sqliteTable("user_intentions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  intention: text("intention").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_user_intentions_unique").on(table.userId, table.intention)]);

export const personProfiles = sqliteTable("person_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  headline: text("headline").notNull().default(""),
  bio: text("bio").notNull().default(""),
  country: text("country"),
  region: text("region"),
  city: text("city"),
  relocationReadiness: text("relocation_readiness"),
  geographicFlexibility: text("geographic_flexibility"),
  communitySizeMin: integer("community_size_min"),
  communitySizeMax: integer("community_size_max"),
  communalLifeLevel: integer("communal_life_level"),
  governancePreference: text("governance_preference"),
  ownershipPreference: text("ownership_preference"),
  economicIntegration: integer("economic_integration"),
  familySituation: text("family_situation"),
  profileCompleteness: integer("profile_completeness").notNull().default(0),
  visibility: text("visibility").notNull().default("platform_members"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_person_profiles_user").on(table.userId),
  uniqueIndex("idx_person_profiles_slug").on(table.slug),
  index("idx_person_profiles_location").on(table.country, table.region),
]);

export const communities = sqliteTable("communities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull(),
  fullDescription: text("full_description").notNull().default(""),
  country: text("country").notNull(),
  region: text("region"),
  nearestCity: text("nearest_city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  locationVisibility: text("location_visibility").notNull().default("approximate"),
  communityType: text("community_type").notNull(),
  status: text("status").notNull().default("active"),
  residents: integer("residents").notNull().default(0),
  targetResidents: integer("target_residents"),
  children: integer("children"),
  foundingYear: integer("founding_year"),
  acceptingMembers: integer("accepting_members", { mode: "boolean" }).notNull().default(false),
  membershipStatus: text("membership_status").notNull().default("closed"),
  governanceModel: text("governance_model"),
  ownershipModel: text("ownership_model"),
  economicModel: text("economic_model"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("public"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_communities_slug").on(table.slug),
  index("idx_communities_search").on(table.country, table.status, table.communityType, table.acceptingMembers),
]);

export const emergingCommunities = sqliteTable("emerging_communities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull(),
  vision: text("vision").notNull().default(""),
  targetCountry: text("target_country"),
  targetRegion: text("target_region"),
  communityType: text("community_type").notNull(),
  stage: text("stage").notNull().default("idea"),
  currentMembers: integer("current_members").notNull().default(1),
  targetSizeMin: integer("target_size_min"),
  targetSizeMax: integer("target_size_max"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("public"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_emerging_slug").on(table.slug),
  index("idx_emerging_search").on(table.targetCountry, table.stage, table.communityType),
]);

export const settlementProjects = sqliteTable("settlement_projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  emergingCommunityId: integer("emerging_community_id").notNull().references(() => emergingCommunities.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  stage: text("stage").notNull().default("vision"),
  targetCountry: text("target_country"),
  targetRegion: text("target_region"),
  targetPopulation: integer("target_population"),
  landRequirementHa: real("land_requirement_ha"),
  approximateBudgetEur: integer("approximate_budget_eur"),
  fundingStatus: text("funding_status"),
  nextMilestone: text("next_milestone"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("public"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_projects_slug").on(table.slug),
  index("idx_projects_search").on(table.targetCountry, table.stage),
]);

export const landListings = sqliteTable("land_listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  country: text("country").notNull(),
  region: text("region"),
  nearestCity: text("nearest_city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  locationVisibility: text("location_visibility").notNull().default("approximate"),
  totalArea: real("total_area").notNull(),
  areaUnit: text("area_unit").notNull().default("ha"),
  priceEur: integer("price_eur"),
  priceVisibility: text("price_visibility").notNull().default("public_exact"),
  ownershipStatus: text("ownership_status"),
  listingStatus: text("listing_status").notNull().default("available"),
  hasWater: integer("has_water", { mode: "boolean" }),
  hasBuildings: integer("has_buildings", { mode: "boolean" }),
  agricultural: integer("agricultural", { mode: "boolean" }),
  forestAreaHa: real("forest_area_ha"),
  zoningKnown: integer("zoning_known", { mode: "boolean" }),
  constructionStatus: text("construction_status"),
  collaborationModel: text("collaboration_model"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("public"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_land_slug").on(table.slug),
  index("idx_land_search").on(table.country, table.region, table.listingStatus, table.totalArea, table.priceEur),
]);

export const organisations = sqliteTable("organisations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  organisationType: text("organisation_type").notNull(),
  country: text("country"),
  description: text("description").notNull().default(""),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("public"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_organisations_slug").on(table.slug)]);

export const professionals = sqliteTable("professionals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personProfileId: integer("person_profile_id").references(() => personProfiles.id),
  organisationId: integer("organisation_id").references(() => organisations.id),
  headline: text("headline").notNull(),
  availability: text("availability"),
  remotePossible: integer("remote_possible", { mode: "boolean" }).notNull().default(false),
  verificationState: text("verification_state").notNull().default("unverified"),
  ...timestamps,
});

export const opportunities = sqliteTable("opportunities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  opportunityType: text("opportunity_type").notNull(),
  parentEntityType: text("parent_entity_type").notNull(),
  parentEntityId: integer("parent_entity_id").notNull(),
  description: text("description").notNull(),
  country: text("country"),
  region: text("region"),
  remotePossible: integer("remote_possible", { mode: "boolean" }).notNull().default(false),
  startDate: text("start_date"),
  duration: text("duration"),
  compensationType: text("compensation_type"),
  accommodationIncluded: integer("accommodation_included", { mode: "boolean" }).notNull().default(false),
  foodIncluded: integer("food_included", { mode: "boolean" }).notNull().default(false),
  positions: integer("positions").notNull().default(1),
  deadline: text("deadline"),
  status: text("status").notNull().default("draft"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_opportunities_slug").on(table.slug),
  index("idx_opportunities_search").on(table.opportunityType, table.country, table.status, table.startDate),
]);

export const opportunityApplications = sqliteTable("opportunity_applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  applicantUserId: text("applicant_user_id").notNull().references(() => users.id),
  message: text("message").notNull().default(""),
  availability: text("availability"),
  contactPreference: text("contact_preference"),
  status: text("status").notNull().default("submitted"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_applications_unique").on(table.opportunityId, table.applicantUserId),
  index("idx_applications_status").on(table.status, table.createdAt),
]);

export const communityInterests = sqliteTable("community_interests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  message: text("message").notNull().default(""),
  pipelineStatus: text("pipeline_status").notNull().default("new_interest"),
  internalNotes: text("internal_notes").notNull().default(""),
  ...timestamps,
}, (table) => [
  index("idx_interests_pipeline").on(table.entityType, table.entityId, table.pipelineStatus),
]);

export const communityMembers = sqliteTable("community_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("invited"),
  publicVisibility: integer("public_visibility", { mode: "boolean" }).notNull().default(true),
  joinedAt: text("joined_at"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_members_unique").on(table.entityType, table.entityId, table.userId)]);

export const entityRoles = sqliteTable("entity_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  grantedByUserId: text("granted_by_user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_entity_roles_unique").on(table.entityType, table.entityId, table.userId)]);

export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
}, (table) => [uniqueIndex("idx_skills_slug").on(table.slug), index("idx_skills_category").on(table.category)]);

export const personSkills = sqliteTable("person_skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personProfileId: integer("person_profile_id").notNull().references(() => personProfiles.id),
  skillId: integer("skill_id").notNull().references(() => skills.id),
  level: text("level").notNull(),
  yearsExperience: integer("years_experience"),
  canTeach: integer("can_teach", { mode: "boolean" }).notNull().default(false),
  willingToContribute: integer("willing_to_contribute", { mode: "boolean" }).notNull().default(true),
}, (table) => [uniqueIndex("idx_person_skills_unique").on(table.personProfileId, table.skillId)]);

export const entitySkillNeeds = sqliteTable("entity_skill_needs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  skillId: integer("skill_id").notNull().references(() => skills.id),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
}, (table) => [index("idx_skill_needs_entity").on(table.entityType, table.entityId, table.status)]);

export const values = sqliteTable("values", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
}, (table) => [uniqueIndex("idx_values_slug").on(table.slug)]);

export const entityValues = sqliteTable("entity_values", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  valueId: integer("value_id").notNull().references(() => values.id),
}, (table) => [uniqueIndex("idx_entity_values_unique").on(table.entityType, table.entityId, table.valueId)]);

export const needs = sqliteTable("needs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  urgency: text("urgency").notNull().default("normal"),
  quantity: text("quantity"),
  country: text("country"),
  status: text("status").notNull().default("open"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [index("idx_needs_match").on(table.category, table.status, table.country)]);

export const offers = sqliteTable("offers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  country: text("country"),
  status: text("status").notNull().default("open"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [index("idx_offers_match").on(table.category, table.status, table.country)]);

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  assigneeUserId: text("assignee_user_id").references(() => users.id),
  dueDate: text("due_date"),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  linkedStage: text("linked_stage"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [index("idx_tasks_workspace").on(table.entityType, table.entityId, table.status, table.dueDate)]);

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requesterUserId: text("requester_user_id").notNull().references(() => users.id),
  receiverUserId: text("receiver_user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_connections_unique").on(table.requesterUserId, table.receiverUserId), index("idx_connections_receiver").on(table.receiverUserId, table.status)]);

export const follows = sqliteTable("follows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_follows_unique").on(table.userId, table.entityType, table.entityId)]);

export const savedEntities = sqliteTable("saved_entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_saved_unique").on(table.userId, table.entityType, table.entityId), index("idx_saved_user").on(table.userId, table.createdAt)]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  notificationType: text("notification_type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  targetUrl: text("target_url"),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_notifications_unread").on(table.userId, table.readAt, table.createdAt)]);

export const activityEvents = sqliteTable("activity_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: text("actor_user_id").references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  summary: text("summary").notNull(),
  visibility: text("visibility").notNull().default("members"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_activity_entity").on(table.entityType, table.entityId, table.createdAt)]);

export const actionEvents = sqliteTable("action_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityExternalId: text("entity_external_id").notNull(),
  reason: text("reason"),
  message: text("message").notNull().default(""),
  metadata: text("metadata").notNull().default("{}"),
  status: text("status").notNull().default("submitted"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_action_events_user").on(table.userId, table.createdAt), index("idx_action_events_entity").on(table.entityType, table.entityExternalId, table.actionType)]);

export const landWanted = sqliteTable("land_wanted", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => settlementProjects.id),
  country: text("country").notNull(),
  targetRegion: text("target_region"),
  minAreaHa: real("min_area_ha"),
  maxAreaHa: real("max_area_ha"),
  maxBudgetEur: integer("max_budget_eur"),
  waterRequired: integer("water_required", { mode: "boolean" }).notNull().default(false),
  buildingsRequired: integer("buildings_required", { mode: "boolean" }).notNull().default(false),
  forestPreference: text("forest_preference"),
  agricultureRequired: integer("agriculture_required", { mode: "boolean" }).notNull().default(false),
  infrastructureNotes: text("infrastructure_notes").notNull().default(""),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, (table) => [index("idx_land_wanted_match").on(table.country, table.targetRegion, table.status, table.minAreaHa, table.maxBudgetEur)]);

export const projectStageProgress = sqliteTable("project_stage_progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => settlementProjects.id),
  stage: text("stage").notNull(),
  status: text("status").notNull().default("not_started"),
  notes: text("notes").notNull().default(""),
  updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [uniqueIndex("idx_project_stage_unique").on(table.projectId, table.stage)]);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taxonomy: text("taxonomy").notNull(),
  label: text("label").notNull(),
  slug: text("slug").notNull(),
}, (table) => [uniqueIndex("idx_tags_taxonomy_slug").on(table.taxonomy, table.slug)]);

export const entityTags = sqliteTable("entity_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  tagId: integer("tag_id").notNull().references(() => tags.id),
}, (table) => [uniqueIndex("idx_entity_tags_unique").on(table.entityType, table.entityId, table.tagId)]);

export const entityRelationships = sqliteTable("entity_relationships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  status: text("status").notNull().default("active"),
  startDate: text("start_date"),
  visibility: text("visibility").notNull().default("public"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [index("idx_relationship_source").on(table.sourceType, table.sourceId, table.relationshipType), index("idx_relationship_target").on(table.targetType, table.targetId, table.relationshipType)]);

export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reporterUserId: text("reporter_user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  reason: text("reason").notNull(),
  details: text("details").notNull().default(""),
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_reports_status").on(table.status, table.createdAt)]);

export const learningTopics = sqliteTable("learning_topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("published"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_learning_topics_slug").on(table.slug), index("idx_learning_topics_category").on(table.category, table.status)]);

export const buildingCamps = sqliteTable("building_camps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  parentEntityType: text("parent_entity_type").notNull(),
  parentEntityId: integer("parent_entity_id").notNull(),
  projectId: integer("project_id").references(() => settlementProjects.id),
  location: text("location").notNull(),
  country: text("country").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  shortDescription: text("short_description").notNull(),
  fullDescription: text("full_description").notNull().default(""),
  maxParticipants: integer("max_participants").notNull(),
  applicationDeadline: text("application_deadline"),
  accommodationType: text("accommodation_type"),
  foodModel: text("food_model"),
  contributionType: text("contribution_type"),
  contributionDetails: text("contribution_details"),
  status: text("status").notNull().default("draft"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("public"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_building_camps_slug").on(table.slug), index("idx_building_camps_search").on(table.country, table.startDate, table.status)]);

export const campBuildItems = sqliteTable("camp_build_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campId: integer("camp_id").notNull().references(() => buildingCamps.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("planned"),
  leadRole: text("lead_role"),
  targetParticipants: integer("target_participants"),
}, (table) => [index("idx_camp_build_items_camp").on(table.campId, table.status)]);

export const campLearningTopics = sqliteTable("camp_learning_topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campId: integer("camp_id").notNull().references(() => buildingCamps.id),
  learningTopicId: integer("learning_topic_id").notNull().references(() => learningTopics.id),
}, (table) => [uniqueIndex("idx_camp_learning_unique").on(table.campId, table.learningTopicId)]);

export const campScheduleItems = sqliteTable("camp_schedule_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campId: integer("camp_id").notNull().references(() => buildingCamps.id),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time"),
  title: text("title").notNull(),
  itemType: text("item_type").notNull(),
  leaderUserId: text("leader_user_id").references(() => users.id),
  location: text("location"),
  description: text("description").notNull().default(""),
}, (table) => [index("idx_camp_schedule_camp_date").on(table.campId, table.scheduledDate, table.scheduledTime)]);

export const campApplications = sqliteTable("camp_applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campId: integer("camp_id").notNull().references(() => buildingCamps.id),
  applicantUserId: text("applicant_user_id").notNull().references(() => users.id),
  roles: text("roles").notNull(),
  motivation: text("motivation").notNull().default(""),
  skillsOffered: text("skills_offered").notNull().default(""),
  learningInterests: text("learning_interests").notNull().default(""),
  availability: text("availability"),
  accommodationRequirement: text("accommodation_requirement"),
  resourcesOffered: text("resources_offered").notNull().default(""),
  futureCommunityInterest: text("future_community_interest"),
  status: text("status").notNull().default("new"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_camp_applications_unique").on(table.campId, table.applicantUserId), index("idx_camp_applications_status").on(table.campId, table.status)]);

export const campTeam = sqliteTable("camp_team", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campId: integer("camp_id").notNull().references(() => buildingCamps.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  publicVisibility: integer("public_visibility", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_camp_team_unique").on(table.campId, table.userId, table.role)]);

export const projectMilestones = sqliteTable("project_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => settlementProjects.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  targetDate: text("target_date"),
  status: text("status").notNull().default("future"),
  ...timestamps,
}, (table) => [index("idx_project_milestones").on(table.projectId, table.targetDate, table.status)]);

export const projectUpdates = sqliteTable("project_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => settlementProjects.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  milestoneId: integer("milestone_id").references(() => projectMilestones.id),
  campId: integer("camp_id").references(() => buildingCamps.id),
  publishedAt: text("published_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [index("idx_project_updates").on(table.projectId, table.publishedAt)]);
