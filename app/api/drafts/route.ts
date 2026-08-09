import { createClient, getCurrentUser } from "../../../lib/supabase/server";
import {
  normalizeCreationDraftPayload,
  toCreationRpcPayload,
  validateCreationDraft,
} from "../../creation-draft";

const DRAFT_TYPE = "start_community_wizard";

type DraftRow = {
  id: string;
  current_step: number;
  payload: unknown;
  entity_id: string | null;
  completed_at: string | null;
  archived_at: string | null;
  updated_at: string;
};

type DraftRequest = {
  draftId?: unknown;
  currentStep?: unknown;
  payload?: unknown;
};

type CreatedProject = {
  emerging_community_entity_id?: unknown;
  emerging_community_slug?: unknown;
  settlement_project_entity_id?: unknown;
  settlement_project_slug?: unknown;
  publication_status?: unknown;
  idempotent_replay?: unknown;
};

function draftResponse(row: DraftRow) {
  return {
    id: row.id,
    currentStep: row.current_step,
    payload: normalizeCreationDraftPayload(row.payload),
    entityId: row.entity_id,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function currentStep(value: unknown) {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(6, Math.max(1, value))
    : 1;
}

function draftId(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

async function authenticatedClient() {
  const user = await getCurrentUser();
  if (!user) return null;
  return { user, supabase: await createClient() };
}

async function latestDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
) {
  const result = await supabase
    .schema("hearthland")
    .from("creation_drafts")
    .select("id, current_step, payload, entity_id, completed_at, archived_at, updated_at")
    .eq("account_id", accountId)
    .eq("draft_type", DRAFT_TYPE)
    .is("completed_at", null)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) throw result.error;
  return (result.data as DraftRow | null) ?? null;
}

async function draftById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  id: string,
) {
  const result = await supabase
    .schema("hearthland")
    .from("creation_drafts")
    .select("id, current_step, payload, entity_id, completed_at, archived_at, updated_at")
    .eq("id", id)
    .eq("account_id", accountId)
    .eq("draft_type", DRAFT_TYPE)
    .maybeSingle();

  if (result.error) throw result.error;
  return (result.data as DraftRow | null) ?? null;
}

async function saveDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  request: DraftRequest,
) {
  const id = draftId(request.draftId);
  const payload = normalizeCreationDraftPayload(request.payload);
  const step = currentStep(request.currentStep);
  let existing: DraftRow | null = null;

  if (id) {
    existing = await draftById(supabase, accountId, id);
    if (!existing) throw new Error("Community creation draft is unavailable.");
    if (existing.completed_at) return existing;
    if (existing.archived_at) throw new Error("Archived community creation draft cannot be saved.");
  }

  existing ??= await latestDraft(supabase, accountId);
  const values = {
    current_step: step,
    payload,
    updated_at: new Date().toISOString(),
  };

  const result = existing
    ? await supabase
        .schema("hearthland")
        .from("creation_drafts")
        .update(values)
        .eq("id", existing.id)
        .eq("account_id", accountId)
        .is("completed_at", null)
        .is("archived_at", null)
        .select("id, current_step, payload, entity_id, completed_at, archived_at, updated_at")
        .single()
    : await supabase
        .schema("hearthland")
        .from("creation_drafts")
        .insert({
          account_id: accountId,
          draft_type: DRAFT_TYPE,
          ...values,
        })
        .select("id, current_step, payload, entity_id, completed_at, archived_at, updated_at")
        .single();

  if (result.error) throw result.error;
  return result.data as DraftRow;
}

export async function GET() {
  const auth = await authenticatedClient();
  if (!auth) return Response.json({ error: "Sign in to continue your community draft." }, { status: 401 });

  try {
    const row = await latestDraft(auth.supabase, auth.user.id);
    return Response.json({ draft: row ? draftResponse(row) : null });
  } catch (error) {
    console.error("Could not load the community creation draft", error);
    return Response.json({ error: "Your community draft could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authenticatedClient();
  if (!auth) return Response.json({ error: "Sign in to save your community draft." }, { status: 401 });

  let body: DraftRequest;
  try {
    body = await request.json() as DraftRequest;
  } catch {
    return Response.json({ error: "The draft request is not valid JSON." }, { status: 400 });
  }

  try {
    const row = await saveDraft(auth.supabase, auth.user.id, body);
    return Response.json({ draft: draftResponse(row) });
  } catch (error) {
    console.error("Could not save the community creation draft", error);
    return Response.json({ error: "Your community draft could not be saved." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticatedClient();
  if (!auth) return Response.json({ error: "Sign in before creating a project." }, { status: 401 });

  let body: DraftRequest;
  try {
    body = await request.json() as DraftRequest;
  } catch {
    return Response.json({ error: "The creation request is not valid JSON." }, { status: 400 });
  }

  const payload = normalizeCreationDraftPayload(body.payload);
  const suppliedDraftId = body.draftId !== undefined && body.draftId !== null && body.draftId !== "";
  const requestedDraftId = draftId(body.draftId);
  if (suppliedDraftId && !requestedDraftId) {
    return Response.json({ error: "The community draft ID is not valid." }, { status: 400 });
  }

  try {
    let row = requestedDraftId
      ? await draftById(auth.supabase, auth.user.id, requestedDraftId)
      : null;

    if (requestedDraftId && !row) {
      return Response.json({ error: "The community creation draft is unavailable." }, { status: 404 });
    }
    if (row?.archived_at && !row.completed_at) {
      return Response.json({ error: "This community creation draft has been archived." }, { status: 409 });
    }

    // Completed drafts deliberately bypass payload validation: their UUID is
    // the idempotency key, so a retry only retrieves the committed result.
    if (!row?.completed_at) {
      const invalid = validateCreationDraft(payload);
      if (invalid) {
        return Response.json({ error: invalid.error, step: invalid.step }, { status: 422 });
      }
    }

    row ??= await saveDraft(auth.supabase, auth.user.id, {
      ...body,
      currentStep: 6,
      payload,
    });

    const rpcResult = await auth.supabase
      .schema("hearthland")
      .rpc("create_emerging_community_project", {
        draft_id: row.id,
        draft_payload: payload,
        payload: toCreationRpcPayload(payload),
      });

    if (rpcResult.error) throw rpcResult.error;
    const created = rpcResult.data as CreatedProject | null;
    const projectId = typeof created?.settlement_project_entity_id === "string"
      ? created.settlement_project_entity_id
      : null;
    const projectSlug = typeof created?.settlement_project_slug === "string"
      ? created.settlement_project_slug
      : null;
    const communityId = typeof created?.emerging_community_entity_id === "string"
      ? created.emerging_community_entity_id
      : null;
    const communitySlug = typeof created?.emerging_community_slug === "string"
      ? created.emerging_community_slug
      : null;

    if (!projectId || !projectSlug || !communityId || !communitySlug) {
      throw new Error("The project RPC returned an incomplete result.");
    }

    const status = typeof created?.publication_status === "string" ? created.publication_status : "draft";
    const replayed = created?.idempotent_replay === true;
    return Response.json({
      ok: true,
      replayed,
      project: { id: projectId, slug: projectSlug, path: `/projects/${projectSlug}`, status },
      emergingCommunity: {
        id: communityId,
        slug: communitySlug,
        path: `/emerging-communities/${communitySlug}`,
        status,
      },
    }, { status: replayed ? 200 : 201 });
  } catch (error) {
    console.error("Could not create the emerging community project", error);
    return Response.json({ error: "The project could not be created. Your draft is still saved." }, { status: 500 });
  }
}
