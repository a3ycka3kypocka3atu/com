#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  buildingCamps,
  communities,
  emergingCommunities,
  lands,
  learningTopics,
  opportunities,
  people,
  projects,
} from "../app/demo-data.ts";

const BATCH_KEY = "hearthland-curated-demo-v1";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function quote(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Cannot encode non-finite number: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function json(value) {
  return `${quote(JSON.stringify(value))}::jsonb`;
}

function textArray(values = []) {
  if (!values.length) return "array[]::text[]";
  return `array[${values.map(quote).join(", ")}]::text[]`;
}

function dateValue(value) {
  return value ? `${quote(value)}::date` : "null";
}

function timeValue(value) {
  return value ? `${quote(value)}::time` : "null";
}

function tuple(values) {
  return `(${values.join(", ")})`;
}

function valuesBlock(rows) {
  return rows.map((row) => `  ${tuple(row)}`).join(",\n");
}

function seedKey(kind, legacyId) {
  return `demo:${kind}:${legacyId}`;
}

function entityId(kind, legacyId) {
  return `(select id from hearthland.entities where seed_key = ${quote(seedKey(kind, legacyId))} and is_seeded_demo)`;
}

function skillSeedKey(name) {
  return `demo:skill:${slugify(name)}`;
}

function skillId(name) {
  return `(select id from hearthland.skills where seed_key = ${quote(skillSeedKey(name))} and is_seeded_demo)`;
}

function valueSeedKey(name) {
  return `demo:value:${slugify(name)}`;
}

function valueId(name) {
  return `(select id from hearthland.values_catalog where seed_key = ${quote(valueSeedKey(name))} and is_seeded_demo)`;
}

function platformMetadata(platformDto, sortOrder) {
  return { platformDto, sortOrder };
}

function parseRange(value) {
  const matches = String(value ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (!matches.length) return [null, null];
  return matches.length === 1 ? [matches[0], matches[0]] : [matches[0], matches[1]];
}

function parseHectares(value) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseDateLabel(value) {
  const match = String(value ?? "").match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!match) return null;
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const month = months[match[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function titleFromEntity(kind, dto) {
  if (kind === "person") return dto.name;
  if (kind === "community" || kind === "emerging" || kind === "project") return dto.name;
  return dto.title;
}

function descriptionFromEntity(kind, dto) {
  if (kind === "person") return dto.headline;
  if (kind === "project") return dto.nextMilestone;
  return dto.description;
}

function databaseEntityType(kind) {
  return {
    person: "person_profile",
    community: "community",
    emerging: "emerging_community",
    land: "land_listing",
    project: "settlement_project",
    opportunity: "opportunity",
    camp: "building_camp",
    learning: "learning_topic",
  }[kind];
}

function inferSkillCategory(name) {
  const value = name.toLowerCase();
  const patterns = [
    ["Agriculture", /agro|agric|farm|forestr|permaculture|seed|soil|garden|animal|food processing|land assessment|land care|water|contour/],
    ["Construction", /architect|build|carpentr|timber|roof|joinery|clay|stone|foundation|glazing|insulation|woodwork|tool|electrical|solar|sanitation/],
    ["Education", /teach|education|childcare|research/],
    ["Health and wellbeing", /health|care|wellbeing/],
    ["Digital", /software|digital/],
    ["Creative", /ceramic|creative|design/],
    ["Business", /finance|law|legal|business|entrepreneur|operation|project management/],
    ["Community", /facilitat|governance|mediat|conflict|community|group|sociocracy|cooperative/],
  ];
  return patterns.find(([, pattern]) => pattern.test(value))?.[0] ?? "General";
}

function relocationReadiness(availability) {
  const value = availability.toLowerCase();
  if (value.includes("actively ready")) return "ready";
  if (value.includes("within") || value.includes("year")) return "planning";
  if (value.includes("explor")) return "curious";
  return null;
}

function membershipStatus(value) {
  const normalized = value.toLowerCase();
  if (normalized === "open") return "open";
  if (normalized.includes("select") || normalized.includes("core team") || normalized.includes("wanted")) return "limited";
  if (normalized.includes("wait")) return "waitlist";
  return "closed";
}

function emergingStage(value) {
  const normalized = value.toLowerCase();
  if (normalized.includes("land")) return "land";
  if (normalized.includes("model")) return "community_model";
  if (normalized.includes("planning")) return "planning";
  if (normalized.includes("core")) return "core_team";
  return "idea";
}

function projectStage(value) {
  return {
    "Base Camp": "base_camp",
    "Community Model": "community_model",
    Planning: "planning",
  }[value] ?? "vision";
}

function projectProgressStatus(value) {
  return {
    "not started": "not_started",
    exploring: "active",
    "in progress": "active",
    prepared: "next",
    completed: "completed",
  }[value] ?? "not_started";
}

function listingStatus(value) {
  const normalized = value.toLowerCase();
  if (normalized.includes("under discussion") || normalized.includes("exploratory")) return "under_discussion";
  if (normalized.includes("reserved")) return "reserved";
  if (normalized.includes("unavailable")) return "unavailable";
  return "available";
}

function zoningKnown(value) {
  const normalized = value.toLowerCase();
  if (normalized === "known") return true;
  if (normalized === "unknown") return false;
  return null;
}

function buildStatus(value) {
  const normalized = value.toLowerCase();
  if (normalized.includes("progress")) return "in_progress";
  if (normalized === "planned") return "planned";
  if (normalized.includes("ready") || normalized.includes("survey")) return "preparing";
  if (normalized.includes("complete")) return "completed";
  return "planned";
}

function campStatus(value) {
  const normalized = value.toLowerCase();
  if (normalized.includes("open") || normalized.includes("registration")) return "applications_open";
  if (normalized.includes("complete")) return "completed";
  return "published";
}

function contributionType(value) {
  const normalized = value.toLowerCase();
  if (normalized.includes("donation")) return "donation";
  if (normalized.includes("volunteer") && normalized.includes("€")) return "mixed";
  if (normalized.includes("€")) return "fixed";
  return "exchange";
}

function learningTopicFor(label) {
  const normalized = slugify(label);
  const exact = learningTopics.find((topic) => slugify(topic.title) === normalized);
  if (exact) return slugify(exact.title);
  const aliases = [
    [/water|contour/, "water-on-the-land"],
    [/permaculture/, "permaculture-site-design"],
    [/soil|biodiversity|agroforest/, "soil-and-biodiversity"],
    [/timber|roof|joinery|carpentry/, "timber-construction"],
    [/natural|earth|stone|greenhouse|clay|insulation/, "natural-building"],
    [/cooperat|group|sociocracy|conflict|community|shared-work|restorative/, "working-well-in-groups"],
    [/food-preserv/, "food-preservation"],
    [/econom/, "cooperative-economy"],
    [/independ|tool-safety|sanitation|site-workflow/, "practical-independence"],
  ];
  return aliases.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

const sourceEntities = [
  ...people.map((dto, sortOrder) => ({ kind: "person", dto, sortOrder })),
  ...communities.map((dto, sortOrder) => ({ kind: "community", dto, sortOrder })),
  ...emergingCommunities.map((dto, sortOrder) => ({ kind: "emerging", dto, sortOrder })),
  ...lands.map((dto, sortOrder) => ({ kind: "land", dto, sortOrder })),
  ...projects.map((dto, sortOrder) => ({ kind: "project", dto, sortOrder })),
  ...opportunities.map((dto, sortOrder) => ({ kind: "opportunity", dto, sortOrder })),
  ...buildingCamps.map((dto, sortOrder) => ({ kind: "camp", dto, sortOrder })),
  ...learningTopics.map((dto, sortOrder) => ({
    kind: "learning",
    dto: { ...dto, slug: slugify(dto.title) },
    sortOrder,
  })),
];

const teacherSkillsByName = new Map();
for (const camp of buildingCamps) {
  for (const teacher of camp.teachers) {
    const set = teacherSkillsByName.get(teacher.name) ?? new Set();
    teacher.skills.forEach((skill) => set.add(skill));
    teacherSkillsByName.set(teacher.name, set);
  }
}

const allSkillNames = new Set();
people.forEach((person) => person.skills.forEach((skill) => allSkillNames.add(skill)));
[...communities, ...emergingCommunities].forEach((community) => community.needs.forEach((skill) => allSkillNames.add(skill)));
projects.forEach((project) => [...project.requiredSkills, ...project.availableSkills].forEach((skill) => allSkillNames.add(skill)));
opportunities.forEach((opportunity) => opportunity.skills.forEach((skill) => allSkillNames.add(skill)));
buildingCamps.forEach((camp) => {
  camp.builds.forEach((build) => build.learning.forEach((skill) => allSkillNames.add(skill)));
  camp.teachers.forEach((teacher) => teacher.skills.forEach((skill) => allSkillNames.add(skill)));
});
const skills = [...allSkillNames].sort(compareText);

const allValueNames = new Set();
people.forEach((person) => person.values.forEach((value) => allValueNames.add(value)));
[...communities, ...emergingCommunities].forEach((community) => community.values.forEach((value) => allValueNames.add(value)));
const values = [...allValueNames].sort(compareText);

const checksumPayload = {
  entities: sourceEntities.map(({ kind, dto, sortOrder }) => ({ kind, dto, sortOrder })),
  skills,
  values,
};
const checksum = createHash("sha256").update(JSON.stringify(checksumPayload)).digest("hex");

const sql = [];
sql.push(`-- Generated by scripts/generate-hearthland-seed.mjs from app/demo-data.ts.
-- Re-run with Node 22+: node --experimental-strip-types scripts/generate-hearthland-seed.mjs
-- The migration is additive and scoped to Hearthland seed keys; it does not touch public COM tables.

begin;

insert into hearthland.seed_batches (
  key, label, version, source, checksum, metadata, applied_at, updated_at
)
values (
  ${quote(BATCH_KEY)},
  'Hearthland curated launch directory',
  1,
  'app/demo-data.ts',
  ${quote(checksum)},
  ${json({
    entityCount: sourceEntities.length,
    people: people.length,
    communities: communities.length,
    emergingCommunities: emergingCommunities.length,
    lands: lands.length,
    projects: projects.length,
    opportunities: opportunities.length,
    buildingCamps: buildingCamps.length,
    learningTopics: learningTopics.length,
    skills: skills.length,
    values: values.length,
  })},
  now(),
  now()
)
on conflict (key) do update
set label = excluded.label,
    version = excluded.version,
    source = excluded.source,
    checksum = excluded.checksum,
    metadata = excluded.metadata,
    applied_at = now(),
    updated_at = now();
`);

const entityRows = sourceEntities.map(({ kind, dto, sortOrder }) => {
  const legacyId = dto.id ?? dto.slug;
  return [
    quote(databaseEntityType(kind)),
    quote(dto.slug),
    quote(titleFromEntity(kind, dto)),
    quote(descriptionFromEntity(kind, dto)),
    quote("published"),
    quote("public"),
    "true",
    quote(seedKey(kind, legacyId)),
    `(select id from hearthland.seed_batches where key = ${quote(BATCH_KEY)})`,
    json(platformMetadata(dto, sortOrder)),
    "now()",
    "null",
  ];
});

sql.push(`insert into hearthland.entities (
  entity_type, slug, title, short_description, publication_status, visibility,
  is_seeded_demo, seed_key, seed_batch_id, metadata, published_at, archived_at
)
values
${valuesBlock(entityRows)}
on conflict (seed_key) do update
set entity_type = excluded.entity_type,
    slug = excluded.slug,
    title = excluded.title,
    short_description = excluded.short_description,
    publication_status = excluded.publication_status,
    visibility = excluded.visibility,
    seed_batch_id = excluded.seed_batch_id,
    metadata = excluded.metadata,
    published_at = excluded.published_at,
    archived_at = null,
    updated_at = now()
where hearthland.entities.is_seeded_demo
  and hearthland.entities.seed_key = excluded.seed_key;
`);

const skillRows = skills.map((name) => [
  quote(inferSkillCategory(name)), quote(name), quote(slugify(name)), "true", "true", quote(skillSeedKey(name)),
]);
sql.push(`insert into hearthland.skills (category, name, slug, is_active, is_seeded_demo, seed_key)
values
${valuesBlock(skillRows)}
on conflict (seed_key) do update
set category = excluded.category,
    name = excluded.name,
    slug = excluded.slug,
    is_active = true,
    updated_at = now()
where hearthland.skills.is_seeded_demo
  and hearthland.skills.seed_key = excluded.seed_key;
`);

const valueRows = values.map((name) => [
  quote(name), quote(slugify(name)), "true", "true", quote(valueSeedKey(name)),
]);
sql.push(`insert into hearthland.values_catalog (name, slug, is_active, is_seeded_demo, seed_key)
values
${valuesBlock(valueRows)}
on conflict (seed_key) do update
set name = excluded.name,
    slug = excluded.slug,
    is_active = true,
    updated_at = now()
where hearthland.values_catalog.is_seeded_demo
  and hearthland.values_catalog.seed_key = excluded.seed_key;
`);

const personRows = people.map((person) => [
  entityId("person", person.id),
  "null",
  quote(person.name),
  quote(person.headline),
  quote(person.bio),
  textArray(person.languages),
  json([]),
  quote(relocationReadiness(person.availability)),
  quote(person.preferredCountries.length > 1 ? "multi_country" : "country_specific"),
  quote(person.family),
  quote(person.availability),
  String(person.completeness),
  "true",
  "true",
  textArray(person.lookingFor),
  textArray(person.skills),
  quote(""),
  "null",
]);
sql.push(`insert into hearthland.person_profiles (
  entity_id, account_id, display_name, headline, bio, languages, links,
  relocation_readiness, geographic_flexibility, family_situation, availability,
  profile_completeness, discoverable, allow_connection_requests, looking_for,
  can_contribute, contribution_note, archived_at
)
values
${valuesBlock(personRows)}
on conflict (entity_id) do update
set display_name = excluded.display_name,
    headline = excluded.headline,
    bio = excluded.bio,
    languages = excluded.languages,
    relocation_readiness = excluded.relocation_readiness,
    geographic_flexibility = excluded.geographic_flexibility,
    family_situation = excluded.family_situation,
    availability = excluded.availability,
    profile_completeness = excluded.profile_completeness,
    discoverable = excluded.discoverable,
    allow_connection_requests = excluded.allow_connection_requests,
    looking_for = excluded.looking_for,
    can_contribute = excluded.can_contribute,
    archived_at = null,
    updated_at = now();
`);

const profileLocationRows = people.map((person) => [
  entityId("person", person.id),
  quote(person.country),
  "null",
  quote(person.location.split(",")[0]?.trim() || null),
  quote("public"),
]);
sql.push(`insert into hearthland.profile_locations (profile_entity_id, country, region, city, visibility)
values
${valuesBlock(profileLocationRows)}
on conflict (profile_entity_id) do update
set country = excluded.country,
    region = excluded.region,
    city = excluded.city,
    visibility = excluded.visibility,
    updated_at = now();
`);

const preferenceRows = people.map((person) => [
  entityId("person", person.id),
  textArray(person.preferredCountries),
  "array[]::text[]",
  textArray(person.preferredTypes),
  textArray([...person.ecology, ...person.housing]),
  String(person.preferredSize[0]),
  String(person.preferredSize[1]),
  String(person.communalLife),
  quote(person.governance.join(", ")),
  quote(person.housing.join(", ")),
  String(person.economy),
  person.family === "Family" ? "true" : "false",
  json({ source: "curated-demo", sourceVisibility: "public" }),
]);
sql.push(`insert into hearthland.profile_preferences (
  profile_entity_id, preferred_countries, preferred_regions, desired_community_types,
  lifestyle_interests, community_size_min, community_size_max, communal_life_level,
  governance_preference, ownership_preference, economic_integration,
  family_friendly_required, privacy_preferences
)
values
${valuesBlock(preferenceRows)}
on conflict (profile_entity_id) do update
set preferred_countries = excluded.preferred_countries,
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
`);

const personSkillRows = people.flatMap((person) => person.skills.map((skill) => {
  const canTeach = teacherSkillsByName.get(person.name)?.has(skill) ?? false;
  return [
    entityId("person", person.id), skillId(skill), quote("intermediate"), "null",
    canTeach ? "true" : "false", canTeach ? "true" : "false", "false", "true",
  ];
}));
sql.push(`insert into hearthland.person_skills (
  profile_entity_id, skill_id, experience_level, years_experience, can_teach,
  practical_workshops, theoretical_sessions, willing_to_contribute
)
values
${valuesBlock(personSkillRows)}
on conflict (profile_entity_id, skill_id) do update
set experience_level = excluded.experience_level,
    can_teach = excluded.can_teach,
    practical_workshops = excluded.practical_workshops,
    willing_to_contribute = excluded.willing_to_contribute,
    updated_at = now();
`);

const profileValueRows = people.flatMap((person) => person.values.map((value) => [
  entityId("person", person.id), valueId(value),
]));
sql.push(`insert into hearthland.profile_values (profile_entity_id, value_id)
values
${valuesBlock(profileValueRows)}
on conflict (profile_entity_id, value_id) do nothing;
`);

const communityRows = communities.map((community) => [
  entityId("community", community.id),
  quote(`${community.description}\n\nMission: ${community.mission}`),
  quote(community.country),
  quote(community.region),
  "null", "null", "null",
  quote("approximate"),
  quote(community.type),
  quote("active"),
  String(community.residents),
  String(Number.parseInt(community.target, 10)),
  String(community.children),
  community.founded ? String(community.founded) : "null",
  community.accepting ? "true" : "false",
  quote(membershipStatus(community.membership)),
  quote(community.governance),
  quote(community.ownership),
  quote(`Integration level ${community.economy}/5`),
  community.familyFriendly ? "true" : "false",
  textArray(community.ecology),
  textArray(community.housing),
]);
sql.push(`insert into hearthland.communities (
  entity_id, full_description, country, region, nearest_city,
  approximate_latitude, approximate_longitude, location_visibility, community_type,
  lifecycle_status, residents, target_residents, children, founding_year,
  accepting_members, membership_status, governance_model, ownership_model,
  economic_model, family_friendly, ecology_practices, shared_spaces
)
values
${valuesBlock(communityRows)}
on conflict (entity_id) do update
set full_description = excluded.full_description,
    country = excluded.country,
    region = excluded.region,
    nearest_city = excluded.nearest_city,
    approximate_latitude = null,
    approximate_longitude = null,
    location_visibility = excluded.location_visibility,
    community_type = excluded.community_type,
    lifecycle_status = excluded.lifecycle_status,
    residents = excluded.residents,
    target_residents = excluded.target_residents,
    children = excluded.children,
    founding_year = excluded.founding_year,
    accepting_members = excluded.accepting_members,
    membership_status = excluded.membership_status,
    governance_model = excluded.governance_model,
    ownership_model = excluded.ownership_model,
    economic_model = excluded.economic_model,
    family_friendly = excluded.family_friendly,
    ecology_practices = excluded.ecology_practices,
    shared_spaces = excluded.shared_spaces,
    updated_at = now();
`);

const emergingRows = emergingCommunities.map((community) => {
  const [targetMin, targetMax] = parseRange(community.target);
  return [
    entityId("emerging", community.id),
    quote(community.mission),
    quote(community.country),
    quote(community.region),
    quote(community.type),
    quote(emergingStage(community.stage)),
    String(community.team ?? community.residents),
    targetMin === null ? "null" : String(targetMin),
    targetMax === null ? "null" : String(targetMax),
    quote(community.stage),
    textArray([...community.ecology, ...community.housing]),
    textArray(community.tags),
  ];
});
sql.push(`insert into hearthland.emerging_communities (
  entity_id, vision, target_country, target_region, community_type, stage,
  current_members, target_size_min, target_size_max, land_status,
  lifestyle_themes, current_assets
)
values
${valuesBlock(emergingRows)}
on conflict (entity_id) do update
set vision = excluded.vision,
    target_country = excluded.target_country,
    target_region = excluded.target_region,
    community_type = excluded.community_type,
    stage = excluded.stage,
    current_members = excluded.current_members,
    target_size_min = excluded.target_size_min,
    target_size_max = excluded.target_size_max,
    land_status = excluded.land_status,
    lifestyle_themes = excluded.lifestyle_themes,
    current_assets = excluded.current_assets,
    updated_at = now();
`);

const projectRows = projects.map((project) => [
  entityId("project", project.id),
  entityId("emerging", project.parentId),
  quote(project.nextMilestone),
  quote(projectStage(project.stage)),
  quote(project.countries[0] ?? null),
  quote(project.targetRegion),
  String(project.targetPopulation),
  String(parseHectares(project.landRequirement)),
  "null",
  quote(`Readiness ${project.readiness}%`),
  quote(project.nextMilestone),
  textArray(project.requiredSkills),
]);
sql.push(`insert into hearthland.settlement_projects (
  entity_id, emerging_community_entity_id, description, stage, target_country,
  target_region, target_population, land_requirement_ha, approximate_budget_eur,
  funding_status, next_milestone, current_priorities
)
values
${valuesBlock(projectRows)}
on conflict (entity_id) do update
set emerging_community_entity_id = excluded.emerging_community_entity_id,
    description = excluded.description,
    stage = excluded.stage,
    target_country = excluded.target_country,
    target_region = excluded.target_region,
    target_population = excluded.target_population,
    land_requirement_ha = excluded.land_requirement_ha,
    funding_status = excluded.funding_status,
    next_milestone = excluded.next_milestone,
    current_priorities = excluded.current_priorities,
    updated_at = now();
`);

const landRows = lands.map((land) => [
  entityId("land", land.id),
  quote(land.description),
  quote(land.country),
  quote(land.region),
  "null", "null", "null",
  quote(land.privacy.toLowerCase()),
  String(land.area),
  quote("ha"),
  land.price === null ? "null" : String(land.price),
  quote(land.price === null ? "on_request" : "public_exact"),
  "null",
  quote(listingStatus(land.status)),
  land.water ? "true" : "false",
  land.buildings ? "true" : "false",
  land.agricultural ? "true" : "false",
  "null",
  zoningKnown(land.zoning) === null ? "null" : zoningKnown(land.zoning) ? "true" : "false",
  quote(land.construction),
  textArray(land.infrastructure),
  quote(`Zoning: ${land.zoning}`),
  quote(land.collaboration.join(", ")),
]);
sql.push(`insert into hearthland.land_listings (
  entity_id, full_description, country, region, nearest_city,
  approximate_latitude, approximate_longitude, location_visibility,
  total_area, area_unit, price_eur, price_visibility, ownership_status,
  listing_status, has_water, has_buildings, agricultural, forest_area_ha,
  zoning_known, construction_status, infrastructure, planning_notes,
  collaboration_model
)
values
${valuesBlock(landRows)}
on conflict (entity_id) do update
set full_description = excluded.full_description,
    country = excluded.country,
    region = excluded.region,
    nearest_city = excluded.nearest_city,
    approximate_latitude = null,
    approximate_longitude = null,
    location_visibility = excluded.location_visibility,
    total_area = excluded.total_area,
    area_unit = excluded.area_unit,
    price_eur = excluded.price_eur,
    price_visibility = excluded.price_visibility,
    ownership_status = excluded.ownership_status,
    listing_status = excluded.listing_status,
    has_water = excluded.has_water,
    has_buildings = excluded.has_buildings,
    agricultural = excluded.agricultural,
    forest_area_ha = null,
    zoning_known = excluded.zoning_known,
    construction_status = excluded.construction_status,
    infrastructure = excluded.infrastructure,
    planning_notes = excluded.planning_notes,
    collaboration_model = excluded.collaboration_model,
    updated_at = now();
`);

const opportunityRows = opportunities.map((opportunity) => [
  entityId("opportunity", opportunity.id),
  entityId(opportunity.parentKind === "project" ? "project" : opportunity.parentKind, opportunity.parentId),
  quote(opportunity.type),
  quote(opportunity.description),
  quote(opportunity.country),
  quote(opportunity.location),
  opportunity.remote ? "true" : "false",
  "null",
  quote(opportunity.duration),
  quote(opportunity.category.toLowerCase()),
  quote(opportunity.compensation),
  opportunity.accommodation ? "true" : "false",
  opportunity.food ? "true" : "false",
  "1",
  dateValue(parseDateLabel(opportunity.deadline)),
  quote("open"),
  textArray(opportunity.skills),
]);
sql.push(`insert into hearthland.opportunities (
  entity_id, host_entity_id, opportunity_type, description, country, region,
  remote_possible, start_date, duration, compensation_type, compensation_details,
  accommodation_included, food_included, positions, deadline,
  application_status, required_skills
)
values
${valuesBlock(opportunityRows)}
on conflict (entity_id) do update
set host_entity_id = excluded.host_entity_id,
    opportunity_type = excluded.opportunity_type,
    description = excluded.description,
    country = excluded.country,
    region = excluded.region,
    remote_possible = excluded.remote_possible,
    start_date = excluded.start_date,
    duration = excluded.duration,
    compensation_type = excluded.compensation_type,
    compensation_details = excluded.compensation_details,
    accommodation_included = excluded.accommodation_included,
    food_included = excluded.food_included,
    positions = excluded.positions,
    deadline = excluded.deadline,
    application_status = excluded.application_status,
    required_skills = excluded.required_skills,
    updated_at = now();
`);

const learningRows = learningTopics.map((topic) => [
  entityId("learning", slugify(topic.title)), quote(topic.category), quote(topic.description),
]);
sql.push(`insert into hearthland.learning_topics (entity_id, category, description)
values
${valuesBlock(learningRows)}
on conflict (entity_id) do update
set category = excluded.category,
    description = excluded.description,
    updated_at = now();
`);

const campRows = buildingCamps.map((camp) => [
  entityId("camp", camp.id),
  entityId(camp.parentId.startsWith("c-") ? "community" : "emerging", camp.parentId),
  camp.projectId ? entityId("project", camp.projectId) : "null",
  quote(camp.location),
  quote(camp.country),
  "null",
  dateValue(camp.startDate),
  dateValue(camp.endDate),
  quote(camp.purpose.join(" · ")),
  quote(camp.description),
  String(camp.capacity),
  "null",
  "array[]::text[]",
  quote(camp.accommodation),
  quote(camp.food),
  quote(contributionType(camp.contribution)),
  quote(camp.contribution),
  textArray(camp.roles),
  quote(campStatus(camp.status)),
]);
sql.push(`insert into hearthland.building_camps (
  entity_id, host_entity_id, project_entity_id, location, country, region,
  start_date, end_date, purpose, full_description, max_participants,
  application_deadline, languages, accommodation_type, food_model,
  contribution_type, contribution_details, roles_available, camp_status
)
values
${valuesBlock(campRows)}
on conflict (entity_id) do update
set host_entity_id = excluded.host_entity_id,
    project_entity_id = excluded.project_entity_id,
    location = excluded.location,
    country = excluded.country,
    region = excluded.region,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    purpose = excluded.purpose,
    full_description = excluded.full_description,
    max_participants = excluded.max_participants,
    application_deadline = excluded.application_deadline,
    languages = excluded.languages,
    accommodation_type = excluded.accommodation_type,
    food_model = excluded.food_model,
    contribution_type = excluded.contribution_type,
    contribution_details = excluded.contribution_details,
    roles_available = excluded.roles_available,
    camp_status = excluded.camp_status,
    updated_at = now();
`);

const entityValueRows = [...communities.map((dto) => ({ kind: "community", dto })), ...emergingCommunities.map((dto) => ({ kind: "emerging", dto }))]
  .flatMap(({ kind, dto }) => dto.values.map((value) => [entityId(kind, dto.id), valueId(value)]));
sql.push(`insert into hearthland.entity_values (entity_id, value_id)
values
${valuesBlock(entityValueRows)}
on conflict (entity_id, value_id) do nothing;
`);

const skillNeedRows = [];
for (const { kind, dto } of [
  ...communities.map((dto) => ({ kind: "community", dto })),
  ...emergingCommunities.map((dto) => ({ kind: "emerging", dto })),
]) {
  for (const skill of dto.needs) {
    skillNeedRows.push([entityId(kind, dto.id), skillId(skill), quote("high"), quote("open"), quote("Curated directory need")]);
  }
}
for (const project of projects) {
  for (const skill of project.requiredSkills) {
    const available = project.availableSkills.includes(skill);
    skillNeedRows.push([
      entityId("project", project.id), skillId(skill), quote(available ? "low" : "high"),
      quote(available ? "fulfilled" : "open"), quote(available ? "Present in the current team" : "Open project capability need"),
    ]);
  }
}
for (const opportunity of opportunities) {
  for (const skill of opportunity.skills) {
    skillNeedRows.push([
      entityId("opportunity", opportunity.id), skillId(skill), quote("high"), quote("open"), quote("Required by the opportunity"),
    ]);
  }
}
sql.push(`insert into hearthland.entity_skill_needs (entity_id, skill_id, priority, status, notes)
values
${valuesBlock(skillNeedRows)}
on conflict (entity_id, skill_id) do update
set priority = excluded.priority,
    status = excluded.status,
    notes = excluded.notes,
    updated_at = now();
`);

const lifecycleOrder = ["Vision", "Core Team", "Community Model", "Location", "Land", "Legal", "Finance", "Planning", "Skills"];
const progressRows = projects.flatMap((project) => Object.entries(project.progress).map(([stage, status]) => [
  entityId("project", project.id), quote(stage), quote(projectProgressStatus(status)), quote(`Curated source status: ${status}`),
  String(Math.max(0, lifecycleOrder.indexOf(stage))),
]));
sql.push(`insert into hearthland.project_stage_progress (project_entity_id, stage, status, notes, sort_order)
values
${valuesBlock(progressRows)}
on conflict (project_entity_id, stage) do update
set status = excluded.status,
    notes = excluded.notes,
    sort_order = excluded.sort_order,
    updated_at = now();
`);

for (const camp of buildingCamps) {
  camp.builds.forEach((build, sortOrder) => {
    const [participantMin, participantMax] = parseRange(build.participants);
    const naturalMatch = `camp_entity_id = ${entityId("camp", camp.id)} and name = ${quote(build.title)} and sort_order = ${sortOrder}`;
    sql.push(`update hearthland.camp_build_items
set description = ${quote(`Lead: ${build.lead}`)},
    category = 'build',
    status = ${quote(buildStatus(build.status))},
    target_participants_min = ${participantMin ?? "null"},
    target_participants_max = ${participantMax ?? "null"},
    updated_at = now()
where ${naturalMatch};

insert into hearthland.camp_build_items (
  camp_entity_id, name, description, category, status,
  target_participants_min, target_participants_max, sort_order
)
select ${entityId("camp", camp.id)}, ${quote(build.title)}, ${quote(`Lead: ${build.lead}`)},
       'build', ${quote(buildStatus(build.status))}, ${participantMin ?? "null"}, ${participantMax ?? "null"}, ${sortOrder}
where not exists (
  select 1 from hearthland.camp_build_items where ${naturalMatch}
);
`);

    for (const skill of build.learning) {
      sql.push(`insert into hearthland.camp_build_item_skills (build_item_id, skill_id)
select build_item.id, ${skillId(skill)}
from hearthland.camp_build_items build_item
where build_item.camp_entity_id = ${entityId("camp", camp.id)}
  and build_item.name = ${quote(build.title)}
  and build_item.sort_order = ${sortOrder}
on conflict (build_item_id, skill_id) do nothing;
`);
    }
  });

  const learningSlugs = new Set(
    [...camp.learning, ...camp.communityLearning]
      .map(learningTopicFor)
      .filter(Boolean),
  );
  for (const topicSlug of [...learningSlugs].sort(compareText)) {
    sql.push(`insert into hearthland.camp_learning_topics (camp_entity_id, learning_topic_entity_id)
values (
  ${entityId("camp", camp.id)},
  ${entityId("learning", topicSlug)}
)
on conflict (camp_entity_id, learning_topic_entity_id) do nothing;
`);
  }

  camp.schedule.forEach((day, dayIndex) => {
    const declaredDay = Number(day.day.match(/Day\s+(\d+)/i)?.[1] ?? dayIndex + 1);
    const scheduledDate = addDays(camp.startDate, declaredDay - 1);
    day.items.forEach((item, itemIndex) => {
      const sortOrder = dayIndex * 100 + itemIndex;
      const naturalMatch = `camp_entity_id = ${entityId("camp", camp.id)} and scheduled_date = ${dateValue(scheduledDate)} and start_time = ${timeValue(item.time)} and title = ${quote(item.title)}`;
      sql.push(`update hearthland.camp_schedule_items
set item_type = ${quote(item.type)},
    sort_order = ${sortOrder},
    updated_at = now()
where ${naturalMatch};

insert into hearthland.camp_schedule_items (
  camp_entity_id, scheduled_date, start_time, title, item_type, sort_order
)
select ${entityId("camp", camp.id)}, ${dateValue(scheduledDate)}, ${timeValue(item.time)},
       ${quote(item.title)}, ${quote(item.type)}, ${sortOrder}
where not exists (
  select 1 from hearthland.camp_schedule_items where ${naturalMatch}
);
`);
    });
  });
}

sql.push(`-- Seed integrity assertions. A failure rolls back the complete seed transaction.
do $$
declare
  expected_entities integer := ${sourceEntities.length};
  actual_entities integer;
begin
  select count(*) into actual_entities
  from hearthland.entities
  where seed_batch_id = (select id from hearthland.seed_batches where key = ${quote(BATCH_KEY)})
    and is_seeded_demo;

  if actual_entities <> expected_entities then
    raise exception 'Hearthland curated seed expected % entities, found %', expected_entities, actual_entities;
  end if;

  if exists (
    select 1
    from hearthland.entities e
    where e.seed_batch_id = (select id from hearthland.seed_batches where key = ${quote(BATCH_KEY)})
      and e.metadata #>> '{platformDto,id}' is null
      and e.entity_type <> 'learning_topic'
  ) then
    raise exception 'A seeded Hearthland entity is missing its legacy platformDto.id';
  end if;

  if exists (
    select 1
    from hearthland.land_listings l
    join hearthland.entities e on e.id = l.entity_id
    where e.seed_batch_id = (select id from hearthland.seed_batches where key = ${quote(BATCH_KEY)})
      and (l.approximate_latitude is not null or l.approximate_longitude is not null)
  ) then
    raise exception 'UI map coordinates must never be seeded as geographic coordinates';
  end if;
end;
$$;

commit;

-- Generated counts: ${sourceEntities.length} entities, ${skills.length} skills, ${values.length} values,
-- ${personSkillRows.length} person-skill links, ${profileValueRows.length} person-value links,
-- ${entityValueRows.length} entity-value links, ${skillNeedRows.length} entity skill needs,
-- ${progressRows.length} project stage records.
`);

process.stdout.write(sql.join("\n"));
