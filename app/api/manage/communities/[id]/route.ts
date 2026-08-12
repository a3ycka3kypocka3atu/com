import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISION_STATUSES = new Set(["proposed", "approved", "rejected", "superseded", "archived"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const TASK_STATUSES = new Set(["todo", "in_progress", "blocked", "completed"]);

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

function cleanUuid(value: unknown, label: string): string;
function cleanUuid(value: unknown, label: string, optional: true): string | null;
function cleanUuid(value: unknown, label: string, optional = false): string | null {
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

function timestamp(value: unknown, label: string, optional = false) {
  const candidate = cleanString(value, 80);
  if (!candidate && optional) return null;
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime())) throw new RequestError(`${label} is invalid.`);
  return date.toISOString();
}

function slugFromTitle(title: string) {
  const base = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "group";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function communityContext(communityId: string) {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
  if (claims.error || !accountId) throw new RequestError("Sign in to use Community operations.", 401);
  const hearthland = supabase.schema("hearthland");
  const [entity, account, role, memberships, platformRole] = await Promise.all([
    hearthland.from("entities").select("id, owner_account_id").eq("id", communityId).eq("entity_type", "community").is("archived_at", null).maybeSingle(),
    hearthland.from("accounts").select("account_status").eq("id", accountId).is("archived_at", null).maybeSingle(),
    hearthland.from("entity_roles").select("role").eq("entity_id", communityId).eq("account_id", accountId).eq("status", "active").maybeSingle(),
    hearthland.from("entity_memberships").select("id").eq("entity_id", communityId).eq("account_id", accountId).eq("status", "active").limit(1),
    hearthland.from("platform_roles").select("role").eq("account_id", accountId).eq("role", "admin").is("revoked_at", null).maybeSingle(),
  ]);
  if (entity.error || account.error || role.error || memberships.error || platformRole.error) throw new Error(entity.error?.message ?? account.error?.message ?? role.error?.message ?? memberships.error?.message ?? platformRole.error?.message);
  if (!entity.data) throw new RequestError("The Community could not be found.", 404);
  if (account.data?.account_status !== "active") throw new RequestError("An active Hearthland account is required.", 403);
  const isOwner = entity.data.owner_account_id === accountId;
  const hasEntityRole = Boolean(role.data);
  return {
    hearthland,
    accountId,
    isMember: isOwner || hasEntityRole || Boolean(memberships.data?.length),
    canManage: isOwner || role.data?.role === "owner" || role.data?.role === "administrator" || Boolean(platformRole.data),
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This Community update was not accepted." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const communityId = cleanUuid(id, "Community");
    const { hearthland, accountId, isMember, canManage } = await communityContext(communityId);
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Community update details are required.");
    const action = cleanString(body.action, 60);

    if (action === "pulse_response") {
      if (!isMember) throw new RequestError("Active Community membership is required.", 403);
      const cycleId = cleanUuid(body.cycleId, "Pulse cycle");
      const ratings = ["communication", "cooperation", "belonging", "workload", "clarity", "atmosphere"] as const;
      const payload: Record<string, number | string> = {
        cycle_id: cycleId,
        account_id: accountId,
        private_comment: cleanString(body.privateComment, 3000),
      };
      for (const rating of ratings) {
        const value = Number(body[rating]);
        if (!Number.isInteger(value) || value < 1 || value > 5) throw new RequestError("Every pulse rating must be between 1 and 5.");
        payload[rating] = value;
      }
      const result = await hearthland.from("community_pulse_responses").upsert(payload, { onConflict: "cycle_id,account_id" })
        .select("id, cycle_id, submitted_at, updated_at").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ response: result.data });
    }

    if (action === "member_task_status") {
      if (!isMember) throw new RequestError("Active Community membership is required.", 403);
      const taskId = cleanUuid(body.taskId, "Task");
      const status = cleanString(body.status, 30);
      if (!TASK_STATUSES.has(status)) throw new RequestError("Choose a valid task status.");
      const result = await hearthland.from("tasks").update({
        status,
        updated_by_account_id: accountId,
      }).eq("id", taskId)
        .eq("entity_id", communityId)
        .eq("assignee_account_id", accountId)
        .is("archived_at", null)
        .select("id, status, updated_at")
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new RequestError("Only the assigned member can update this task.", 403);
      return NextResponse.json({ task: result.data });
    }

    if (!canManage) throw new RequestError("Community owner or administrator access is required.", 403);

    if (action === "working_group") {
      const title = cleanString(body.title, 160);
      if (!title) throw new RequestError("Working-group title is required.");
      const result = await hearthland.from("community_working_groups").insert({
        community_entity_id: communityId,
        slug: slugFromTitle(title),
        title,
        description: cleanString(body.description, 3000),
        coordinator_account_id: cleanUuid(body.coordinatorAccountId, "Coordinator", true),
        group_status: "active",
        created_by_account_id: accountId,
      }).select("id, slug, title, description, coordinator_account_id, group_status").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ workingGroup: result.data }, { status: 201 });
    }

    if (action === "working_group_member") {
      const workingGroupId = cleanUuid(body.workingGroupId, "Working group");
      const memberAccountId = cleanUuid(body.accountId, "Member");
      const memberRole = body.memberRole === "coordinator" ? "coordinator" : "member";
      const result = await hearthland.from("working_group_members").upsert({
        working_group_id: workingGroupId,
        account_id: memberAccountId,
        member_role: memberRole,
        status: body.status === "inactive" ? "inactive" : "active",
        created_by_account_id: accountId,
      }, { onConflict: "working_group_id,account_id" })
        .select("working_group_id, account_id, member_role, status").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ member: result.data });
    }

    if (action === "meeting") {
      const title = cleanString(body.title, 200);
      if (!title) throw new RequestError("Meeting title is required.");
      const startsAt = timestamp(body.startsAt, "Meeting start");
      const endsAt = timestamp(body.endsAt, "Meeting end", true);
      const result = await hearthland.from("community_meetings").insert({
        community_entity_id: communityId,
        working_group_id: cleanUuid(body.workingGroupId, "Working group", true),
        title,
        starts_at: startsAt,
        ends_at: endsAt,
        agenda: cleanString(body.agenda, 6000),
        notes: cleanString(body.notes, 10000),
        meeting_status: body.meetingStatus === "completed" ? "completed" : "scheduled",
        visibility: body.visibility === "managers" ? "managers" : "members",
        created_by_account_id: accountId,
        updated_by_account_id: accountId,
      }).select("id, title, starts_at, ends_at, meeting_status, visibility").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ meeting: result.data }, { status: 201 });
    }

    if (action === "decision") {
      const title = cleanString(body.title, 200);
      const decisionStatus = cleanString(body.decisionStatus, 30) || "proposed";
      if (!title) throw new RequestError("Decision title is required.");
      if (!DECISION_STATUSES.has(decisionStatus)) throw new RequestError("Choose a valid decision status.");
      const result = await hearthland.from("community_decisions").insert({
        community_entity_id: communityId,
        meeting_id: cleanUuid(body.meetingId, "Meeting", true),
        title,
        description: cleanString(body.description, 6000),
        decision_status: decisionStatus,
        decided_at: decisionStatus === "proposed" || decisionStatus === "archived" ? null : new Date().toISOString(),
        visibility: body.visibility === "managers" ? "managers" : "members",
        created_by_account_id: accountId,
        updated_by_account_id: accountId,
      }).select("id, title, decision_status, decided_at, visibility").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ decision: result.data }, { status: 201 });
    }

    if (action === "pulse_cycle") {
      const title = cleanString(body.title, 160);
      if (!title) throw new RequestError("Pulse title is required.");
      const result = await hearthland.from("community_pulse_cycles").insert({
        community_entity_id: communityId,
        title,
        opens_at: timestamp(body.opensAt, "Pulse opening", true) ?? new Date().toISOString(),
        closes_at: timestamp(body.closesAt, "Pulse closing", true),
        cycle_status: body.cycleStatus === "draft" ? "draft" : "open",
        created_by_account_id: accountId,
      }).select("id, title, opens_at, closes_at, cycle_status").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ pulseCycle: result.data }, { status: 201 });
    }

    if (action === "task") {
      const title = cleanString(body.title, 220);
      const priority = cleanString(body.priority, 20) || "medium";
      if (!title) throw new RequestError("Task title is required.");
      if (!TASK_PRIORITIES.has(priority)) throw new RequestError("Choose a valid task priority.");
      const dueDate = cleanString(body.dueDate, 10);
      if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new RequestError("Task due date is invalid.");
      const result = await hearthland.from("tasks").insert({
        entity_id: communityId,
        working_group_id: cleanUuid(body.workingGroupId, "Working group", true),
        title,
        description: cleanString(body.description, 3000),
        assignee_account_id: cleanUuid(body.assigneeAccountId, "Assignee", true),
        due_date: dueDate || null,
        status: "todo",
        priority,
        created_by_account_id: accountId,
        updated_by_account_id: accountId,
      }).select("id, title, status, priority, due_date, working_group_id").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ task: result.data }, { status: 201 });
    }

    throw new RequestError("Unsupported Community update.");
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The Community operation could not be saved.";
    return NextResponse.json({ error }, { status });
  }
}
