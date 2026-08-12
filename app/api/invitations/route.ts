import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

const SCHEMA = "hearthland";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set([
  "core_team",
  "future_resident",
  "master_teacher",
  "specialist",
  "builder",
  "volunteer",
  "organiser",
  "partner",
]);
const ENTITY_TYPES = ["community", "emerging_community", "settlement_project", "building_camp"];

type JsonRecord = Record<string, unknown>;

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, maximum = 240) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanEmail(value: unknown) {
  const email = cleanString(value, 320).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError("Enter a valid invitation email.");
  }
  return email;
}

function cleanUuid(value: unknown, label: string, optional = false) {
  const candidate = cleanString(value, 40);
  if (!candidate && optional) return null;
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
  if (claims.error || !accountId) throw new RequestError("Sign in to manage Hearthland invitations.", 401);
  return { supabase, hearthland: supabase.schema(SCHEMA), accountId };
}

async function managedEntities(
  hearthland: ReturnType<Awaited<ReturnType<typeof createClient>>["schema"]>,
  accountId: string,
) {
  const [roles, platformRole] = await Promise.all([
    hearthland
      .from("entity_roles")
      .select("entity_id, role")
      .eq("account_id", accountId)
      .eq("status", "active")
      .in("role", ["owner", "administrator"]),
    hearthland
      .from("platform_roles")
      .select("role")
      .eq("account_id", accountId)
      .eq("role", "admin")
      .is("revoked_at", null)
      .maybeSingle(),
  ]);
  if (roles.error || platformRole.error) throw new Error(roles.error?.message ?? platformRole.error?.message);

  const roleByEntity = new Map((roles.data ?? []).map((role) => [role.entity_id as string, role.role as string]));
  const query = hearthland
    .from("entities")
    .select("id, entity_type, title, slug, publication_status")
    .in("entity_type", ENTITY_TYPES)
    .is("archived_at", null)
    .order("title");
  const entities = platformRole.data
    ? await query
    : roleByEntity.size
      ? await query.in("id", [...roleByEntity.keys()])
      : { data: [], error: null };
  if (entities.error) throw new Error(entities.error.message);

  return (entities.data ?? []).map((entity) => ({
    id: entity.id,
    type: entity.entity_type,
    title: entity.title,
    slug: entity.slug,
    publicationStatus: entity.publication_status,
    role: platformRole.data ? "platform_admin" : roleByEntity.get(entity.id) ?? "manager",
  }));
}

export async function GET(request: Request) {
  try {
    const { hearthland, accountId } = await authenticatedClient();
    const url = new URL(request.url);
    const search = cleanString(url.searchParams.get("q"), 120);

    if (search) {
      if (search.length < 2) return NextResponse.json({ people: [] });
      const escaped = search.replaceAll("%", "").replaceAll("_", "");
      const people = await hearthland
        .from("person_profiles")
        .select("entity_id, account_id, display_name, headline")
        .not("account_id", "is", null)
        .ilike("display_name", `%${escaped}%`)
        .order("display_name")
        .limit(12);
      if (people.error) throw new Error(people.error.message);
      const entityIds = (people.data ?? []).map((person) => person.entity_id as string);
      const entities = entityIds.length
        ? await hearthland.from("entities").select("id, slug").in("id", entityIds)
        : { data: [], error: null };
      if (entities.error) throw new Error(entities.error.message);
      const slugById = new Map((entities.data ?? []).map((entity) => [entity.id as string, entity.slug as string]));
      return NextResponse.json({
        people: (people.data ?? []).map((person) => ({
          accountId: person.account_id,
          profileEntityId: person.entity_id,
          slug: slugById.get(person.entity_id as string) ?? "",
          name: person.display_name,
          headline: person.headline,
        })),
      });
    }

    const [entities, invitations] = await Promise.all([
      managedEntities(hearthland, accountId),
      hearthland
        .from("invitations")
        .select("id, entity_id, invited_account_id, invited_email, invited_name, invitation_type, proposed_role, role_title, message, practical_arrangements, status, invited_by_account_id, expires_at, responded_at, viewed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (invitations.error) throw new Error(invitations.error.message);

    const entityIds = Array.from(new Set((invitations.data ?? []).map((invite) => invite.entity_id as string)));
    const invitationEntities = entityIds.length
      ? await hearthland.from("entities").select("id, entity_type, title, slug").in("id", entityIds)
      : { data: [], error: null };
    if (invitationEntities.error) throw new Error(invitationEntities.error.message);
    const entityById = new Map((invitationEntities.data ?? []).map((entity) => [entity.id as string, entity]));

    return NextResponse.json({
      managedEntities: entities,
      invitations: (invitations.data ?? []).map((invitation) => {
        const entity = entityById.get(invitation.entity_id as string);
        return {
          id: invitation.id,
          entityId: invitation.entity_id,
          entityType: entity?.entity_type ?? "",
          entityTitle: entity?.title ?? "Hearthland place",
          entitySlug: entity?.slug ?? "",
          recipient: invitation.invited_name || invitation.invited_email || (invitation.invited_account_id ? "Hearthland member" : "Shareable link"),
          invitedEmail: invitation.invited_email,
          invitationType: invitation.invitation_type,
          proposedRole: invitation.role_title || invitation.proposed_role,
          message: invitation.message,
          practicalArrangements: invitation.practical_arrangements,
          status: invitation.status,
          expiresAt: invitation.expires_at,
          respondedAt: invitation.responded_at,
          viewedAt: invitation.viewed_at,
          createdAt: invitation.created_at,
          direction: invitation.invited_by_account_id === accountId ? "sent" : "received",
        };
      }),
    });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "Invitations could not be loaded.";
    return NextResponse.json({ error }, { status });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This invitation request was not accepted." }, { status: 403 });
  }
  try {
    const { hearthland } = await authenticatedClient();
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Invitation details are required.");

    const entityId = cleanUuid(body.entityId, "Entity");
    const invitedAccountId = cleanUuid(body.invitedAccountId, "Recipient", true);
    const invitedEmail = cleanEmail(body.invitedEmail);
    const shareable = body.shareable === true;
    if (!invitedAccountId && !invitedEmail && !shareable) {
      throw new RequestError("Choose a Hearthland person, enter an email, or create a shareable link.");
    }
    const invitationType = cleanString(body.invitationType, 80);
    if (!CATEGORIES.has(invitationType)) throw new RequestError("Choose a supported invitation category.");
    const proposedRole = cleanString(body.proposedRole, 120);
    if (proposedRole.length < 2) throw new RequestError("Describe the intended role.");

    const result = await hearthland.rpc("create_invitation", {
      payload: {
        entity_id: entityId,
        invited_account_id: invitedAccountId,
        invited_email: invitedEmail,
        invited_name: cleanString(body.invitedName, 160) || null,
        invitation_type: invitationType,
        proposed_role: proposedRole,
        role_title: proposedRole,
        message: cleanString(body.message, 2000),
        practical_arrangements: cleanString(body.practicalArrangements, 2000),
        shareable,
      },
    });
    if (result.error) {
      if (result.error.code === "23505") throw new RequestError("A pending invitation already exists for this person and role.", 409);
      throw new Error(result.error.message);
    }
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!isRecord(created) || typeof created.token !== "string") {
      throw new Error("Invitation token was not returned.");
    }
    const invitationUrl = new URL(`/invite/${created.token}`, request.url).toString();
    return NextResponse.json({
      invitation: {
        id: created.invitation_id,
        status: created.status ?? "pending",
        expiresAt: created.expires_at ?? null,
        url: invitationUrl,
        delivery: invitedEmail ? "copy_link_email_pending_configuration" : "copy_link",
      },
    }, { status: 201 });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The invitation could not be created.";
    return NextResponse.json({ error }, { status });
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This invitation request was not accepted." }, { status: 403 });
  }
  try {
    const { hearthland } = await authenticatedClient();
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Invitation details are required.");
    const id = cleanUuid(body.id, "Invitation");
    if (body.action !== "revoke") throw new RequestError("Unsupported invitation action.");
    const result = await hearthland.rpc("revoke_invitation", { target_invitation_id: id });
    if (result.error) {
      if (result.error.message.includes("INVITATION_CANNOT_BE_REVOKED")) {
        throw new RequestError("This invitation cannot be revoked.", 409);
      }
      if (result.error.message.includes("INVITATION_NOT_FOUND")) {
        throw new RequestError("The invitation could not be found.", 404);
      }
      throw new Error(result.error.message);
    }
    return NextResponse.json({ invitation: result.data });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The invitation could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}
