import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../../../lib/supabase/server";
import CampOperations, { type CampOperationsData, type PersonSummary } from "./camp-operations";
import styles from "./camp-operations.module.css";

export const metadata: Metadata = {
  title: "Manage Building Camp",
  description: "Applications, participants, build progress and programme operations for a Hearthland Building Camp.",
};

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export default async function ManageCampPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/manage/camps/${id}`)}`);

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");

  const [entityResult, roleResult, platformRoleResult] = await Promise.all([
    hearthland
      .from("entities")
      .select("id, title, slug, short_description, publication_status, owner_account_id")
      .eq("id", id)
      .eq("entity_type", "building_camp")
      .is("archived_at", null)
      .maybeSingle(),
    hearthland
      .from("entity_roles")
      .select("role")
      .eq("entity_id", id)
      .eq("account_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "administrator"])
      .maybeSingle(),
    hearthland
      .from("platform_roles")
      .select("role")
      .eq("account_id", user.id)
      .eq("role", "admin")
      .is("revoked_at", null)
      .maybeSingle(),
  ]);

  if (entityResult.error || roleResult.error || platformRoleResult.error) {
    return (
      <main className={styles.statePage}>
        <span>CAMP OPERATIONS</span>
        <h1>This workspace could not be loaded.</h1>
        <p>Please try again. If the problem continues, ask a platform administrator to verify your Camp role.</p>
        <Link href="/manage" prefetch={false}>Return to Manage →</Link>
      </main>
    );
  }

  const entity = entityResult.data;
  if (!entity) notFound();
  const canManage = entity.owner_account_id === user.id || Boolean(roleResult.data) || Boolean(platformRoleResult.data);
  if (!canManage) {
    return (
      <main className={styles.statePage}>
        <span>CAMP OPERATIONS</span>
        <h1>Camp owner or administrator access is required.</h1>
        <p>You are signed in, but this operational workspace is private to the Camp team.</p>
        <Link href="/dashboard" prefetch={false}>Return to dashboard →</Link>
      </main>
    );
  }

  const [
    campResult,
    applicationsResult,
    participantsResult,
    teamResult,
    buildItemsResult,
    announcementsResult,
    preparationResult,
    scheduleResult,
    resultResult,
    campTopicsResult,
  ] = await Promise.all([
    hearthland.from("building_camps").select("location, country, region, start_date, end_date, purpose, max_participants, application_deadline, languages, accommodation_type, food_model, contribution_details, camp_status").eq("entity_id", id).maybeSingle(),
    hearthland.from("camp_applications").select("id, applicant_account_id, selected_roles, message, skills_offered, learning_interests, arrival_date, departure_date, accommodation_requirement, resources_offered, future_community_interest, status, created_at").eq("camp_entity_id", id).is("archived_at", null).order("created_at", { ascending: false }),
    hearthland.from("camp_participants").select("id, account_id, application_id, roles, participant_status, joined_via, accepted_at, checked_in_at, completed_at").eq("camp_entity_id", id).order("accepted_at", { ascending: false }),
    hearthland.from("camp_team").select("id, account_id, role, is_master, public_visibility").eq("camp_entity_id", id).order("is_master", { ascending: false }),
    hearthland.from("camp_build_items").select("id, name, description, category, lead_account_id, status, target_participants_min, target_participants_max, materials_note, tools_note, sort_order, progress_percent, progress_note, progress_updated_at").eq("camp_entity_id", id).order("sort_order"),
    hearthland.from("camp_announcements").select("id, title, body, audience, notify_participants, published_at, created_by_account_id").eq("camp_entity_id", id).is("archived_at", null).order("published_at", { ascending: false }).limit(30),
    hearthland.from("camp_preparation_sections").select("id, section_type, title, body, audience, sort_order").eq("camp_entity_id", id).order("sort_order"),
    hearthland.from("camp_schedule_items").select("id, scheduled_date, start_time, end_time, title, item_type, leader_account_id, learning_topic_entity_id, build_item_id, capacity, session_mode, audience, location, description").eq("camp_entity_id", id).order("scheduled_date").order("start_time"),
    hearthland.from("camp_results").select("camp_entity_id, publication_status, what_we_built, what_we_learned, main_results, what_happens_next, participants_count, masters_count, workshops_count, duration_days, published_at").eq("camp_entity_id", id).maybeSingle(),
    hearthland.from("camp_learning_topics").select("learning_topic_entity_id").eq("camp_entity_id", id),
  ]);

  const requiredResults = [campResult, applicationsResult, participantsResult, teamResult, buildItemsResult, announcementsResult, preparationResult, scheduleResult, resultResult, campTopicsResult];
  if (requiredResults.some((result) => result.error)) {
    return (
      <main className={styles.statePage}>
        <span>CAMP OPERATIONS</span>
        <h1>Some Camp records could not be loaded.</h1>
        <p>Your access was verified, but the operational data is temporarily unavailable.</p>
        <Link href="/manage" prefetch={false}>Return to Manage →</Link>
      </main>
    );
  }
  if (!campResult.data) notFound();

  const applicationRows = applicationsResult.data ?? [];
  const applicationApplicantIds = Array.from(new Set(
    applicationRows.map((row) => text(row.applicant_account_id)).filter(Boolean),
  ));
  const applicationApplicantSet = new Set(applicationApplicantIds);
  const accountIds = Array.from(new Set([
    ...applicationApplicantIds,
    ...(participantsResult.data ?? []).map((row) => text(row.account_id)),
    ...(teamResult.data ?? []).map((row) => text(row.account_id)),
    ...(announcementsResult.data ?? []).map((row) => text(row.created_by_account_id)),
  ].filter(Boolean)));

  const applicantByApplicationId = new Map(
    applicationRows.map((row) => [text(row.id), text(row.applicant_account_id)]),
  );
  const applicantDetailsResult = await hearthland.rpc(
    "get_camp_application_manager_details",
    { target_camp_entity_id: id },
  );
  const people: Record<string, PersonSummary> = Object.fromEntries(
    accountIds.map((accountId) => [accountId, {
      accountId,
      displayName: "Hearthland member",
      headline: "",
      location: "",
    }]),
  );

  const applicantDetailsAvailable = !applicantDetailsResult.error;
  if (applicantDetailsAvailable) {
    const detailRows = Array.isArray(applicantDetailsResult.data) ? applicantDetailsResult.data : [];
    for (const detail of detailRows) {
      const applicationId = text(detail.application_id);
      const accountId = text(detail.applicant_account_id);
      if (!accountId || applicantByApplicationId.get(applicationId) !== accountId) continue;
      people[accountId] = {
        accountId,
        displayName: text(detail.display_name) || "Hearthland applicant",
        headline: text(detail.headline),
        location: text(detail.location_summary),
      };
    }
  }

  // Keep direct profile reads only as a rolling-deployment fallback for Camp
  // applicants. Once the RPC is present, applicant details never depend on or
  // bypass the applicant's base profile, account, or location RLS policies.
  const directoryAccountIds = applicantDetailsAvailable
    ? accountIds.filter((accountId) => !applicationApplicantSet.has(accountId))
    : accountIds;
  const [profilesResult, accountsResult] = await Promise.all([
    directoryAccountIds.length
      ? hearthland.from("person_profiles").select("entity_id, account_id, display_name, headline").in("account_id", directoryAccountIds).is("archived_at", null)
      : Promise.resolve({ data: [], error: null }),
    directoryAccountIds.length
      ? hearthland.from("accounts").select("id, display_name").in("id", directoryAccountIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const profileIds = (profilesResult.data ?? []).map((row) => text(row.entity_id)).filter(Boolean);
  const locationsResult = profileIds.length
    ? await hearthland.from("profile_locations").select("profile_entity_id, country, region, city").in("profile_entity_id", profileIds)
    : { data: [], error: null };

  const locations = new Map((locationsResult.data ?? []).map((location) => [text(location.profile_entity_id), location]));
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [text(profile.account_id), profile]));
  const accounts = new Map((accountsResult.data ?? []).map((account) => [text(account.id), text(account.display_name)]));
  for (const accountId of directoryAccountIds) {
    const profile = profiles.get(accountId);
    const location = profile ? locations.get(text(profile.entity_id)) : undefined;
    people[accountId] = {
      accountId,
      displayName: text(profile?.display_name) || accounts.get(accountId) || "Hearthland member",
      headline: text(profile?.headline),
      location: [text(location?.city), text(location?.region), text(location?.country)].filter(Boolean).join(", "),
    };
  }

  const topicIds = (campTopicsResult.data ?? []).map((row) => text(row.learning_topic_entity_id)).filter(Boolean);
  const topicsResult = topicIds.length
    ? await hearthland.from("entities").select("id, title").in("id", topicIds).eq("entity_type", "learning_topic").order("title")
    : { data: [], error: null };

  const buildItemIds = (buildItemsResult.data ?? []).map((row) => text(row.id)).filter(Boolean);
  const mediaLinksResult = buildItemIds.length
    ? await hearthland.from("camp_build_item_media").select("build_item_id, media_asset_id, sort_order").in("build_item_id", buildItemIds).order("sort_order")
    : { data: [], error: null };
  const mediaAssetIds = Array.from(new Set(
    (mediaLinksResult.data ?? []).map((row) => text(row.media_asset_id)).filter(Boolean),
  ));
  const mediaAssetsResult = mediaAssetIds.length
    ? await hearthland.from("media_assets").select("id, bucket_id, object_path, alt_text").in("id", mediaAssetIds).eq("visibility", "public").is("archived_at", null)
    : { data: [], error: null };
  const resultMediaByBuildItem = new Map<string, Array<{ id: string; altText: string; url: string }>>();
  if (!mediaLinksResult.error && !mediaAssetsResult.error) {
    const resultAssets = (mediaAssetsResult.data ?? []).filter(
      (asset) => text(asset.bucket_id) === "hearthland-entity-media" && Boolean(text(asset.object_path)),
    );
    const signedResult = resultAssets.length
      ? await supabase.storage.from("hearthland-entity-media").createSignedUrls(
          resultAssets.map((asset) => text(asset.object_path)),
          3600,
        )
      : { data: [], error: null };
    if (!signedResult.error) {
      const assets = new Map(resultAssets.map((asset, index) => [text(asset.id), {
        id: text(asset.id),
        altText: text(asset.alt_text),
        url: signedResult.data?.[index]?.signedUrl ?? "",
      }]));
      for (const link of mediaLinksResult.data ?? []) {
        const asset = assets.get(text(link.media_asset_id));
        if (!asset?.url) continue;
        const buildItemId = text(link.build_item_id);
        resultMediaByBuildItem.set(buildItemId, [
          ...(resultMediaByBuildItem.get(buildItemId) ?? []),
          asset,
        ]);
      }
    }
  }

  const camp = campResult.data;
  const participants = (participantsResult.data ?? []).map((row) => ({
    id: text(row.id), accountId: text(row.account_id), applicationId: nullableText(row.application_id), roles: stringArray(row.roles),
    participantStatus: text(row.participant_status), joinedVia: text(row.joined_via), acceptedAt: text(row.accepted_at), checkedInAt: nullableText(row.checked_in_at), completedAt: nullableText(row.completed_at),
  }));
  const applications = (applicationsResult.data ?? []).map((row) => ({
    id: text(row.id), applicantAccountId: text(row.applicant_account_id), selectedRoles: stringArray(row.selected_roles), message: text(row.message),
    skillsOffered: text(row.skills_offered), learningInterests: text(row.learning_interests), arrivalDate: nullableText(row.arrival_date), departureDate: nullableText(row.departure_date), accommodationRequirement: nullableText(row.accommodation_requirement), resourcesOffered: text(row.resources_offered), futureCommunityInterest: nullableText(row.future_community_interest), status: text(row.status), createdAt: text(row.created_at),
  }));

  const data: CampOperationsData = {
    camp: {
      id,
      title: text(entity.title),
      slug: text(entity.slug),
      shortDescription: text(entity.short_description),
      publicationStatus: text(entity.publication_status),
      location: text(camp.location),
      country: text(camp.country),
      region: nullableText(camp.region),
      startDate: text(camp.start_date),
      endDate: text(camp.end_date),
      purpose: text(camp.purpose),
      maxParticipants: Number(camp.max_participants) || 0,
      applicationDeadline: nullableText(camp.application_deadline),
      languages: stringArray(camp.languages),
      accommodationType: nullableText(camp.accommodation_type),
      foodModel: nullableText(camp.food_model),
      contributionDetails: nullableText(camp.contribution_details),
      campStatus: text(camp.camp_status),
    },
    people,
    applications,
    participants,
    team: (teamResult.data ?? []).map((row) => ({ id: text(row.id), accountId: text(row.account_id), role: text(row.role), isMaster: Boolean(row.is_master), publicVisibility: Boolean(row.public_visibility) })),
    buildItems: (buildItemsResult.data ?? []).map((row) => ({ id: text(row.id), name: text(row.name), description: text(row.description), category: nullableText(row.category), leadAccountId: nullableText(row.lead_account_id), status: text(row.status), targetParticipantsMin: typeof row.target_participants_min === "number" ? row.target_participants_min : null, targetParticipantsMax: typeof row.target_participants_max === "number" ? row.target_participants_max : null, materialsNote: text(row.materials_note), toolsNote: text(row.tools_note), sortOrder: Number(row.sort_order) || 0, progressPercent: Number(row.progress_percent) || 0, progressNote: text(row.progress_note), progressUpdatedAt: nullableText(row.progress_updated_at), resultImages: resultMediaByBuildItem.get(text(row.id)) ?? [] })),
    announcements: (announcementsResult.data ?? []).map((row) => ({ id: text(row.id), title: text(row.title), body: text(row.body), audience: text(row.audience), notifyParticipants: Boolean(row.notify_participants), publishedAt: text(row.published_at), createdByAccountId: text(row.created_by_account_id) })),
    preparation: (preparationResult.data ?? []).map((row) => ({ id: text(row.id), sectionType: text(row.section_type), title: text(row.title), body: text(row.body), audience: text(row.audience), sortOrder: Number(row.sort_order) || 0 })),
    schedule: (scheduleResult.data ?? []).map((row) => ({ id: text(row.id), scheduledDate: text(row.scheduled_date), startTime: nullableText(row.start_time), endTime: nullableText(row.end_time), title: text(row.title), itemType: text(row.item_type), leaderAccountId: nullableText(row.leader_account_id), learningTopicEntityId: nullableText(row.learning_topic_entity_id), buildItemId: nullableText(row.build_item_id), capacity: typeof row.capacity === "number" ? row.capacity : null, sessionMode: nullableText(row.session_mode), audience: text(row.audience), location: nullableText(row.location), description: text(row.description) })),
    result: resultResult.data ? { campEntityId: id, publicationStatus: text(resultResult.data.publication_status), whatWeBuilt: text(resultResult.data.what_we_built), whatWeLearned: text(resultResult.data.what_we_learned), mainResults: text(resultResult.data.main_results), whatHappensNext: text(resultResult.data.what_happens_next), participantsCount: Number(resultResult.data.participants_count) || 0, mastersCount: Number(resultResult.data.masters_count) || 0, workshopsCount: Number(resultResult.data.workshops_count) || 0, durationDays: Number(resultResult.data.duration_days) || 0, publishedAt: nullableText(resultResult.data.published_at) } : null,
    topics: (topicsResult.data ?? []).map((row) => ({ id: text(row.id), title: text(row.title) })),
  };

  return <CampOperations initialData={data} />;
}
