import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["nominated", "active", "paused", "completed"]);

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

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This pilot-project request was not accepted." }, { status: 403 });
  }

  try {
    const supabase = await createClient();
    const claims = await supabase.auth.getClaims();
    const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
    if (claims.error || !accountId) throw new RequestError("Sign in as a platform administrator.", 401);

    const hearthland = supabase.schema("hearthland");
    const adminRole = await hearthland
      .from("platform_roles")
      .select("role")
      .eq("account_id", accountId)
      .eq("role", "admin")
      .is("revoked_at", null)
      .maybeSingle();
    if (adminRole.error || !adminRole.data) throw new RequestError("Platform administrator access is required.", 403);

    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Pilot-project details are required.");
    const projectId = cleanString(body.projectId, 40);
    const pilotStatus = cleanString(body.pilotStatus, 30);
    if (!UUID.test(projectId)) throw new RequestError("Choose a valid settlement project.");
    if (!STATUSES.has(pilotStatus)) throw new RequestError("Choose a valid pilot status.");

    const project = await hearthland
      .from("settlement_projects")
      .select("entity_id")
      .eq("entity_id", projectId)
      .maybeSingle();
    if (project.error) throw new Error(project.error.message);
    if (!project.data) throw new RequestError("The settlement project could not be found.", 404);

    const existing = await hearthland
      .from("pilot_projects")
      .select("designated_by_account_id, designated_at, launched_at")
      .eq("project_entity_id", projectId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    const timestamp = new Date().toISOString();
    const result = await hearthland
      .from("pilot_projects")
      .upsert({
        project_entity_id: projectId,
        pilot_status: pilotStatus,
        cohort: cleanString(body.cohort, 120) || null,
        public_summary: cleanString(body.publicSummary, 2000),
        designated_by_account_id: existing.data?.designated_by_account_id ?? accountId,
        designated_at: existing.data?.designated_at ?? timestamp,
        launched_at: pilotStatus === "active" ? existing.data?.launched_at ?? timestamp : existing.data?.launched_at ?? null,
        completed_at: pilotStatus === "completed" ? timestamp : null,
        next_review_at: typeof body.nextReviewAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.nextReviewAt)
          ? new Date(`${body.nextReviewAt}T12:00:00.000Z`).toISOString()
          : null,
        updated_at: timestamp,
      }, { onConflict: "project_entity_id" })
      .select("project_entity_id, pilot_status, cohort, public_summary, designated_at, launched_at, completed_at, next_review_at")
      .single();
    if (result.error) throw new Error(result.error.message);

    return NextResponse.json({ pilot: result.data });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The pilot project could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}
