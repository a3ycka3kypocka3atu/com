import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

const CATEGORIES = new Set([
  "confusing",
  "bug",
  "feature_request",
  "community_project_suggestion",
  "other",
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanMessage(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 4000) : "";
}

function cleanPagePath(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value, "https://hearthland.invalid");
    const pathname = parsed.pathname
      .replace(/^\/invite\/[^/]+/i, "/invite/[secure-link]")
      .slice(0, 500);
    return pathname.startsWith("/") ? pathname : null;
  } catch {
    return null;
  }
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
    return NextResponse.json({ error: "This feedback request was not accepted." }, { status: 403 });
  }

  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Feedback must be a JSON object." }, { status: 400 });
    }
    if (typeof body.website === "string" && body.website.trim()) {
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    const category = typeof body.category === "string" && CATEGORIES.has(body.category)
      ? body.category
      : "other";
    const message = cleanMessage(body.message);
    if (message.length < 12) {
      return NextResponse.json({ error: "Please share at least a short sentence." }, { status: 400 });
    }

    const supabase = await createClient();
    const claims = await supabase.auth.getClaims();
    const accountId = typeof claims.data?.claims?.sub === "string"
      ? claims.data.claims.sub
      : null;
    const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
    const insert = supabase
      .schema("hearthland")
      .from("feedback_submissions")
      .insert({
        account_id: accountId,
        category,
        message,
        page_url: cleanPagePath(body.pageUrl),
        user_agent: userAgent,
        metadata: {},
      });
    const result = accountId
      ? await insert.select("id").single()
      : await insert;

    if (result.error) {
      console.error("[feedback] insert failed", result.error.code);
      return NextResponse.json({ error: "Feedback could not be saved right now." }, { status: 500 });
    }
    const inserted = accountId && result.data && !Array.isArray(result.data)
      ? result.data as { id?: unknown }
      : null;
    return NextResponse.json({
      ok: true,
      ...(typeof inserted?.id === "string" ? { id: inserted.id } : {}),
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Feedback could not be saved right now." }, { status: 500 });
  }
}
