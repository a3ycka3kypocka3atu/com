import type { User } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import { authEmail } from "../supabase/identity";
import {
  safeInternalTargetUrl,
  type DashboardTask,
  type LearningTopic,
  type PlatformData,
  type PlatformNotification,
  type PlatformViewer,
} from "../../app/platform-data";
import type {
  BuildingCamp,
  Community,
  Land,
  Opportunity,
  Person,
  Project,
  TeachableSkill,
  TeachingProfile,
} from "../../app/types";

const HEARTHLAND_SCHEMA = "hearthland";
const LIFECYCLE = [
  "Idea",
  "Team",
  "Model",
  "Land",
  "Legal",
  "Finance",
  "Plan",
  "Build",
  "Move",
  "Operate",
];

type JsonObject = Record<string, unknown>;

type EntityRow = {
  id: string;
  entity_type: string;
  slug: string;
  title: string;
  publication_status: string;
  visibility: string;
  owner_account_id: string | null;
  seed_key: string | null;
  metadata: JsonObject | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  target_url: string | null;
  read_at: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  linked_stage: string | null;
  assignee_account_id: string | null;
  due_date: string | null;
  status: string;
  priority: string;
};

type PlatformRoleRow = {
  role: string;
  revoked_at: string | null;
};

type EntityRoleRow = {
  role: string;
  status: string;
};

type TeachingProfileRow = {
  profile_entity_id: string;
  is_available: boolean;
  teaching_bio: string;
  teaching_formats: unknown;
  teaching_mode?: unknown;
  travel_scope?: unknown;
  selected_countries?: unknown;
  travel_regions: unknown;
  languages: unknown;
  availability?: string | null;
  compensation_preference?: string | null;
  professional_arrangements?: unknown;
  arrangement_notes?: unknown;
  portfolio_links?: unknown;
};

type PersonSkillRow = {
  id?: string;
  profile_entity_id: string;
  skill_id: string;
  experience_level: string;
  can_teach?: boolean;
  practical_workshops: boolean;
  theoretical_sessions: boolean;
};

type SkillRow = { id: string; name: string; category: string };

type TeachingTopicRow = {
  profile_entity_id: string;
  learning_topic_entity_id: string;
  teaching_type: string;
};

type TeachingDirectory = Map<string, TeachingProfile>;

type PilotProjectRow = {
  project_entity_id: string;
  pilot_status: Project["pilot"] extends infer T ? T extends { status: infer S } ? S : never : never;
  cohort: string | null;
  public_summary: string;
  launched_at: string | null;
};

type PilotDirectory = Map<string, NonNullable<Project["pilot"]>>;

type SettlementProjectRow = {
  entity_id: string;
  description: string;
  stage: string;
  target_country: string | null;
  target_region: string | null;
  target_population: number | null;
  land_requirement_ha: number | string | null;
  next_milestone: string | null;
  current_priorities: unknown;
};

type ProjectStageRow = {
  project_entity_id: string;
  stage: string;
  status: string;
  sort_order: number;
};

type ProjectMilestoneRow = {
  id: string;
  project_entity_id: string;
  title: string;
  description: string;
  target_date: string | null;
  completed_date: string | null;
  status: "future" | "active" | "completed" | "delayed";
};

type ProjectUpdateRow = {
  id: string;
  project_entity_id: string;
  title: string;
  body: string;
  published_at: string;
};

type NeedRow = {
  id: string;
  entity_id: string;
  title: string;
  category: string;
  description: string;
  urgency: string;
};

type EntitySkillNeedRow = {
  entity_id: string;
  skill_id: string;
};

type ProjectRuntime = {
  description: string;
  stage: string;
  targetCountry: string | null;
  targetRegion: string | null;
  targetPopulation: number | null;
  landRequirement: string | null;
  nextMilestone: string;
  currentPriorities: string[];
  readiness?: number;
  progress: Project["progress"];
  milestones: NonNullable<Project["milestones"]>;
  updates: NonNullable<Project["updates"]>;
  needs: NonNullable<Project["needs"]>;
  requiredSkills: string[];
};

type ProjectDirectory = Map<string, ProjectRuntime>;

type CampResultRow = {
  camp_entity_id: string;
  what_we_built: string;
  what_we_learned: string;
  main_results: string;
  what_happens_next: string;
  participants_count: number;
  masters_count: number;
  workshops_count: number;
  duration_days: number;
  published_at: string;
};

type CampResultBuildRow = {
  id: string;
  camp_entity_id: string;
  name: string;
  description: string;
  sort_order: number;
};

type CampResultMediaLinkRow = {
  build_item_id: string;
  media_asset_id: string;
  sort_order: number;
};

type CampResultMediaAssetRow = {
  id: string;
  object_path: string;
  alt_text: string;
  sort_order: number;
};

type CampResultDirectory = Map<string, NonNullable<BuildingCamp["result"]>>;

export class PlatformRepositoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlatformRepositoryError";
  }
}

/**
 * Loads the complete serializable boundary consumed by the client platform.
 * Both curated records and user-created records travel through the same
 * `hearthland.entities` query and metadata-to-DTO conversion.
 */
export async function loadPlatformData(): Promise<PlatformData> {
  if (hasRenderedFixtureTestEnvironment()) {
    return loadPreviewFixture();
  }

  if (!hasSupabaseEnvironment()) {
    return loadDevelopmentFallback(
      new PlatformRepositoryError("Supabase environment variables are missing."),
    );
  }

  try {
    const supabase = await createClient();
    const claimsResult = await supabase.auth.getClaims();
    const user = claimsResult.data?.claims?.sub
      ? ({
          id: claimsResult.data.claims.sub,
          email: authEmail(claimsResult.data.claims.email) ?? undefined,
          app_metadata: isJsonObject(claimsResult.data.claims.app_metadata)
            ? claimsResult.data.claims.app_metadata
            : {},
          user_metadata: isJsonObject(claimsResult.data.claims.user_metadata)
            ? claimsResult.data.claims.user_metadata
            : {},
        } as User)
      : null;

    const entitiesResult = await supabase
      .schema(HEARTHLAND_SCHEMA)
      .from("entities")
      .select(
        "id, entity_type, slug, title, publication_status, visibility, owner_account_id, seed_key, metadata, created_at",
      )
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("slug", { ascending: true });

    if (entitiesResult.error) {
      throw new PlatformRepositoryError(
        `Hearthland entities could not be loaded: ${entitiesResult.error.message}`,
        { cause: entitiesResult.error },
      );
    }

    const visibleRows = (entitiesResult.data ?? []) as EntityRow[];
    const publishedRows = visibleRows.filter(
      (row) => row.publication_status === "published",
    );

    if (publishedRows.length === 0) {
      throw new PlatformRepositoryError(
        "Hearthland has no published entities. Apply the curated seed migration before serving the platform.",
      );
    }

    const [pilotDirectory, projectDirectory, campResultDirectory] = await Promise.all([
      loadPilotDirectory(supabase),
      loadProjectDirectory(supabase),
      loadCampResultDirectory(supabase),
    ]);
    const [viewerState, notifications, dashboardTasks, avatarUrls, teachingDirectory] = user
      ? await Promise.all([
          loadViewerState(supabase, user),
          loadNotifications(supabase, user.id),
          loadDashboardTasks(supabase, user.id),
          loadVisibleAvatarUrls(supabase),
          loadTeachingDirectory(supabase, visibleRows),
        ])
      : [
          anonymousViewer(),
          [],
          [],
          await loadVisibleAvatarUrls(supabase),
          await loadTeachingDirectory(supabase, visibleRows),
        ];

    return assemblePlatformData({
      visibleRows,
      user,
      viewer: viewerState,
      notifications,
      dashboardTasks,
      avatarUrls,
      teachingDirectory,
      pilotDirectory,
      projectDirectory,
      campResultDirectory,
    });
  } catch (error) {
    return loadDevelopmentFallback(error);
  }
}

async function loadCampResultDirectory(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<CampResultDirectory> {
  const hearthland = supabase.schema(HEARTHLAND_SCHEMA);
  const [resultsResult, completedCampsResult, completedBuildsResult] = await Promise.all([
    hearthland
      .from("camp_results")
      .select("camp_entity_id, what_we_built, what_we_learned, main_results, what_happens_next, participants_count, masters_count, workshops_count, duration_days, published_at")
      .eq("publication_status", "published")
      .not("published_at", "is", null),
    hearthland
      .from("building_camps")
      .select("entity_id")
      .eq("camp_status", "completed"),
    hearthland
      .from("camp_build_items")
      .select("id, camp_entity_id, name, description, sort_order")
      .eq("status", "completed")
      .order("sort_order"),
  ]);

  if (resultsResult.error || completedCampsResult.error || completedBuildsResult.error) return new Map();

  const completedIds = new Set(
    (completedCampsResult.data ?? []).flatMap((row) =>
      typeof row.entity_id === "string" ? [row.entity_id] : [],
    ),
  );

  const completedBuilds = ((completedBuildsResult.data ?? []) as CampResultBuildRow[])
    .filter((row) => completedIds.has(row.camp_entity_id));
  const buildIds = completedBuilds.map((row) => row.id);
  const linksResult = buildIds.length
    ? await hearthland
        .from("camp_build_item_media")
        .select("build_item_id, media_asset_id, sort_order")
        .in("build_item_id", buildIds)
        .order("sort_order")
    : { data: [], error: null };
  if (linksResult.error) return new Map();

  const links = (linksResult.data ?? []) as CampResultMediaLinkRow[];
  const mediaIds = Array.from(new Set(links.map((link) => link.media_asset_id)));
  const assetsResult = mediaIds.length
    ? await hearthland
        .from("media_assets")
        .select("id, object_path, alt_text, sort_order")
        .in("id", mediaIds)
        .eq("bucket_id", "hearthland-entity-media")
        .eq("media_kind", "image")
        .eq("visibility", "public")
        .is("archived_at", null)
        .order("sort_order")
    : { data: [], error: null };
  if (assetsResult.error) return new Map();

  const assets = (assetsResult.data ?? []) as CampResultMediaAssetRow[];
  const signedResult = assets.length
    ? await supabase.storage
        .from("hearthland-entity-media")
        .createSignedUrls(assets.map((asset) => asset.object_path), 3600)
    : { data: [], error: null };
  if (signedResult.error) return new Map();
  const signedByPath = new Map(
    (signedResult.data ?? []).flatMap((item) =>
      item.signedUrl ? [[item.path, item.signedUrl] as const] : [],
    ),
  );
  const mediaById = new Map(assets.flatMap((asset) => {
    const url = signedByPath.get(asset.object_path);
    return url ? [[asset.id, { url, alt: asset.alt_text }] as const] : [];
  }));
  const linksByBuild = new Map<string, Array<{ url: string; alt: string }>>();
  for (const link of links) {
    const media = mediaById.get(link.media_asset_id);
    if (!media) continue;
    linksByBuild.set(link.build_item_id, [
      ...(linksByBuild.get(link.build_item_id) ?? []),
      media,
    ]);
  }
  const structuresByCamp = new Map<string, NonNullable<BuildingCamp["result"]>["structures"]>();
  for (const build of completedBuilds) {
    structuresByCamp.set(build.camp_entity_id, [
      ...(structuresByCamp.get(build.camp_entity_id) ?? []),
      {
        id: build.id,
        title: build.name,
        description: build.description,
        images: linksByBuild.get(build.id) ?? [],
      },
    ]);
  }

  return new Map(
    ((resultsResult.data ?? []) as CampResultRow[])
      .filter((row) => completedIds.has(row.camp_entity_id))
      .map((row) => {
        const structures = structuresByCamp.get(row.camp_entity_id) ?? [];
        return [row.camp_entity_id, {
          participants: finiteNumber(row.participants_count, 0),
          masters: finiteNumber(row.masters_count, 0),
          workshops: finiteNumber(row.workshops_count, 0),
          durationDays: finiteNumber(row.duration_days, 0),
          whatWeBuilt: stringValue(row.what_we_built, ""),
          whatWeLearned: stringValue(row.what_we_learned, ""),
          mainResults: stringValue(row.main_results, ""),
          whatHappensNext: stringValue(row.what_happens_next, ""),
          publishedAt: row.published_at,
          structures,
          images: structures.flatMap((structure) => structure.images),
        }] as const;
      }),
  );
}

async function loadProjectDirectory(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ProjectDirectory> {
  const hearthland = supabase.schema(HEARTHLAND_SCHEMA);
  const [
    projectsResult,
    stagesResult,
    milestonesResult,
    updatesResult,
    needsResult,
    skillNeedsResult,
    skillsResult,
  ] = await Promise.all([
    hearthland
      .from("settlement_projects")
      .select("entity_id, description, stage, target_country, target_region, target_population, land_requirement_ha, next_milestone, current_priorities"),
    hearthland
      .from("project_stage_progress")
      .select("project_entity_id, stage, status, sort_order")
      .order("sort_order", { ascending: true }),
    hearthland
      .from("project_milestones")
      .select("id, project_entity_id, title, description, target_date, completed_date, status")
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    hearthland
      .from("project_updates")
      .select("id, project_entity_id, title, body, published_at")
      .eq("publication_status", "published")
      .is("archived_at", null)
      .order("published_at", { ascending: false }),
    hearthland
      .from("needs")
      .select("id, entity_id, title, category, description, urgency")
      .in("status", ["open", "discussion"])
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    hearthland
      .from("entity_skill_needs")
      .select("entity_id, skill_id")
      .in("status", ["open", "discussion"]),
    hearthland
      .from("skills")
      .select("id, name, category")
      .eq("is_active", true),
  ]);

  if (projectsResult.error) return new Map();

  const stageRows = stagesResult.error
    ? []
    : (stagesResult.data ?? []) as ProjectStageRow[];
  const milestoneRows = milestonesResult.error
    ? []
    : (milestonesResult.data ?? []) as ProjectMilestoneRow[];
  const updateRows = updatesResult.error
    ? []
    : (updatesResult.data ?? []) as ProjectUpdateRow[];
  const needRows = needsResult.error
    ? []
    : (needsResult.data ?? []) as NeedRow[];
  const skillNeedRows = skillNeedsResult.error
    ? []
    : (skillNeedsResult.data ?? []) as EntitySkillNeedRow[];
  const skillById = new Map(
    skillsResult.error
      ? []
      : ((skillsResult.data ?? []) as SkillRow[]).map((row) => [row.id, row.name] as const),
  );

  return new Map(
    ((projectsResult.data ?? []) as SettlementProjectRow[]).map((row) => {
      const projectStages = stageRows.filter((stage) => stage.project_entity_id === row.entity_id);
      const progress = Object.fromEntries(
        projectStages.map((stage) => [humaniseDatabaseLabel(stage.stage), projectProgressStatus(stage.status)]),
      ) as Project["progress"];
      const readiness = projectStages.length
        ? Math.round(
            projectStages.reduce((total, stage) => total + projectProgressWeight(stage.status), 0)
              / projectStages.length
              * 100,
          )
        : undefined;
      const requiredSkills = skillNeedRows
        .filter((need) => need.entity_id === row.entity_id)
        .flatMap((need) => {
          const skill = skillById.get(need.skill_id);
          return skill ? [skill] : [];
        });

      return [
        row.entity_id,
        {
          description: row.description,
          stage: humaniseDatabaseLabel(row.stage),
          targetCountry: row.target_country,
          targetRegion: row.target_region,
          targetPopulation: row.target_population,
          landRequirement:
            row.land_requirement_ha === null
              ? null
              : `${Number(row.land_requirement_ha).toLocaleString("en")} ha`,
          nextMilestone: row.next_milestone ?? "",
          currentPriorities: stringArray(row.current_priorities),
          readiness,
          progress,
          milestones: milestoneRows
            .filter((milestone) => milestone.project_entity_id === row.entity_id)
            .map((milestone) => ({
              id: milestone.id,
              title: milestone.title,
              description: milestone.description,
              targetDate: milestone.target_date,
              completedDate: milestone.completed_date,
              status: milestone.status,
            })),
          updates: updateRows
            .filter((update) => update.project_entity_id === row.entity_id)
            .map((update) => ({
              id: update.id,
              title: update.title,
              body: update.body,
              publishedAt: update.published_at,
            })),
          needs: needRows
            .filter((need) => need.entity_id === row.entity_id)
            .map((need) => ({
              id: need.id,
              title: need.title,
              category: humaniseDatabaseLabel(need.category),
              description: need.description,
              urgency: humaniseDatabaseLabel(need.urgency),
            })),
          requiredSkills,
        },
      ] as const;
    }),
  );
}

async function loadPilotDirectory(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<PilotDirectory> {
  const result = await supabase
    .schema(HEARTHLAND_SCHEMA)
    .from("pilot_projects")
    .select("project_entity_id, pilot_status, cohort, public_summary, launched_at");
  if (result.error) return new Map();
  return new Map(((result.data ?? []) as PilotProjectRow[]).map((row) => [
    row.project_entity_id,
    {
      status: row.pilot_status,
      cohort: row.cohort ?? "",
      publicSummary: row.public_summary,
      launchedAt: row.launched_at,
    },
  ]));
}

async function loadVisibleAvatarUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const assets = await supabase
    .schema(HEARTHLAND_SCHEMA)
    .from("media_assets")
    .select("profile_entity_id, object_path")
    .eq("category", "avatar")
    .is("archived_at", null);
  if (assets.error || !assets.data?.length) return new Map<string, string>();

  const paths = assets.data
    .map((asset) => asset.object_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  if (!paths.length) return new Map<string, string>();

  const signed = await supabase.storage
    .from("hearthland-avatars")
    .createSignedUrls(paths, 3600);
  if (signed.error) return new Map<string, string>();
  const signedByPath = new Map(
    (signed.data ?? []).flatMap((item) =>
      item.signedUrl ? [[item.path, item.signedUrl] as const] : [],
    ),
  );

  return new Map(
    assets.data.flatMap((asset) => {
      const url = signedByPath.get(asset.object_path);
      return url && asset.profile_entity_id
        ? [[asset.profile_entity_id as string, url] as const]
        : [];
    }),
  );
}

async function loadTeachingDirectory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  visibleRows: EntityRow[],
): Promise<TeachingDirectory> {
  const hearthland = supabase.schema(HEARTHLAND_SCHEMA);
  const [
    publicTeachingResult,
    privateTeachingResult,
    publicPersonSkillsResult,
    privatePersonSkillsResult,
    skillsResult,
    publicTopicLinksResult,
    privateTopicLinksResult,
  ] = await Promise.all([
    hearthland.rpc("get_public_teaching_profiles"),
    hearthland
      .from("teaching_profiles")
      .select("profile_entity_id, is_available, teaching_bio, teaching_formats, teaching_mode, travel_scope, selected_countries, travel_regions, languages, availability, compensation_preference, professional_arrangements, arrangement_notes, portfolio_links"),
    hearthland
      .rpc("get_public_person_skills"),
    hearthland
      .from("person_skills")
      .select("id, profile_entity_id, skill_id, experience_level, can_teach, practical_workshops, theoretical_sessions"),
    hearthland
      .from("skills")
      .select("id, name, category")
      .eq("is_active", true),
    hearthland.rpc("get_public_teaching_topics"),
    hearthland
      .from("profile_teaching_topics")
      .select("profile_entity_id, learning_topic_entity_id, teaching_type"),
  ]);

  let teachingRows: TeachingProfileRow[];
  if (!publicTeachingResult.error) {
    const rowsByProfile = new Map(
      ((publicTeachingResult.data ?? []) as TeachingProfileRow[]).map((row) => [
        row.profile_entity_id,
        row,
      ]),
    );
    if (!privateTeachingResult.error) {
      for (const row of (privateTeachingResult.data ?? []) as TeachingProfileRow[]) {
        rowsByProfile.set(row.profile_entity_id, row);
      }
    }
    teachingRows = [...rowsByProfile.values()];
  } else {
    // This keeps the additive rollout readable until the sanitized RPC exists.
    const legacyResult = await hearthland
      .from("teaching_profiles")
      .select("profile_entity_id, is_available, teaching_bio, teaching_formats, travel_regions, languages, availability, compensation_preference, portfolio_links");
    teachingRows = legacyResult.error
      ? []
      : (legacyResult.data ?? []) as TeachingProfileRow[];
  }

  const skillById = new Map(
    skillsResult.error
      ? []
      : ((skillsResult.data ?? []) as SkillRow[]).map((skill) => [skill.id, skill] as const),
  );
  const teachableByProfile = new Map<string, TeachableSkill[]>();
  const personSkillsByKey = new Map<string, PersonSkillRow>();
  if (!publicPersonSkillsResult.error) {
    for (const row of (publicPersonSkillsResult.data ?? []) as PersonSkillRow[]) {
      personSkillsByKey.set(row.id ?? `${row.profile_entity_id}:${row.skill_id}`, row);
    }
  }
  if (!privatePersonSkillsResult.error) {
    for (const row of (privatePersonSkillsResult.data ?? []) as PersonSkillRow[]) {
      personSkillsByKey.set(row.id ?? `${row.profile_entity_id}:${row.skill_id}`, row);
    }
  }
  for (const row of personSkillsByKey.values()) {
      if (row.can_teach !== true) continue;
      const skill = skillById.get(row.skill_id);
      if (!skill) continue;
      const list = teachableByProfile.get(row.profile_entity_id) ?? [];
      list.push({
        name: skill.name,
        category: skill.category,
        experienceLevel: experienceLevel(row.experience_level),
        practicalWorkshops: row.practical_workshops === true,
        theoreticalSessions: row.theoretical_sessions === true,
      });
      teachableByProfile.set(row.profile_entity_id, list);
  }

  const topicTitleById = new Map(
    visibleRows
      .filter((row) => row.entity_type === "learning_topic")
      .map((row) => [row.id, row.title] as const),
  );
  const topicsByProfile = new Map<string, TeachingProfile["topics"]>();
  const topicRowsByKey = new Map<string, TeachingTopicRow>();
  if (!publicTopicLinksResult.error) {
    for (const row of (publicTopicLinksResult.data ?? []) as TeachingTopicRow[]) {
      topicRowsByKey.set(`${row.profile_entity_id}:${row.learning_topic_entity_id}`, row);
    }
  }
  if (!privateTopicLinksResult.error) {
    for (const row of (privateTopicLinksResult.data ?? []) as TeachingTopicRow[]) {
      topicRowsByKey.set(`${row.profile_entity_id}:${row.learning_topic_entity_id}`, row);
    }
  }
  for (const row of topicRowsByKey.values()) {
      const title = topicTitleById.get(row.learning_topic_entity_id);
      if (!title) continue;
      const list = topicsByProfile.get(row.profile_entity_id) ?? [];
      list.push({
        id: row.learning_topic_entity_id,
        title,
        teachingType: teachingType(row.teaching_type),
      });
      topicsByProfile.set(row.profile_entity_id, list);
  }

  const rowByProfile = new Map(teachingRows.map((row) => [row.profile_entity_id, row]));
  // A `can_teach` skill alone is not consent to public Master discovery. Only
  // profiles returned by the sanitized public projection (or their authorised
  // owner/staff base-table read) become directory entries.
  const profileIds = new Set(rowByProfile.keys());
  const directory: TeachingDirectory = new Map();
  for (const profileEntityId of profileIds) {
    const row = rowByProfile.get(profileEntityId);
    const skills = teachableByProfile.get(profileEntityId) ?? [];
    const mode = teachingType(row?.teaching_mode);
    const skillFormats = skills.flatMap((skill) => [
      ...(skill.practicalWorkshops ? ["Practical workshops"] : []),
      ...(skill.theoreticalSessions ? ["Theoretical sessions"] : []),
    ]);
    const formats = Array.from(new Set([
      ...stringArray(row?.teaching_formats),
      ...skillFormats,
      ...(skillFormats.length === 0
        ? [mode === "practical" ? "Practical workshops" : mode === "theoretical" ? "Theoretical sessions" : "Practical and theoretical"]
        : []),
    ]));
    const professionalArrangements = stringArray(row?.professional_arrangements);
    directory.set(profileEntityId, {
      isAvailable: row?.is_available === true,
      bio: stringValue(row?.teaching_bio, ""),
      teachingMode: mode,
      formats,
      travelScope: travelScope(row?.travel_scope),
      selectedCountries: stringArray(row?.selected_countries),
      travelRegions: stringArray(row?.travel_regions),
      languages: stringArray(row?.languages),
      availability: stringValue(row?.availability, ""),
      compensationPreference: professionalArrangements.length
        ? professionalArrangements.map(humanise).join(" · ")
        : stringValue(row?.compensation_preference, ""),
      professionalArrangements,
      arrangementNotes: stringValue(row?.arrangement_notes, ""),
      portfolioLinks: stringArray(row?.portfolio_links),
      skills,
      topics: topicsByProfile.get(profileEntityId) ?? [],
    });
  }
  return directory;
}

async function loadViewerState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User,
): Promise<PlatformViewer> {
  const [platformRoles, entityRoles] = await Promise.all([
    supabase
      .schema(HEARTHLAND_SCHEMA)
      .from("platform_roles")
      .select("role, revoked_at")
      .eq("account_id", user.id)
      .is("revoked_at", null),
    supabase
      .schema(HEARTHLAND_SCHEMA)
      .from("entity_roles")
      .select("role, status")
      .eq("account_id", user.id)
      .eq("status", "active"),
  ]);

  const activePlatformRoles = platformRoles.error
    ? []
    : ((platformRoles.data ?? []) as PlatformRoleRow[]);
  const activeEntityRoles = entityRoles.error
    ? []
    : ((entityRoles.data ?? []) as EntityRoleRow[]);

  const role: PlatformViewer["role"] = activePlatformRoles.some(
    (entry) => entry.role === "admin" && entry.revoked_at === null,
  )
    ? "administrator"
    : activeEntityRoles.some(
          (entry) =>
            entry.status === "active" &&
            (entry.role === "owner" || entry.role === "administrator"),
        )
      ? "manager"
      : "member";

  return {
    status: "authenticated",
    userId: user.id,
    email: user.email ?? null,
    role,
  };
}

async function loadNotifications(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
): Promise<PlatformNotification[]> {
  const result = await supabase
    .schema(HEARTHLAND_SCHEMA)
    .from("notifications")
    .select("id, title, body, target_url, read_at, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (result.error) return [];

  return ((result.data ?? []) as NotificationRow[]).map((row) => {
    const targetUrl = safeInternalTargetUrl(row.target_url);
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      time: relativeTime(row.created_at),
      unread: row.read_at === null,
      ...(targetUrl ? { targetUrl } : {}),
    };
  });
}

async function loadDashboardTasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
): Promise<DashboardTask[]> {
  // RLS limits this unscoped-looking query to tasks assigned to the viewer or
  // workspaces the viewer manages. Keeping that rule in Postgres avoids a
  // second authorization model in application code.
  const result = await supabase
    .schema(HEARTHLAND_SCHEMA)
    .from("tasks")
    .select(
      "id, title, linked_stage, assignee_account_id, due_date, status, priority",
    )
    .is("archived_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true })
    .limit(40);

  if (result.error) return [];

  return ((result.data ?? []) as TaskRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    stage: row.linked_stage ?? "General",
    assignee:
      row.assignee_account_id === accountId
        ? "You"
        : row.assignee_account_id
          ? "Team member"
          : "Unassigned",
    due: formatDueDate(row.due_date),
    status: row.status,
    priority: row.priority,
  }));
}

function assemblePlatformData({
  visibleRows,
  user,
  viewer,
  notifications,
  dashboardTasks,
  avatarUrls,
  teachingDirectory,
  pilotDirectory,
  projectDirectory,
  campResultDirectory,
}: {
  visibleRows: EntityRow[];
  user: User | null;
  viewer: PlatformViewer;
  notifications: PlatformNotification[];
  dashboardTasks: DashboardTask[];
  avatarUrls: Map<string, string>;
  teachingDirectory: TeachingDirectory;
  pilotDirectory: PilotDirectory;
  projectDirectory: ProjectDirectory;
  campResultDirectory: CampResultDirectory;
}): PlatformData {
  const identities = buildIdentityMap(visibleRows);
  const surfacedRows = visibleRows.filter(
    (row) =>
      row.publication_status === "published"
      || Boolean(user && row.owner_account_id === user.id),
  );
  const surfacedRowsOfType = (entityType: string) =>
    rowsOfType(surfacedRows, entityType).sort(
      (left, right) =>
        Number(Boolean(user && right.owner_account_id === user.id))
        - Number(Boolean(user && left.owner_account_id === user.id)),
    );

  const people = surfacedRowsOfType("person_profile")
    .filter(
      (row) =>
        row.owner_account_id === user?.id
        || platformPayload(row.metadata).discoverable !== false,
    )
    .map((row) => normalizePerson(row, avatarUrls, teachingDirectory));
  const communities = surfacedRowsOfType("community").map((row) =>
    normalizeCommunity(row, "community"),
  );
  const emergingCommunities = surfacedRowsOfType("emerging_community")
    .map((row) => normalizeCommunity(row, "emerging"));
  const lands = surfacedRowsOfType("land_listing").map((row) =>
    normalizeDto<Land>(row),
  );
  const projects = surfacedRowsOfType("settlement_project").map((row) => {
    const base = normalizeRelationshipDto<Project>(row, identities, ["parentId"]);
    const runtime = projectDirectory.get(row.id);
    return {
      ...base,
      ...(runtime
        ? {
            description: runtime.description || base.description,
            stage: runtime.stage || base.stage,
            countries: runtime.targetCountry ? [runtime.targetCountry] : base.countries,
            targetRegion: runtime.targetRegion || base.targetRegion,
            targetPopulation: runtime.targetPopulation ?? base.targetPopulation,
            landRequirement: runtime.landRequirement || base.landRequirement,
            nextMilestone: runtime.nextMilestone || base.nextMilestone,
            currentPriorities: runtime.currentPriorities,
            readiness: runtime.readiness ?? base.readiness,
            progress:
              Object.keys(runtime.progress).length > 0
                ? runtime.progress
                : base.progress,
            milestones: runtime.milestones,
            updates: runtime.updates,
            needs: runtime.needs,
            openNeeds:
              runtime.needs.length > 0 ? runtime.needs.length : base.openNeeds,
            requiredSkills:
              runtime.requiredSkills.length > 0
                ? runtime.requiredSkills
                : base.requiredSkills,
          }
        : {}),
      ...(pilotDirectory.has(row.id) ? { pilot: pilotDirectory.get(row.id) } : {}),
    };
  });
  const opportunities = surfacedRowsOfType("opportunity").map((row) =>
    normalizeRelationshipDto<Opportunity>(row, identities, ["parentId"]),
  );
  const buildingCamps = surfacedRowsOfType("building_camp").map((row) => ({
    ...normalizeRelationshipDto<BuildingCamp>(row, identities, [
      "parentId",
      "projectId",
    ]),
    // Public result claims come exclusively from a published camp_results
    // snapshot for a completed Camp. Metadata fixtures never become results.
    result: campResultDirectory.get(row.id),
  }));
  const learningTopics = surfacedRowsOfType("learning_topic").map(
    (row) => normalizeLearningTopic(row),
  );

  const ownedProfileRow = user
    ? visibleRows.find(
        (row) =>
          row.entity_type === "person_profile" &&
          row.owner_account_id === user.id,
      )
    : undefined;
  const ownedProfile = ownedProfileRow
    ? normalizePerson(ownedProfileRow, avatarUrls, teachingDirectory)
    : null;
  const directoryCurrentPerson =
    people.find((person) => person.slug === "mira-novak") ?? people[0];
  const currentPerson =
    ownedProfile ??
    (user ? createPreOnboardingPerson(user) : directoryCurrentPerson);

  if (!currentPerson) {
    throw new PlatformRepositoryError(
      "Hearthland requires at least one published person profile.",
    );
  }

  return {
    currentPerson,
    people,
    communities,
    emergingCommunities,
    lands,
    projects,
    opportunities,
    buildingCamps,
    learningTopics,
    dashboardTasks,
    notificationsSeed: notifications,
    lifecycle: LIFECYCLE,
    viewer,
  };
}

function rowsOfType(rows: EntityRow[], entityType: string) {
  return rows
    .filter((row) => row.entity_type === entityType)
    .sort((left, right) => entityOrder(left) - entityOrder(right));
}

function normalizeDto<T extends { id: string; slug: string }>(row: EntityRow): T {
  const payload = platformPayload(row.metadata);
  return {
    ...payload,
    id: row.id,
    slug: row.slug,
  } as T;
}

function normalizeRelationshipDto<T extends { id: string; slug: string }>(
  row: EntityRow,
  identities: Map<string, string>,
  relationshipFields: string[],
): T {
  const normalized = normalizeDto<T>(row);
  const mutable = normalized as unknown as JsonObject;
  for (const field of relationshipFields) {
    const legacyValue = mutable[field];
    if (typeof legacyValue === "string") {
      mutable[field] = identities.get(legacyValue) ?? legacyValue;
    }
  }
  return normalized;
}

function normalizePerson(
  row: EntityRow,
  avatarUrls: Map<string, string>,
  teachingDirectory: TeachingDirectory,
): Person {
  const payload = platformPayload(row.metadata);
  const preferredSize = Array.isArray(payload.preferredSize)
    ? payload.preferredSize
    : null;

  const teaching = teachingDirectory.get(row.id);

  return {
    id: row.id,
    slug: row.slug,
    name: stringValue(payload.name, row.title),
    avatar: avatarUrls.get(row.id) || stringValue(payload.avatar, "https://i.pravatar.cc/240?img=1"),
    headline: stringValue(payload.headline, "New Hearthland member"),
    location: stringValue(payload.location, ""),
    country: stringValue(payload.country, ""),
    languages: stringArray(payload.languages),
    skills: stringArray(payload.skills),
    skillCategories: stringArray(payload.skillCategories),
    values: stringArray(payload.values),
    lookingFor: stringArray(payload.lookingFor),
    preferredCountries: stringArray(payload.preferredCountries),
    preferredTypes: stringArray(payload.preferredTypes),
    preferredSize:
      preferredSize?.length === 2 &&
      typeof preferredSize[0] === "number" &&
      typeof preferredSize[1] === "number"
        ? [preferredSize[0], preferredSize[1]]
        : [1, 200],
    governance: stringArray(payload.governance),
    housing: stringArray(payload.housing),
    ecology: stringArray(payload.ecology),
    economy: finiteNumber(payload.economy, 3),
    communalLife: finiteNumber(payload.communalLife, 3),
    family: stringValue(payload.family, ""),
    availability: stringValue(payload.availability, "Exploring"),
    completeness: finiteNumber(payload.completeness, 0),
    bio: stringValue(payload.bio, ""),
    canContribute: stringArray(payload.canContribute),
    contributionNote: stringValue(payload.contributionNote, ""),
    isMemberProfile: Boolean(row.owner_account_id),
    teaching: teaching
      ? {
          ...teaching,
          languages: teaching.languages.length
            ? teaching.languages
            : stringArray(payload.languages),
          availability:
            teaching.availability || stringValue(payload.availability, ""),
        }
      : undefined,
  };
}

function normalizeCommunity(
  row: EntityRow,
  kind: Community["kind"],
): Community {
  return {
    ...normalizeDto<Community>(row),
    kind,
  };
}

function normalizeLearningTopic(row: EntityRow): LearningTopic {
  const payload = platformPayload(row.metadata);
  return {
    id: row.id,
    slug: row.slug,
    category: stringValue(payload.category, "General"),
    title: stringValue(payload.title, row.title),
    description: stringValue(payload.description, ""),
  };
}

function buildIdentityMap(rows: EntityRow[]) {
  const identities = new Map<string, string>();
  for (const row of rows) {
    identities.set(row.id, row.id);
    identities.set(row.slug, row.id);
    if (row.seed_key) {
      identities.set(row.seed_key, row.id);
      const unqualifiedSeedKey = row.seed_key.split(":").at(-1);
      if (unqualifiedSeedKey) identities.set(unqualifiedSeedKey, row.id);
    }
    const payload = platformPayload(row.metadata);
    if (typeof payload.id === "string") identities.set(payload.id, row.id);
  }
  return identities;
}

function platformPayload(metadata: JsonObject | null): JsonObject {
  if (!metadata) return {};
  for (const key of ["platformDto", "platform_data", "dto", "payload"]) {
    const nested = metadata[key];
    if (isJsonObject(nested)) return nested;
  }
  return metadata;
}

function entityOrder(row: EntityRow) {
  const metadata = row.metadata;
  const order = metadata?.sortOrder ?? metadata?.sort_order ?? metadata?._order;
  return typeof order === "number" && Number.isFinite(order)
    ? order
    : Number.MAX_SAFE_INTEGER;
}

function createPreOnboardingPerson(user: User): Person {
  const metadata = isJsonObject(user.user_metadata) ? user.user_metadata : {};
  const givenName = stringValue(metadata.given_name, "");
  const familyName = stringValue(metadata.family_name, "");
  const combinedName = [givenName, familyName].filter(Boolean).join(" ");
  const emailName = user.email?.split("@")[0] ?? "";
  const name = [
    metadata.display_name,
    metadata.full_name,
    metadata.name,
    combinedName,
    metadata.preferred_username,
    emailName,
  ].map((value) => stringValue(value, "")).find(Boolean) ?? "New member";
  return {
    id: user.id,
    slug: "new-member",
    name,
    avatar: "https://i.pravatar.cc/240?img=1",
    headline: "New Hearthland member",
    location: "",
    country: "",
    languages: [],
    skills: [],
    skillCategories: [],
    values: [],
    lookingFor: [],
    preferredCountries: [],
    preferredTypes: [],
    preferredSize: [1, 200],
    governance: [],
    housing: [],
    ecology: [],
    economy: 3,
    communalLife: 3,
    family: "",
    availability: "Exploring",
    completeness: 0,
    bio: "",
  };
}

function anonymousViewer(): PlatformViewer {
  return {
    status: "anonymous",
    userId: null,
    email: null,
    role: "anonymous",
  };
}

function hasSupabaseEnvironment() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function hasRenderedFixtureTestEnvironment() {
  // The explicit fixture flag alone must never unlock demo data in production.
  return process.env.HEARTHLAND_TEST_PUBLIC_FIXTURE === "true" &&
    ["child-v8", "child-process"].includes(process.env.NODE_TEST_CONTEXT ?? "");
}

async function loadDevelopmentFallback(error: unknown): Promise<PlatformData> {
  if (process.env.NODE_ENV === "production") {
    if (error instanceof PlatformRepositoryError) throw error;
    throw new PlatformRepositoryError("Hearthland data could not be loaded.", {
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    `[hearthland] Supabase repository unavailable in development; using the isolated preview fixture. ${message}`,
  );
  return loadPreviewFixture();
}

async function loadPreviewFixture(): Promise<PlatformData> {
  const fixture = await import("../../app/demo-data");
  const previewTeachingSkills: Record<string, string[]> = {
    "mira-novak": ["Facilitation"],
    "elias-weber": ["Natural building", "Carpentry"],
    "sofia-martins": ["Agroforestry"],
    "daniel-horvat": ["Forestry"],
  };
  const people = fixture.people.map((person) => {
    const teachableNames = previewTeachingSkills[person.slug];
    if (!teachableNames) return person;
    return {
      ...person,
      teaching: {
        isAvailable: false,
        bio: "",
        teachingMode: "practical" as const,
        formats: ["Practical workshops"],
        travelScope: "local" as const,
        selectedCountries: [],
        travelRegions: [],
        languages: person.languages,
        availability: person.availability,
        compensationPreference: "",
        professionalArrangements: [],
        arrangementNotes: "",
        portfolioLinks: [],
        skills: teachableNames.map((name) => ({
          name,
          category: person.skillCategories[0] ?? "General",
          experienceLevel: "intermediate" as const,
          practicalWorkshops: true,
          theoreticalSessions: false,
        })),
        topics: [],
      },
    };
  });
  const currentPerson = people.find((person) => person.id === fixture.currentPerson.id)
    ?? fixture.currentPerson;
  return {
    currentPerson,
    people,
    communities: fixture.communities,
    emergingCommunities: fixture.emergingCommunities,
    lands: fixture.lands,
    projects: fixture.projects,
    opportunities: fixture.opportunities,
    buildingCamps: fixture.buildingCamps.map((camp) => ({
      ...camp,
      result: undefined,
    })),
    learningTopics: fixture.learningTopics.map((topic, index) => ({
      ...topic,
      id: `preview-learning-${index + 1}`,
      slug: topic.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    })),
    dashboardTasks: fixture.dashboardTasks,
    notificationsSeed: fixture.notificationsSeed,
    lifecycle: fixture.lifecycle,
    viewer: anonymousViewer(),
  };
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60)
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24)
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

function formatDueDate(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function experienceLevel(value: unknown): TeachableSkill["experienceLevel"] {
  return value === "beginner"
    || value === "intermediate"
    || value === "advanced"
    || value === "expert"
    ? value
    : "curious";
}

function teachingType(value: unknown): TeachingProfile["teachingMode"] {
  return value === "practical" || value === "theoretical" ? value : "both";
}

function travelScope(value: unknown): TeachingProfile["travelScope"] {
  return value === "selected_countries"
    || value === "europe"
    || value === "international"
    || value === "online"
    ? value
    : "local";
}

function humanise(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function humaniseDatabaseLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function projectProgressStatus(status: string): Project["progress"][string] {
  if (status === "completed") return "completed";
  if (status === "active") return "in progress";
  if (status === "next" || status === "blocked") return "exploring";
  return "not started";
}

function projectProgressWeight(status: string) {
  if (status === "completed") return 1;
  if (status === "active") return 0.65;
  if (status === "next") return 0.35;
  if (status === "blocked") return 0.2;
  return 0;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
