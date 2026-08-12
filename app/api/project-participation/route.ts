import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTICIPATION_TYPES = new Set([
  "future_resident",
  "core_team",
  "camp_participant",
  "volunteer",
  "master_teacher",
  "specialist",
  "supporter",
  "partner",
]);
const MANAGER_STATUSES = new Set(["new", "reviewing", "contacted", "accepted", "declined"]);
const WITHDRAWABLE_STATUSES = new Set(["new", "reviewing", "contacted"]);

type JsonRecord = Record<string, unknown>;

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanUuid(value: unknown, label: string) {
  const candidate = cleanString(value, 40);
  if (!UUID.test(candidate)) throw new RequestError(`${label} is invalid.`);
  return candidate;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function authenticatedClient() {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
  if (claims.error || !accountId) throw new RequestError("Sign in to participate in a Hearthland project.", 401);
  return { hearthland: supabase.schema("hearthland"), accountId };
}

async function canManageProject(
  hearthland: Awaited<ReturnType<typeof authenticatedClient>>["hearthland"],
  accountId: string,
  projectId: string,
) {
  const [entity, entityRole, platformRole] = await Promise.all([
    hearthland
      .from("entities")
      .select("owner_account_id")
      .eq("id", projectId)
      .eq("entity_type", "settlement_project")
      .is("archived_at", null)
      .maybeSingle(),
    hearthland
      .from("entity_roles")
      .select("role")
      .eq("entity_id", projectId)
      .eq("account_id", accountId)
      .eq("status", "active")
      .in("role", ["owner", "administrator"])
      .maybeSingle(),
    hearthland
      .from("platform_roles")
      .select("role")
      .eq("account_id", accountId)
      .eq("role", "admin")
      .is("revoked_at", null)
      .maybeSingle(),
  ]);

  if (entity.error || entityRole.error || platformRole.error) {
    throw new Error("Project management access could not be verified.");
  }

  return entity.data?.owner_account_id === accountId || Boolean(entityRole.data) || Boolean(platformRole.data);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This participation request was not accepted." }, { status: 403 });
  }

  try {
    const { hearthland, accountId } = await authenticatedClient();
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Participation details are required.");
    const projectId = cleanUuid(body.projectId, "Project");
    const participationType = cleanString(body.participationType, 60);
    if (!PARTICIPATION_TYPES.has(participationType)) throw new RequestError("Choose how you want to participate.");

    const project = await hearthland
      .from("entities")
      .select("id, entity_type, publication_status, archived_at")
      .eq("id", projectId)
      .eq("entity_type", "settlement_project")
      .eq("publication_status", "published")
      .is("archived_at", null)
      .maybeSingle();
    if (project.error) throw new Error(project.error.message);
    if (!project.data) throw new RequestError("This project is not accepting public participation requests.", 409);

    const requestedSkillIds = Array.isArray(body.relevantSkillIds)
      ? Array.from(new Set(body.relevantSkillIds.filter((value): value is string => typeof value === "string" && UUID.test(value)))).slice(0, 30)
      : [];
    const requestedSkillNames = Array.isArray(body.relevantSkillNames)
      ? Array.from(new Set(body.relevantSkillNames.flatMap((value) => {
          const name = cleanString(value, 160);
          return name ? [name.toLocaleLowerCase()] : [];
        }))).slice(0, 30)
      : [];
    let skillIds: string[] = [];
    if (requestedSkillIds.length || requestedSkillNames.length) {
      const profile = await hearthland
        .from("person_profiles")
        .select("entity_id")
        .eq("account_id", accountId)
        .is("archived_at", null)
        .maybeSingle();
      if (profile.error) throw new Error(profile.error.message);
      if (profile.data) {
        const personSkills = await hearthland
          .from("person_skills")
          .select("id, skill_id")
          .eq("profile_entity_id", profile.data.entity_id);
        if (personSkills.error) throw new Error(personSkills.error.message);
        const skillCatalogIds = Array.from(new Set(
          (personSkills.data ?? []).flatMap((row) => typeof row.skill_id === "string" ? [row.skill_id] : []),
        ));
        const skills = skillCatalogIds.length
          ? await hearthland.from("skills").select("id, name").in("id", skillCatalogIds).eq("is_active", true)
          : { data: [], error: null };
        if (skills.error) throw new Error(skills.error.message);
        const catalogNames = new Map((skills.data ?? []).map((skill) => [skill.id as string, cleanString(skill.name, 160).toLocaleLowerCase()]));
        const requestedIdSet = new Set(requestedSkillIds);
        const requestedNameSet = new Set(requestedSkillNames);
        skillIds = (personSkills.data ?? []).flatMap((personSkill) => {
          const id = typeof personSkill.id === "string" ? personSkill.id : "";
          const name = catalogNames.get(personSkill.skill_id as string) ?? "";
          return id && (requestedIdSet.has(id) || requestedNameSet.has(name)) ? [id] : [];
        }).slice(0, 30);
      }
    }
    const result = await hearthland
      .from("project_participation_requests")
      .insert({
        project_entity_id: projectId,
        applicant_account_id: accountId,
        participation_type: participationType,
        message: cleanString(body.message, 2500),
        availability: cleanString(body.availability, 500) || null,
        relevant_skill_ids: skillIds,
        status: "new",
      })
      .select("id, project_entity_id, participation_type, status, created_at")
      .single();
    if (result.error) {
      if (result.error.code === "23505") {
        throw new RequestError("You already have an active request for this participation role.", 409);
      }
      throw new Error(result.error.message);
    }

    return NextResponse.json({ request: result.data }, { status: 201 });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The participation request could not be submitted.";
    return NextResponse.json({ error }, { status });
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This participation update was not accepted." }, { status: 403 });
  }

  try {
    const { hearthland, accountId } = await authenticatedClient();
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Participation details are required.");
    const id = cleanUuid(body.id, "Participation request");
    const requestedStatus = cleanString(body.status, 30);
    if (requestedStatus !== "withdrawn" && !MANAGER_STATUSES.has(requestedStatus)) {
      throw new RequestError("Choose a valid participation status.");
    }

    const current = await hearthland
      .from("project_participation_requests")
      .select("id, project_entity_id, applicant_account_id, status")
      .eq("id", id)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new RequestError("The participation request could not be found.", 404);
    if (requestedStatus === "withdrawn") {
      if (current.data.applicant_account_id !== accountId) {
        throw new RequestError("Only the applicant can withdraw this request.", 403);
      }
      if (!WITHDRAWABLE_STATUSES.has(current.data.status)) {
        throw new RequestError("This participation request can no longer be withdrawn.", 409);
      }
    } else {
      const managerAccess = await canManageProject(
        hearthland,
        accountId,
        current.data.project_entity_id,
      );
      if (!managerAccess) {
        throw new RequestError("Only a project owner or administrator can change this status.", 403);
      }
    }

    const result = await hearthland
      .from("project_participation_requests")
      .update({ status: requestedStatus })
      .eq("id", id)
      .select("id, project_entity_id, participation_type, status, updated_at")
      .maybeSingle();
    if (result.error) {
      if (result.error.code === "42501") {
        throw new RequestError("This participation status change is not permitted.", 403);
      }
      throw new Error(result.error.message);
    }
    if (!result.data) throw new RequestError("This participation status cannot be changed.", 403);
    return NextResponse.json({ request: result.data });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The participation request could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}
