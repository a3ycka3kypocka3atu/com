import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLICATION_STATUSES = new Set(["new", "reviewing", "contacted", "accepted", "waiting_list", "declined", "cancelled"]);
const BUILD_STATUSES = new Set(["planned", "preparing", "in_progress", "completed", "postponed"]);
const PREPARATION_TYPES = new Set(["what_to_bring", "arrival", "transport", "accommodation", "food", "tools", "safety", "contact", "other"]);
const SCHEDULE_TYPES = new Set(["build", "practical_workshop", "lesson", "community", "food", "wellbeing", "culture", "free_time", "other"]);
const SESSION_MODES = new Set(["practical", "theoretical", "both"]);
const RESULT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const RESULT_IMAGE_MAX_BYTES = 15 * 1024 * 1024;

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

function dateValue(value: unknown, label: string) {
  const candidate = cleanString(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) throw new RequestError(`${label} is required.`);
  return candidate;
}

async function managerContext(campId: string) {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
  if (claims.error || !accountId) throw new RequestError("Sign in to manage this Building Camp.", 401);
  const hearthland = supabase.schema("hearthland");

  const [entity, role, platformRole] = await Promise.all([
    hearthland.from("entities").select("id, owner_account_id").eq("id", campId).eq("entity_type", "building_camp").is("archived_at", null).maybeSingle(),
    hearthland.from("entity_roles").select("role").eq("entity_id", campId).eq("account_id", accountId).eq("status", "active").in("role", ["owner", "administrator"]).maybeSingle(),
    hearthland.from("platform_roles").select("role").eq("account_id", accountId).eq("role", "admin").is("revoked_at", null).maybeSingle(),
  ]);
  if (entity.error || role.error || platformRole.error) throw new Error(entity.error?.message ?? role.error?.message ?? platformRole.error?.message);
  if (!entity.data) throw new RequestError("The Building Camp could not be found.", 404);
  if (entity.data.owner_account_id !== accountId && !role.data && !platformRole.data) {
    throw new RequestError("Camp owner or administrator access is required.", 403);
  }
  return { supabase, hearthland, accountId };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This Camp update was not accepted." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const campId = cleanUuid(id, "Building Camp");
    const { supabase, hearthland, accountId } = await managerContext(campId);
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Camp update details are required.");
    const action = cleanString(body.action, 60);

    if (action === "application_status") {
      const applicationId = cleanUuid(body.applicationId, "Application");
      const status = cleanString(body.status, 30);
      if (!APPLICATION_STATUSES.has(status)) throw new RequestError("Choose a valid application status.");
      const current = await hearthland.from("camp_applications")
        .select("id, status")
        .eq("id", applicationId)
        .eq("camp_entity_id", campId)
        .maybeSingle();
      if (current.error) throw new Error(current.error.message);
      if (!current.data) throw new RequestError("The application could not be updated.", 404);
      if (current.data.status === "accepted" && status !== "accepted") {
        throw new RequestError("Accepted applications are managed through the participant list.", 409);
      }
      const result = await hearthland.from("camp_applications")
        .update({ status })
        .eq("id", applicationId)
        .eq("camp_entity_id", campId)
        .select("id, status, updated_at")
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new RequestError("The application could not be updated.", 404);
      return NextResponse.json({ application: result.data });
    }

    if (action === "participant_status") {
      const participantId = cleanUuid(body.participantId, "Participant");
      const status = cleanString(body.status, 30);
      if (!["accepted", "checked_in", "completed", "cancelled", "no_show"].includes(status)) {
        throw new RequestError("Choose a valid participant status.");
      }
      const timestamp = new Date().toISOString();
      const result = await hearthland.from("camp_participants")
        .update({
          participant_status: status,
          checked_in_at: status === "checked_in" ? timestamp : null,
          completed_at: status === "completed" ? timestamp : null,
        })
        .eq("id", participantId)
        .eq("camp_entity_id", campId)
        .select("id, participant_status, checked_in_at, completed_at")
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new RequestError("The participant could not be updated.", 404);
      return NextResponse.json({ participant: result.data });
    }

    if (action === "build_progress") {
      const buildItemId = cleanUuid(body.buildItemId, "Build item");
      const status = cleanString(body.status, 30);
      const progress = Number(body.progressPercent);
      if (!BUILD_STATUSES.has(status)) throw new RequestError("Choose a valid build status.");
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new RequestError("Progress must be between 0 and 100.");
      const result = await hearthland.from("camp_build_items")
        .update({
          status,
          progress_percent: progress,
          progress_note: cleanString(body.progressNote, 1200),
          progress_updated_by_account_id: accountId,
          progress_updated_at: new Date().toISOString(),
        })
        .eq("id", buildItemId)
        .eq("camp_entity_id", campId)
        .select("id, status, progress_percent, progress_note, progress_updated_at")
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new RequestError("The build item could not be updated.", 404);
      return NextResponse.json({ buildItem: result.data });
    }

    if (action === "build_media") {
      const buildItemId = cleanUuid(body.buildItemId, "Build item");
      const objectPath = cleanString(body.objectPath, 1024);
      const mimeType = cleanString(body.mimeType, 120).toLowerCase();
      const sizeBytes = Number(body.sizeBytes);
      const expectedPrefix = `entities/${campId}/results/${buildItemId}/`;
      const fileName = objectPath.slice(expectedPrefix.length);
      if (
        !objectPath.startsWith(expectedPrefix)
        || !fileName
        || fileName.includes("/")
        || fileName.includes("\\")
        || fileName.includes("..")
        || Array.from(fileName).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      ) {
        throw new RequestError("The result image path is invalid.");
      }
      if (!RESULT_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new RequestError("Use a JPEG, PNG or WebP result image.");
      }
      if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > RESULT_IMAGE_MAX_BYTES) {
        throw new RequestError("Result images must be smaller than 15 MB.");
      }

      const buildItem = await hearthland
        .from("camp_build_items")
        .select("id, name")
        .eq("id", buildItemId)
        .eq("camp_entity_id", campId)
        .maybeSingle();
      if (buildItem.error) throw new Error(buildItem.error.message);
      if (!buildItem.data) throw new RequestError("The build item could not be found.", 404);

      const object = await supabase.storage
        .from("hearthland-entity-media")
        .list(`entities/${campId}/results/${buildItemId}`, {
          search: fileName,
          limit: 2,
        });
      if (object.error || !object.data?.some((item) => item.name === fileName)) {
        throw new RequestError("Upload the result image before registering it.", 409);
      }

      const asset = await hearthland
        .from("media_assets")
        .insert({
          entity_id: campId,
          uploader_account_id: accountId,
          bucket_id: "hearthland-entity-media",
          object_path: objectPath,
          media_kind: "image",
          category: "camp_result",
          alt_text: cleanString(body.altText, 500) || `${buildItem.data.name} result`,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          visibility: "public",
        })
        .select("id, object_path, alt_text")
        .single();
      if (asset.error) {
        await supabase.storage.from("hearthland-entity-media").remove([objectPath]);
        throw new Error(asset.error.message);
      }

      const link = await hearthland.from("camp_build_item_media").insert({
        build_item_id: buildItemId,
        media_asset_id: asset.data.id,
      });
      if (link.error) {
        await hearthland.from("media_assets").delete().eq("id", asset.data.id);
        await supabase.storage.from("hearthland-entity-media").remove([objectPath]);
        throw new Error(link.error.message);
      }
      return NextResponse.json({ media: asset.data }, { status: 201 });
    }

    if (action === "announcement") {
      const title = cleanString(body.title, 180);
      const announcementBody = cleanString(body.body, 5000);
      if (!title || !announcementBody) throw new RequestError("Announcement title and message are required.");
      const audience = body.audience === "public" ? "public" : "participants";
      const result = await hearthland.from("camp_announcements").insert({
        camp_entity_id: campId,
        title,
        body: announcementBody,
        audience,
        notify_participants: body.notifyParticipants !== false,
        created_by_account_id: accountId,
      }).select("id, title, body, audience, published_at").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ announcement: result.data }, { status: 201 });
    }

    if (action === "preparation") {
      const sectionType = cleanString(body.sectionType, 40);
      if (!PREPARATION_TYPES.has(sectionType)) throw new RequestError("Choose a valid preparation section.");
      const result = await hearthland.from("camp_preparation_sections").upsert({
        camp_entity_id: campId,
        section_type: sectionType,
        title: cleanString(body.title, 180) || sectionType.replaceAll("_", " "),
        body: cleanString(body.body, 6000),
        audience: body.audience === "public" ? "public" : "participants",
        sort_order: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        created_by_account_id: accountId,
      }, { onConflict: "camp_entity_id,section_type" })
        .select("id, section_type, title, body, audience, sort_order")
        .single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ section: result.data });
    }

    if (action === "workshop") {
      const itemType = cleanString(body.itemType, 40) || "practical_workshop";
      if (!SCHEDULE_TYPES.has(itemType)) throw new RequestError("Choose a valid programme type.");
      const sessionMode = cleanString(body.sessionMode, 30);
      if (sessionMode && !SESSION_MODES.has(sessionMode)) throw new RequestError("Choose a valid workshop mode.");
      const title = cleanString(body.title, 220);
      if (!title) throw new RequestError("Workshop title is required.");
      const result = await hearthland.from("camp_schedule_items").insert({
        camp_entity_id: campId,
        scheduled_date: dateValue(body.scheduledDate, "Workshop date"),
        start_time: cleanString(body.startTime, 8) || null,
        end_time: cleanString(body.endTime, 8) || null,
        title,
        item_type: itemType,
        leader_account_id: cleanUuid(body.leaderAccountId, "Workshop leader", true),
        learning_topic_entity_id: cleanUuid(body.learningTopicEntityId, "Learning topic", true),
        build_item_id: cleanUuid(body.buildItemId, "Build item", true),
        capacity: body.capacity === null || body.capacity === "" || body.capacity === undefined ? null : Number(body.capacity),
        session_mode: sessionMode || null,
        audience: body.audience === "participants" ? "participants" : "public",
        location: cleanString(body.location, 300) || null,
        description: cleanString(body.description, 3000),
      }).select("id, scheduled_date, start_time, end_time, title, item_type, session_mode, audience").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ workshop: result.data }, { status: 201 });
    }

    if (action === "camp_result") {
      const publicationStatus = body.publicationStatus === "published" ? "published" : "draft";
      const result = await hearthland.from("camp_results").upsert({
        camp_entity_id: campId,
        publication_status: publicationStatus,
        what_we_built: cleanString(body.whatWeBuilt, 6000),
        what_we_learned: cleanString(body.whatWeLearned, 6000),
        main_results: cleanString(body.mainResults, 6000),
        what_happens_next: cleanString(body.whatHappensNext, 6000),
        published_at: publicationStatus === "published" ? new Date().toISOString() : null,
        created_by_account_id: accountId,
        updated_by_account_id: accountId,
      }, { onConflict: "camp_entity_id" })
        .select("camp_entity_id, publication_status, participants_count, masters_count, workshops_count, duration_days, published_at")
        .single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ result: result.data });
    }

    throw new RequestError("Unsupported Camp update.");
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The Building Camp could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}
