import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEACHING_TYPES = new Set(["practical", "theoretical", "both"]);

type JsonRecord = Record<string, unknown>;

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function context() {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
  if (claims.error || !accountId) throw new RequestError("Sign in to save learning preferences.", 401);
  const hearthland = supabase.schema("hearthland");
  const [account, profile] = await Promise.all([
    hearthland
      .from("accounts")
      .select("account_status")
      .eq("id", accountId)
      .maybeSingle(),
    hearthland
      .from("person_profiles")
      .select("entity_id")
      .eq("account_id", accountId)
      .is("archived_at", null)
      .maybeSingle(),
  ]);
  if (account.error || profile.error) {
    throw new Error(account.error?.message ?? profile.error?.message);
  }
  if (account.data?.account_status !== "active") {
    throw new RequestError("This account cannot change learning preferences.", 403);
  }
  return {
    hearthland,
    accountId,
    profileEntityId: typeof profile.data?.entity_id === "string" ? profile.data.entity_id : null,
  };
}

export async function GET() {
  try {
    const { hearthland, accountId, profileEntityId } = await context();
    const [learning, teaching] = await Promise.all([
      hearthland
        .from("learning_topic_interests")
        .select("learning_topic_entity_id")
        .eq("account_id", accountId),
      profileEntityId
        ? hearthland
            .from("profile_teaching_topics")
            .select("learning_topic_entity_id, teaching_type")
            .eq("profile_entity_id", profileEntityId)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (learning.error || teaching.error) throw new Error(learning.error?.message ?? teaching.error?.message);
    return NextResponse.json({
      learningTopicIds: (learning.data ?? []).map((row) => row.learning_topic_entity_id),
      teachingTopics: teaching.data ?? [],
    });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "Learning preferences could not be loaded.";
    return NextResponse.json({ error }, { status });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This learning request was not accepted." }, { status: 403 });
  }

  try {
    const { hearthland, accountId, profileEntityId } = await context();
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Learning preference details are required.");
    const topicId = typeof body.topicId === "string" ? body.topicId.trim() : "";
    const action = body.action;
    const enabled = body.enabled !== false;
    if (!UUID.test(topicId)) throw new RequestError("Choose a valid learning topic.");
    if (action !== "learn" && action !== "teach") throw new RequestError("Choose a learning preference.");

    const topic = await hearthland
      .from("entities")
      .select("id")
      .eq("id", topicId)
      .eq("entity_type", "learning_topic")
      .eq("publication_status", "published")
      .is("archived_at", null)
      .maybeSingle();
    if (topic.error) throw new Error(topic.error.message);
    if (!topic.data) throw new RequestError("This learning topic is unavailable.", 404);

    if (action === "learn") {
      const result = enabled
        ? await hearthland.from("learning_topic_interests").upsert({
            account_id: accountId,
            learning_topic_entity_id: topicId,
          }, { onConflict: "account_id,learning_topic_entity_id" })
        : await hearthland.from("learning_topic_interests").delete()
            .eq("account_id", accountId)
            .eq("learning_topic_entity_id", topicId);
      if (result.error) throw new Error(result.error.message);
    } else {
      if (!profileEntityId) {
        throw new RequestError("Complete your Hearthland profile before adding teaching topics.", 409);
      }
      const teachingType = typeof body.teachingType === "string" ? body.teachingType : "both";
      if (!TEACHING_TYPES.has(teachingType)) throw new RequestError("Choose a valid teaching type.");
      if (enabled) {
        const profileResult = await hearthland.from("teaching_profiles").upsert({
          profile_entity_id: profileEntityId,
          is_available: true,
        }, { onConflict: "profile_entity_id" });
        if (profileResult.error) throw new Error(profileResult.error.message);
        const topicResult = await hearthland.from("profile_teaching_topics").upsert({
          profile_entity_id: profileEntityId,
          learning_topic_entity_id: topicId,
          teaching_type: teachingType,
        }, { onConflict: "profile_entity_id,learning_topic_entity_id" });
        if (topicResult.error) throw new Error(topicResult.error.message);
      } else {
        const result = await hearthland.from("profile_teaching_topics").delete()
          .eq("profile_entity_id", profileEntityId)
          .eq("learning_topic_entity_id", topicId);
        if (result.error) throw new Error(result.error.message);
      }
    }

    return NextResponse.json({ ok: true, action, topicId, enabled });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The learning preference could not be saved.";
    return NextResponse.json({ error }, { status });
  }
}
