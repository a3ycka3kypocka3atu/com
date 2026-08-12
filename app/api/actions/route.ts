import { createClient } from "../../../lib/supabase/server";

type ActionName = "save" | "interest" | "apply" | "camp_apply" | "connect";

type ActionPayload = {
  action?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  enabled?: unknown;
  reason?: unknown;
  roles?: unknown;
  message?: unknown;
  skillsOffered?: unknown;
  learningInterests?: unknown;
  arrivalDate?: unknown;
  departureDate?: unknown;
  accommodationRequirement?: unknown;
  resourcesOffered?: unknown;
  futureCommunityInterest?: unknown;
};

type UiEntityType =
  | "community"
  | "emerging"
  | "land"
  | "opportunity"
  | "person"
  | "project"
  | "camp"
  | "organisation"
  | "learning";

type DatabaseEntityType =
  | "community"
  | "emerging_community"
  | "land_listing"
  | "opportunity"
  | "person_profile"
  | "settlement_project"
  | "building_camp"
  | "organisation"
  | "learning_topic";

type DatabaseError = {
  code?: string;
  message?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<ActionName>(["save", "interest", "apply", "camp_apply", "connect"]);

const UI_TO_DATABASE_TYPE: Record<UiEntityType, DatabaseEntityType> = {
  community: "community",
  emerging: "emerging_community",
  land: "land_listing",
  opportunity: "opportunity",
  person: "person_profile",
  project: "settlement_project",
  camp: "building_camp",
  organisation: "organisation",
  learning: "learning_topic",
};

const DATABASE_TO_UI_TYPE: Record<DatabaseEntityType, UiEntityType> = {
  community: "community",
  emerging_community: "emerging",
  land_listing: "land",
  opportunity: "opportunity",
  person_profile: "person",
  settlement_project: "project",
  building_camp: "camp",
  organisation: "organisation",
  learning_topic: "learning",
};

const INTEREST_TYPES: Record<string, "join" | "visit" | "volunteer" | "collaborate" | "learn" | "support" | "other"> = {
  join: "join",
  "i want to join": "join",
  visit: "visit",
  "i want to visit": "visit",
  volunteer: "volunteer",
  "i want to volunteer": "volunteer",
  collaborate: "collaborate",
  "i want to collaborate": "collaborate",
  learn: "learn",
  "i want to learn more": "learn",
  support: "support",
  "i may support or invest": "support",
  other: "other",
};

const CAMP_ROLE_CODES: Record<string, string> = {
  participant: "participant",
  learner: "learner",
  volunteer: "volunteer",
  builder: "builder",
  "master / teacher": "master_teacher",
  master_teacher: "master_teacher",
  specialist: "specialist",
  "future resident": "future_resident",
  future_resident: "future_resident",
};
const CAMP_FUTURE_COMMUNITY_INTERESTS = new Set(["interested", "maybe", "camp_only"]);

function jsonError(message: string, status: number, code: string) {
  return Response.json({ error: message, code }, { status });
}

function authRequired(request: Request) {
  let next = "/";
  const referer = request.headers.get("referer");

  if (referer) {
    try {
      const source = new URL(referer);
      const target = new URL(request.url);
      if (source.origin === target.origin && !source.pathname.startsWith("/auth/")) {
        next = `${source.pathname}${source.search}`;
      }
    } catch {
      // Ignore malformed or cross-origin referrers.
    }
  }

  return Response.json(
    {
      error: "Sign in to continue",
      code: "AUTH_REQUIRED",
      signInUrl: `/auth/sign-in?next=${encodeURIComponent(next)}`,
    },
    { status: 401 },
  );
}

function reportDatabaseError(context: string, error: DatabaseError) {
  console.error(`[hearthland/actions] ${context}`, {
    code: error.code ?? "unknown",
    message: error.message ?? "Unknown database error",
  });
}

function isDatabaseType(value: string): value is DatabaseEntityType {
  return Object.prototype.hasOwnProperty.call(DATABASE_TO_UI_TYPE, value);
}

function parseUiEntityType(value: unknown): UiEntityType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UI_TO_DATABASE_TYPE, normalized)
    ? normalized as UiEntityType
    : null;
}

function parseAction(value: unknown): ActionName | null {
  return typeof value === "string" && ACTIONS.has(value as ActionName)
    ? value as ActionName
    : null;
}

function parseText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : null;
}

function parseDate(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function parseRoles(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) return null;

  const roles: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const role = item.trim();
    if (!role || role.length > 100) return null;
    if (!roles.includes(role)) roles.push(role);
  }
  return roles;
}

function normalizeCampRoles(roles: string[]) {
  const normalized: string[] = [];
  for (const role of roles) {
    const code = CAMP_ROLE_CODES[role.toLowerCase()];
    if (!code) return null;
    if (!normalized.includes(code)) normalized.push(code);
  }
  return normalized;
}

function availableCampRoleCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((role) => {
    if (typeof role !== "string") return [];
    const code = CAMP_ROLE_CODES[role.trim().toLowerCase()];
    return code ? [code] : [];
  })));
}

function mapInterestType(reason: string) {
  return INTEREST_TYPES[reason.toLowerCase()] ?? "other";
}

async function authenticatedClient(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return { response: authRequired(request) } as const;
  }

  return { supabase, userId } as const;
}

export async function GET(request: Request) {
  const auth = await authenticatedClient(request);
  if ("response" in auth) return auth.response;

  const { supabase, userId } = auth;
  const { data: savedRows, error: savedError } = await supabase
    .schema("hearthland")
    .from("saved_entities")
    .select("entity_id, created_at")
    .eq("account_id", userId)
    .order("created_at", { ascending: false });

  if (savedError) {
    reportDatabaseError("load saved entities", savedError);
    return jsonError("Could not load your saved places right now", 500, "SAVED_LOAD_FAILED");
  }

  const entityIds = (savedRows ?? []).map((row) => row.entity_id as string);
  if (entityIds.length === 0) return Response.json({ saved: [] });

  const { data: entities, error: entitiesError } = await supabase
    .schema("hearthland")
    .from("entities")
    .select("id, entity_type")
    .in("id", entityIds);

  if (entitiesError) {
    reportDatabaseError("resolve saved entity types", entitiesError);
    return jsonError("Could not load your saved places right now", 500, "SAVED_LOAD_FAILED");
  }

  const typeById = new Map<string, UiEntityType>();
  for (const entity of entities ?? []) {
    if (typeof entity.id === "string" && typeof entity.entity_type === "string" && isDatabaseType(entity.entity_type)) {
      typeById.set(entity.id, DATABASE_TO_UI_TYPE[entity.entity_type]);
    }
  }

  const saved = entityIds.flatMap((entityId) => {
    const entityType = typeById.get(entityId);
    return entityType ? [{ entityType, entityId }] : [];
  });

  return Response.json({ saved });
}

export async function POST(request: Request) {
  const auth = await authenticatedClient(request);
  if ("response" in auth) return auth.response;

  let payload: ActionPayload;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Invalid request", 400, "INVALID_REQUEST");
    }
    payload = parsed as ActionPayload;
  } catch {
    return jsonError("Invalid request", 400, "INVALID_REQUEST");
  }

  const action = parseAction(payload.action);
  const uiEntityType = parseUiEntityType(payload.entityType);
  const entityId = typeof payload.entityId === "string" ? payload.entityId.trim() : "";
  const reason = parseText(payload.reason, 160);
  const message = parseText(payload.message, action === "connect" ? 2_000 : 10_000);
  const roles = parseRoles(payload.roles);

  if (!action) return jsonError("Choose a supported action", 400, "INVALID_ACTION");
  if (!uiEntityType) return jsonError("Choose a supported entity type", 400, "INVALID_ENTITY_TYPE");
  if (!UUID_PATTERN.test(entityId)) return jsonError("The selected item is invalid", 400, "INVALID_ENTITY_ID");
  if (reason === null || message === null || roles === null) {
    return jsonError("One or more fields are invalid or too long", 400, "INVALID_FIELDS");
  }

  const expectedDatabaseType = UI_TO_DATABASE_TYPE[uiEntityType];
  const expectedTypes: Partial<Record<ActionName, DatabaseEntityType[]>> = {
    interest: ["community", "emerging_community"],
    apply: ["opportunity"],
    camp_apply: ["building_camp"],
    connect: ["person_profile"],
  };
  if (action !== "save" && !expectedTypes[action]?.includes(expectedDatabaseType)) {
    return jsonError("This action is not available for the selected item", 400, "ACTION_ENTITY_MISMATCH");
  }

  const { supabase, userId } = auth;
  const { data: entity, error: entityError } = await supabase
    .schema("hearthland")
    .from("entities")
    .select("id, entity_type, publication_status, archived_at")
    .eq("id", entityId)
    .maybeSingle();

  if (entityError) {
    reportDatabaseError("validate entity", entityError);
    return jsonError("Could not validate the selected item", 500, "ENTITY_CHECK_FAILED");
  }
  if (!entity) return jsonError("The selected item was not found", 404, "ENTITY_NOT_FOUND");
  if (entity.entity_type !== expectedDatabaseType) {
    return jsonError("The selected item does not match its type", 400, "ENTITY_TYPE_MISMATCH");
  }
  if (entity.archived_at || entity.publication_status !== "published") {
    return jsonError("This item is not currently available", 409, "ENTITY_UNAVAILABLE");
  }

  if (action === "save") {
    if (typeof payload.enabled !== "boolean") {
      return jsonError("Choose whether to save or remove this item", 400, "INVALID_SAVE_STATE");
    }
    if (payload.enabled) {
      const { error } = await supabase
        .schema("hearthland")
        .from("saved_entities")
        .insert({ account_id: userId, entity_id: entityId });
      if (error && error.code !== "23505") {
        reportDatabaseError("save entity", error);
        return jsonError("Could not save this item right now", 500, "SAVE_FAILED");
      }
    } else {
      const { error } = await supabase
        .schema("hearthland")
        .from("saved_entities")
        .delete()
        .eq("account_id", userId)
        .eq("entity_id", entityId);
      if (error) {
        reportDatabaseError("remove saved entity", error);
        return jsonError("Could not remove this saved item right now", 500, "SAVE_REMOVE_FAILED");
      }
    }
    return Response.json({ ok: true, saved: payload.enabled });
  }

  if (action === "interest") {
    const communityAvailability = await validateCommunityInterest(supabase, entityId, expectedDatabaseType, mapInterestType(reason));
    if (communityAvailability) return communityAvailability;

    const { data: existing, error: existingError } = await supabase
      .schema("hearthland")
      .from("community_interests")
      .select("pipeline_status, archived_at")
      .eq("community_entity_id", entityId)
      .eq("applicant_account_id", userId)
      .maybeSingle();
    if (existingError) {
      reportDatabaseError("check community interest", existingError);
      return jsonError("Could not send your interest right now", 500, "INTEREST_FAILED");
    }
    if (existing) {
      if (existing.archived_at || ["withdrawn", "archived", "declined"].includes(existing.pipeline_status)) {
        return jsonError("You already have a closed interest for this community", 409, "INTEREST_ALREADY_CLOSED");
      }
      return Response.json({ ok: true, status: existing.pipeline_status, duplicate: true });
    }

    const { error } = await supabase
      .schema("hearthland")
      .from("community_interests")
      .insert({
        community_entity_id: entityId,
        applicant_account_id: userId,
        interest_type: mapInterestType(reason),
        message,
        pipeline_status: "new",
      });
    if (error && error.code !== "23505") {
      reportDatabaseError("create community interest", error);
      return jsonError("Could not send your interest right now", 500, "INTEREST_FAILED");
    }
    return Response.json({ ok: true, status: "new", duplicate: error?.code === "23505" }, { status: error ? 200 : 201 });
  }

  if (action === "apply") {
    const { data: opportunity, error: opportunityError } = await supabase
      .schema("hearthland")
      .from("opportunities")
      .select("application_status")
      .eq("entity_id", entityId)
      .maybeSingle();
    if (opportunityError) {
      reportDatabaseError("check opportunity", opportunityError);
      return jsonError("Could not check this opportunity right now", 500, "OPPORTUNITY_CHECK_FAILED");
    }
    if (!opportunity || opportunity.application_status !== "open") {
      return jsonError("Applications are not open for this opportunity", 409, "APPLICATIONS_CLOSED");
    }

    const { data: existing, error: existingError } = await supabase
      .schema("hearthland")
      .from("opportunity_applications")
      .select("status, archived_at")
      .eq("opportunity_entity_id", entityId)
      .eq("applicant_account_id", userId)
      .maybeSingle();
    if (existingError) {
      reportDatabaseError("check opportunity application", existingError);
      return jsonError("Could not send your application right now", 500, "APPLICATION_FAILED");
    }
    if (existing) {
      if (existing.archived_at || ["withdrawn", "declined"].includes(existing.status)) {
        return jsonError("You already have a closed application for this opportunity", 409, "APPLICATION_ALREADY_CLOSED");
      }
      return Response.json({ ok: true, status: existing.status, duplicate: true });
    }

    const { error } = await supabase
      .schema("hearthland")
      .from("opportunity_applications")
      .insert({
        opportunity_entity_id: entityId,
        applicant_account_id: userId,
        message,
        availability: roles.length ? roles.join(" · ") : null,
        status: "submitted",
      });
    if (error && error.code !== "23505") {
      reportDatabaseError("create opportunity application", error);
      return jsonError("Could not send your application right now", 500, "APPLICATION_FAILED");
    }
    return Response.json({ ok: true, status: "submitted", duplicate: error?.code === "23505" }, { status: error ? 200 : 201 });
  }

  if (action === "camp_apply") {
    const campRoles = normalizeCampRoles(roles);
    if (campRoles === null || campRoles.length === 0) {
      return jsonError("Choose a supported Camp role", 400, "INVALID_CAMP_ROLE");
    }
    const skillsOffered = parseText(payload.skillsOffered, 2_000);
    const learningInterests = parseText(payload.learningInterests, 2_000);
    const arrivalDate = parseDate(payload.arrivalDate);
    const departureDate = parseDate(payload.departureDate);
    const accommodationRequirement = parseText(payload.accommodationRequirement, 1_000);
    const resourcesOffered = parseText(payload.resourcesOffered, 2_000);
    const futureCommunityInterest = parseText(payload.futureCommunityInterest, 500);
    if (
      skillsOffered === null || learningInterests === null
      || arrivalDate === null || departureDate === null
      || accommodationRequirement === null || resourcesOffered === null
      || futureCommunityInterest === null
    ) {
      return jsonError("One or more Camp application fields are invalid", 400, "INVALID_CAMP_FIELDS");
    }
    if (futureCommunityInterest && !CAMP_FUTURE_COMMUNITY_INTERESTS.has(futureCommunityInterest)) {
      return jsonError("Choose a valid future-community interest", 400, "INVALID_CAMP_INTEREST");
    }
    if (arrivalDate && departureDate && departureDate < arrivalDate) {
      return jsonError("Departure must be on or after arrival", 400, "INVALID_CAMP_DATES");
    }
    const { data: camp, error: campError } = await supabase
      .schema("hearthland")
      .from("building_camps")
      .select("camp_status, application_deadline, start_date, end_date, roles_available")
      .eq("entity_id", entityId)
      .maybeSingle();
    if (campError) {
      reportDatabaseError("check camp", campError);
      return jsonError("Could not check this camp right now", 500, "CAMP_CHECK_FAILED");
    }
    const today = new Date().toISOString().slice(0, 10);
    const deadlinePassed = typeof camp?.application_deadline === "string"
      && camp.application_deadline < today;
    const campEnded = typeof camp?.end_date === "string" && camp.end_date < today;
    if (!camp || camp.camp_status !== "applications_open" || deadlinePassed || campEnded) {
      return jsonError("Applications are not open for this camp", 409, "CAMP_APPLICATIONS_CLOSED");
    }
    const availableRoles = availableCampRoleCodes(camp.roles_available);
    if (availableRoles.length > 0 && campRoles.some((role) => !availableRoles.includes(role))) {
      return jsonError("One or more selected Camp roles are no longer available", 409, "CAMP_ROLE_UNAVAILABLE");
    }
    if (
      (arrivalDate && (arrivalDate < camp.start_date || arrivalDate > camp.end_date))
      || (departureDate && (departureDate < camp.start_date || departureDate > camp.end_date))
    ) {
      return jsonError("Arrival and departure must be within the Camp dates", 400, "CAMP_DATES_OUTSIDE_WINDOW");
    }

    const { data: existing, error: existingError } = await supabase
      .schema("hearthland")
      .from("camp_applications")
      .select("status, archived_at")
      .eq("camp_entity_id", entityId)
      .eq("applicant_account_id", userId)
      .maybeSingle();
    if (existingError) {
      reportDatabaseError("check camp application", existingError);
      return jsonError("Could not send your camp application right now", 500, "CAMP_APPLICATION_FAILED");
    }
    if (existing) {
      if (existing.archived_at || ["withdrawn", "cancelled", "declined"].includes(existing.status)) {
        return jsonError("You already have a closed application for this camp", 409, "CAMP_APPLICATION_ALREADY_CLOSED");
      }
      return Response.json({ ok: true, status: existing.status, duplicate: true });
    }

    const { error } = await supabase
      .schema("hearthland")
      .from("camp_applications")
      .insert({
        camp_entity_id: entityId,
        applicant_account_id: userId,
        selected_roles: campRoles,
        message,
        skills_offered: skillsOffered,
        learning_interests: learningInterests,
        arrival_date: arrivalDate || null,
        departure_date: departureDate || null,
        accommodation_requirement: accommodationRequirement || null,
        resources_offered: resourcesOffered,
        future_community_interest: futureCommunityInterest || null,
        status: "new",
      });
    if (error && error.code !== "23505") {
      reportDatabaseError("create camp application", error);
      return jsonError("Could not send your camp application right now", 500, "CAMP_APPLICATION_FAILED");
    }
    return Response.json({ ok: true, status: "new", duplicate: error?.code === "23505" }, { status: error ? 200 : 201 });
  }

  const { data: targetProfile, error: profileError } = await supabase
    .schema("hearthland")
    .from("person_profiles")
    .select("account_id")
    .eq("entity_id", entityId)
    .maybeSingle();
  if (profileError) {
    reportDatabaseError("resolve connection profile", profileError);
    return jsonError("Could not send this connection request right now", 500, "CONNECTION_FAILED");
  }
  if (!targetProfile?.account_id) {
    return jsonError("This profile is not connected to a real member account yet", 409, "PROFILE_NOT_CONNECTABLE");
  }
  if (targetProfile.account_id === userId) {
    return jsonError("You cannot connect with your own profile", 409, "SELF_CONNECTION");
  }

  const existingConnection = await findConnection(supabase, userId, targetProfile.account_id);
  if (existingConnection.error) {
    reportDatabaseError("check connection", existingConnection.error);
    return jsonError("Could not send this connection request right now", 500, "CONNECTION_FAILED");
  }
  if (existingConnection.connection) {
    const connection = existingConnection.connection;
    if (connection.status === "pending" && connection.receiver_account_id === userId) {
      return jsonError("This member has already sent you a connection request", 409, "INCOMING_CONNECTION_EXISTS");
    }
    if (["pending", "accepted"].includes(connection.status)) {
      return Response.json({ ok: true, status: connection.status, duplicate: true });
    }
    return jsonError("A previous connection request between these accounts is closed", 409, "CONNECTION_ALREADY_CLOSED");
  }

  const { error: connectionError } = await supabase
    .schema("hearthland")
    .from("connections")
    .insert({
      requester_account_id: userId,
      receiver_account_id: targetProfile.account_id,
      message,
      status: "pending",
    });
  if (connectionError && connectionError.code !== "23505") {
    reportDatabaseError("create connection", connectionError);
    const isBlocked = connectionError.code === "42501";
    return jsonError(
      isBlocked ? "This connection request is not allowed" : "Could not send this connection request right now",
      isBlocked ? 403 : 500,
      isBlocked ? "CONNECTION_NOT_ALLOWED" : "CONNECTION_FAILED",
    );
  }
  return Response.json({ ok: true, status: "pending", duplicate: connectionError?.code === "23505" }, { status: connectionError ? 200 : 201 });
}

async function validateCommunityInterest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityId: string,
  entityType: DatabaseEntityType,
  interestType: "join" | "visit" | "volunteer" | "collaborate" | "learn" | "support" | "other",
) {
  if (entityType === "community") {
    const { data, error } = await supabase
      .schema("hearthland")
      .from("communities")
      .select("lifecycle_status, accepting_members")
      .eq("entity_id", entityId)
      .maybeSingle();
    if (error) {
      reportDatabaseError("check community", error);
      return jsonError("Could not check this community right now", 500, "COMMUNITY_CHECK_FAILED");
    }
    if (!data || data.lifecycle_status === "closed") {
      return jsonError("This community is not accepting interest right now", 409, "COMMUNITY_INTEREST_CLOSED");
    }
    if (interestType === "join" && !data.accepting_members) {
      return jsonError("This community is not currently accepting new members", 409, "COMMUNITY_MEMBERSHIP_CLOSED");
    }
    return null;
  }

  const { data, error } = await supabase
    .schema("hearthland")
    .from("emerging_communities")
    .select("entity_id")
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) {
    reportDatabaseError("check emerging community", error);
    return jsonError("Could not check this community right now", 500, "COMMUNITY_CHECK_FAILED");
  }
  return data ? null : jsonError("This community is not accepting interest right now", 409, "COMMUNITY_INTEREST_CLOSED");
}

async function findConnection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  targetAccountId: string,
) {
  const { data: outgoing, error: outgoingError } = await supabase
    .schema("hearthland")
    .from("connections")
    .select("requester_account_id, receiver_account_id, status")
    .eq("requester_account_id", userId)
    .eq("receiver_account_id", targetAccountId)
    .maybeSingle();
  if (outgoingError) return { error: outgoingError } as const;
  if (outgoing) return { connection: outgoing } as const;

  const { data: incoming, error: incomingError } = await supabase
    .schema("hearthland")
    .from("connections")
    .select("requester_account_id, receiver_account_id, status")
    .eq("requester_account_id", targetAccountId)
    .eq("receiver_account_id", userId)
    .maybeSingle();
  if (incomingError) return { error: incomingError } as const;
  return { connection: incoming } as const;
}
