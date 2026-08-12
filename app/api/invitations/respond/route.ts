import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSES = new Set(["accepted", "declined"]);

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function entityPath(type: unknown, slug: unknown) {
  if (typeof slug !== "string" || !slug) return "/dashboard";
  return ({
    community: `/communities/${slug}`,
    emerging_community: `/emerging-communities/${slug}`,
    settlement_project: `/projects/${slug}`,
    building_camp: `/building-camps/${slug}`,
  } as Record<string, string>)[String(type)] ?? "/dashboard";
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This invitation response was not accepted." }, { status: 403 });
  }
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invitation response is required." }, { status: 400 });
    }
    const token = typeof (body as Record<string, unknown>).token === "string"
      ? (body as Record<string, unknown>).token as string
      : "";
    const invitationId = typeof (body as Record<string, unknown>).invitationId === "string"
      ? (body as Record<string, unknown>).invitationId as string
      : "";
    const invitationLocator = TOKEN.test(token) ? token : UUID.test(invitationId) ? invitationId : "";
    const responseStatus = typeof (body as Record<string, unknown>).status === "string"
      ? (body as Record<string, unknown>).status as string
      : "";
    if (!invitationLocator || !RESPONSES.has(responseStatus)) {
      return NextResponse.json({ error: "Invitation response is invalid." }, { status: 400 });
    }

    const supabase = await createClient();
    const claims = await supabase.auth.getClaims();
    const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
    if (claims.error || !accountId) {
      return NextResponse.json({ error: "Sign in before responding to this invitation." }, { status: 401 });
    }
    const account = await supabase
      .schema("hearthland")
      .from("accounts")
      .select("onboarding_status")
      .eq("id", accountId)
      .maybeSingle();
    if (account.error) throw new Error(account.error.message);
    if (responseStatus === "accepted" && account.data?.onboarding_status !== "complete" && account.data?.onboarding_status !== "skipped") {
      return NextResponse.json({
        error: "Complete your basic Hearthland profile before accepting.",
        onboardingRequired: true,
      }, { status: 409 });
    }

    const result = await supabase
      .schema("hearthland")
      .rpc("respond_to_invitation", {
        raw_token: invitationLocator,
        response_status: responseStatus,
      });
    if (result.error) {
      if (result.error.message.includes("INVITATION_RECIPIENT_MISMATCH")) {
        return NextResponse.json({ error: "This invitation belongs to another account." }, { status: 403 });
      }
      if (result.error.message.includes("INVITATION_NOT_FOUND")) {
        return NextResponse.json({ error: "This invitation could not be found." }, { status: 404 });
      }
      if (["INVITATION_EXPIRED", "INVITATION_REVOKED", "INVITATION_ALREADY_RESPONDED", "INVITATION_UNAVAILABLE"].some((code) => result.error?.message.includes(code))) {
        return NextResponse.json({ error: "This invitation is no longer available." }, { status: 409 });
      }
      throw new Error(result.error.message);
    }
    const invitation = Array.isArray(result.data) ? result.data[0] : result.data;
    const record = invitation && typeof invitation === "object"
      ? invitation as Record<string, unknown>
      : {};
    let entityType = record.entity_type;
    if (typeof entityType !== "string" && typeof record.entity_id === "string") {
      const entity = await supabase.schema("hearthland").from("entities")
        .select("entity_type").eq("id", record.entity_id).maybeSingle();
      entityType = entity.data?.entity_type;
    }
    return NextResponse.json({
      invitation: record,
      next: entityPath(entityType, record.entity_slug),
    });
  } catch {
    return NextResponse.json({ error: "The invitation response could not be saved." }, { status: 500 });
  }
}
