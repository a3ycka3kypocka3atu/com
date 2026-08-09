CREATE TABLE `action_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`action_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_external_id` text NOT NULL,
	`reason` text,
	`message` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_action_events_user` ON `action_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_action_events_entity` ON `action_events` (`entity_type`,`entity_external_id`,`action_type`);--> statement-breakpoint
CREATE TABLE `activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`visibility` text DEFAULT 'members' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_activity_entity` ON `activity_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `building_camps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`parent_entity_type` text NOT NULL,
	`parent_entity_id` integer NOT NULL,
	`project_id` integer,
	`location` text NOT NULL,
	`country` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`short_description` text NOT NULL,
	`full_description` text DEFAULT '' NOT NULL,
	`max_participants` integer NOT NULL,
	`application_deadline` text,
	`accommodation_type` text,
	`food_model` text,
	`contribution_type` text,
	`contribution_details` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `settlement_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_building_camps_slug` ON `building_camps` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_building_camps_search` ON `building_camps` (`country`,`start_date`,`status`);--> statement-breakpoint
CREATE TABLE `camp_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camp_id` integer NOT NULL,
	`applicant_user_id` text NOT NULL,
	`roles` text NOT NULL,
	`motivation` text DEFAULT '' NOT NULL,
	`skills_offered` text DEFAULT '' NOT NULL,
	`learning_interests` text DEFAULT '' NOT NULL,
	`availability` text,
	`accommodation_requirement` text,
	`resources_offered` text DEFAULT '' NOT NULL,
	`future_community_interest` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`camp_id`) REFERENCES `building_camps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applicant_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_camp_applications_unique` ON `camp_applications` (`camp_id`,`applicant_user_id`);--> statement-breakpoint
CREATE INDEX `idx_camp_applications_status` ON `camp_applications` (`camp_id`,`status`);--> statement-breakpoint
CREATE TABLE `camp_build_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camp_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`lead_role` text,
	`target_participants` integer,
	FOREIGN KEY (`camp_id`) REFERENCES `building_camps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_camp_build_items_camp` ON `camp_build_items` (`camp_id`,`status`);--> statement-breakpoint
CREATE TABLE `camp_learning_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camp_id` integer NOT NULL,
	`learning_topic_id` integer NOT NULL,
	FOREIGN KEY (`camp_id`) REFERENCES `building_camps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`learning_topic_id`) REFERENCES `learning_topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_camp_learning_unique` ON `camp_learning_topics` (`camp_id`,`learning_topic_id`);--> statement-breakpoint
CREATE TABLE `camp_schedule_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camp_id` integer NOT NULL,
	`scheduled_date` text NOT NULL,
	`scheduled_time` text,
	`title` text NOT NULL,
	`item_type` text NOT NULL,
	`leader_user_id` text,
	`location` text,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`camp_id`) REFERENCES `building_camps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leader_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_camp_schedule_camp_date` ON `camp_schedule_items` (`camp_id`,`scheduled_date`,`scheduled_time`);--> statement-breakpoint
CREATE TABLE `camp_team` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camp_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`public_visibility` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`camp_id`) REFERENCES `building_camps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_camp_team_unique` ON `camp_team` (`camp_id`,`user_id`,`role`);--> statement-breakpoint
CREATE TABLE `communities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`short_description` text NOT NULL,
	`full_description` text DEFAULT '' NOT NULL,
	`country` text NOT NULL,
	`region` text,
	`nearest_city` text,
	`latitude` real,
	`longitude` real,
	`location_visibility` text DEFAULT 'approximate' NOT NULL,
	`community_type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`residents` integer DEFAULT 0 NOT NULL,
	`target_residents` integer,
	`children` integer,
	`founding_year` integer,
	`accepting_members` integer DEFAULT false NOT NULL,
	`membership_status` text DEFAULT 'closed' NOT NULL,
	`governance_model` text,
	`ownership_model` text,
	`economic_model` text,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_communities_slug` ON `communities` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_communities_search` ON `communities` (`country`,`status`,`community_type`,`accepting_members`);--> statement-breakpoint
CREATE TABLE `community_interests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`pipeline_status` text DEFAULT 'new_interest' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_interests_pipeline` ON `community_interests` (`entity_type`,`entity_id`,`pipeline_status`);--> statement-breakpoint
CREATE TABLE `community_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`public_visibility` integer DEFAULT true NOT NULL,
	`joined_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_unique` ON `community_members` (`entity_type`,`entity_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requester_user_id` text NOT NULL,
	`receiver_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receiver_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connections_unique` ON `connections` (`requester_user_id`,`receiver_user_id`);--> statement-breakpoint
CREATE INDEX `idx_connections_receiver` ON `connections` (`receiver_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `emerging_communities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`short_description` text NOT NULL,
	`vision` text DEFAULT '' NOT NULL,
	`target_country` text,
	`target_region` text,
	`community_type` text NOT NULL,
	`stage` text DEFAULT 'idea' NOT NULL,
	`current_members` integer DEFAULT 1 NOT NULL,
	`target_size_min` integer,
	`target_size_max` integer,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_emerging_slug` ON `emerging_communities` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_emerging_search` ON `emerging_communities` (`target_country`,`stage`,`community_type`);--> statement-breakpoint
CREATE TABLE `entity_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`relationship_type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_relationship_source` ON `entity_relationships` (`source_type`,`source_id`,`relationship_type`);--> statement-breakpoint
CREATE INDEX `idx_relationship_target` ON `entity_relationships` (`target_type`,`target_id`,`relationship_type`);--> statement-breakpoint
CREATE TABLE `entity_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entity_roles_unique` ON `entity_roles` (`entity_type`,`entity_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `entity_skill_needs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`skill_id` integer NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_skill_needs_entity` ON `entity_skill_needs` (`entity_type`,`entity_id`,`status`);--> statement-breakpoint
CREATE TABLE `entity_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entity_tags_unique` ON `entity_tags` (`entity_type`,`entity_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `entity_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`value_id` integer NOT NULL,
	FOREIGN KEY (`value_id`) REFERENCES `values`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entity_values_unique` ON `entity_values` (`entity_type`,`entity_id`,`value_id`);--> statement-breakpoint
CREATE TABLE `follows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_follows_unique` ON `follows` (`user_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `land_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`country` text NOT NULL,
	`region` text,
	`nearest_city` text,
	`latitude` real,
	`longitude` real,
	`location_visibility` text DEFAULT 'approximate' NOT NULL,
	`total_area` real NOT NULL,
	`area_unit` text DEFAULT 'ha' NOT NULL,
	`price_eur` integer,
	`price_visibility` text DEFAULT 'public_exact' NOT NULL,
	`ownership_status` text,
	`listing_status` text DEFAULT 'available' NOT NULL,
	`has_water` integer,
	`has_buildings` integer,
	`agricultural` integer,
	`forest_area_ha` real,
	`zoning_known` integer,
	`construction_status` text,
	`collaboration_model` text,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_land_slug` ON `land_listings` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_land_search` ON `land_listings` (`country`,`region`,`listing_status`,`total_area`,`price_eur`);--> statement-breakpoint
CREATE TABLE `land_wanted` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`country` text NOT NULL,
	`target_region` text,
	`min_area_ha` real,
	`max_area_ha` real,
	`max_budget_eur` integer,
	`water_required` integer DEFAULT false NOT NULL,
	`buildings_required` integer DEFAULT false NOT NULL,
	`forest_preference` text,
	`agriculture_required` integer DEFAULT false NOT NULL,
	`infrastructure_notes` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `settlement_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_land_wanted_match` ON `land_wanted` (`country`,`target_region`,`status`,`min_area_ha`,`max_budget_eur`);--> statement-breakpoint
CREATE TABLE `learning_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_learning_topics_slug` ON `learning_topics` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_learning_topics_category` ON `learning_topics` (`category`,`status`);--> statement-breakpoint
CREATE TABLE `needs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`urgency` text DEFAULT 'normal' NOT NULL,
	`quantity` text,
	`country` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_needs_match` ON `needs` (`category`,`status`,`country`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`target_url` text,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_unread` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`country` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_offers_match` ON `offers` (`category`,`status`,`country`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`opportunity_type` text NOT NULL,
	`parent_entity_type` text NOT NULL,
	`parent_entity_id` integer NOT NULL,
	`description` text NOT NULL,
	`country` text,
	`region` text,
	`remote_possible` integer DEFAULT false NOT NULL,
	`start_date` text,
	`duration` text,
	`compensation_type` text,
	`accommodation_included` integer DEFAULT false NOT NULL,
	`food_included` integer DEFAULT false NOT NULL,
	`positions` integer DEFAULT 1 NOT NULL,
	`deadline` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_opportunities_slug` ON `opportunities` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_opportunities_search` ON `opportunities` (`opportunity_type`,`country`,`status`,`start_date`);--> statement-breakpoint
CREATE TABLE `opportunity_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`applicant_user_id` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`availability` text,
	`contact_preference` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applicant_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_applications_unique` ON `opportunity_applications` (`opportunity_id`,`applicant_user_id`);--> statement-breakpoint
CREATE INDEX `idx_applications_status` ON `opportunity_applications` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`organisation_type` text NOT NULL,
	`country` text,
	`description` text DEFAULT '' NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_organisations_slug` ON `organisations` (`slug`);--> statement-breakpoint
CREATE TABLE `person_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`headline` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`country` text,
	`region` text,
	`city` text,
	`relocation_readiness` text,
	`geographic_flexibility` text,
	`community_size_min` integer,
	`community_size_max` integer,
	`communal_life_level` integer,
	`governance_preference` text,
	`ownership_preference` text,
	`economic_integration` integer,
	`family_situation` text,
	`profile_completeness` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'platform_members' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_person_profiles_user` ON `person_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_person_profiles_slug` ON `person_profiles` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_person_profiles_location` ON `person_profiles` (`country`,`region`);--> statement-breakpoint
CREATE TABLE `person_skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_profile_id` integer NOT NULL,
	`skill_id` integer NOT NULL,
	`level` text NOT NULL,
	`years_experience` integer,
	`can_teach` integer DEFAULT false NOT NULL,
	`willing_to_contribute` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`person_profile_id`) REFERENCES `person_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_person_skills_unique` ON `person_skills` (`person_profile_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `professionals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_profile_id` integer,
	`organisation_id` integer,
	`headline` text NOT NULL,
	`availability` text,
	`remote_possible` integer DEFAULT false NOT NULL,
	`verification_state` text DEFAULT 'unverified' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`person_profile_id`) REFERENCES `person_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`target_date` text,
	`status` text DEFAULT 'future' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `settlement_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_project_milestones` ON `project_milestones` (`project_id`,`target_date`,`status`);--> statement-breakpoint
CREATE TABLE `project_stage_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`stage` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `settlement_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_stage_unique` ON `project_stage_progress` (`project_id`,`stage`);--> statement-breakpoint
CREATE TABLE `project_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`image_url` text,
	`milestone_id` integer,
	`camp_id` integer,
	`published_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `settlement_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`milestone_id`) REFERENCES `project_milestones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`camp_id`) REFERENCES `building_camps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_project_updates` ON `project_updates` (`project_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reporter_user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reports_status` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `saved_entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_saved_unique` ON `saved_entities` (`user_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_saved_user` ON `saved_entities` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `settlement_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`emerging_community_id` integer NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'vision' NOT NULL,
	`target_country` text,
	`target_region` text,
	`target_population` integer,
	`land_requirement_ha` real,
	`approximate_budget_eur` integer,
	`funding_status` text,
	`next_milestone` text,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`emerging_community_id`) REFERENCES `emerging_communities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_slug` ON `settlement_projects` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_projects_search` ON `settlement_projects` (`target_country`,`stage`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_skills_slug` ON `skills` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_skills_category` ON `skills` (`category`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taxonomy` text NOT NULL,
	`label` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_taxonomy_slug` ON `tags` (`taxonomy`,`slug`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`assignee_user_id` text,
	`due_date` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`linked_stage` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace` ON `tasks` (`entity_type`,`entity_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `user_intentions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`intention` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_intentions_unique` ON `user_intentions` (`user_id`,`intention`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`account_status` text DEFAULT 'active' NOT NULL,
	`verification_state` text DEFAULT 'email_verified' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_values_slug` ON `values` (`slug`);