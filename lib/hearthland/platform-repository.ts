import type { User } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import type {
  DashboardTask,
  LearningTopic,
  PlatformData,
  PlatformNotification,
  PlatformViewer,
} from "../../app/platform-data";
import type {
  BuildingCamp,
  Community,
  Land,
  Opportunity,
  Person,
  Project,
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
          email:
            typeof claimsResult.data.claims.email === "string"
              ? claimsResult.data.claims.email
              : undefined,
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

    const [viewerState, notifications, dashboardTasks, avatarUrls] = user
      ? await Promise.all([
          loadViewerState(supabase, user),
          loadNotifications(supabase, user.id),
          loadDashboardTasks(supabase, user.id),
          loadVisibleAvatarUrls(supabase),
        ])
      : [anonymousViewer(), [], [], await loadVisibleAvatarUrls(supabase)];

    return assemblePlatformData({
      visibleRows,
      user,
      viewer: viewerState,
      notifications,
      dashboardTasks,
      avatarUrls,
    });
  } catch (error) {
    return loadDevelopmentFallback(error);
  }
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
    .select("id, title, body, read_at, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (result.error) return [];

  return ((result.data ?? []) as NotificationRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    time: relativeTime(row.created_at),
    unread: row.read_at === null,
  }));
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
}: {
  visibleRows: EntityRow[];
  user: User | null;
  viewer: PlatformViewer;
  notifications: PlatformNotification[];
  dashboardTasks: DashboardTask[];
  avatarUrls: Map<string, string>;
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
    .map((row) => normalizePerson(row, avatarUrls));
  const communities = surfacedRowsOfType("community").map((row) =>
    normalizeCommunity(row, "community"),
  );
  const emergingCommunities = surfacedRowsOfType("emerging_community")
    .map((row) => normalizeCommunity(row, "emerging"));
  const lands = surfacedRowsOfType("land_listing").map((row) =>
    normalizeDto<Land>(row),
  );
  const projects = surfacedRowsOfType("settlement_project").map((row) =>
    normalizeRelationshipDto<Project>(row, identities, ["parentId"]),
  );
  const opportunities = surfacedRowsOfType("opportunity").map((row) =>
    normalizeRelationshipDto<Opportunity>(row, identities, ["parentId"]),
  );
  const buildingCamps = surfacedRowsOfType("building_camp").map((row) =>
    normalizeRelationshipDto<BuildingCamp>(row, identities, [
      "parentId",
      "projectId",
    ]),
  );
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
    ? normalizePerson(ownedProfileRow, avatarUrls)
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
): Person {
  const payload = platformPayload(row.metadata);
  const preferredSize = Array.isArray(payload.preferredSize)
    ? payload.preferredSize
    : null;

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
  const email = user.email ?? "new-member@hearthland.local";
  const name = stringValue(
    isJsonObject(user.user_metadata) ? user.user_metadata.display_name : null,
    email.split("@")[0] || "New member",
  );
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
  const fixture = await import("../../app/demo-data");
  return {
    currentPerson: fixture.currentPerson,
    people: fixture.people,
    communities: fixture.communities,
    emergingCommunities: fixture.emergingCommunities,
    lands: fixture.lands,
    projects: fixture.projects,
    opportunities: fixture.opportunities,
    buildingCamps: fixture.buildingCamps,
    learningTopics: fixture.learningTopics,
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
