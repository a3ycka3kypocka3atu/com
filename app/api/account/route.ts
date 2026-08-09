import { createClient } from "../../../lib/supabase/server";

const SCHEMA = "hearthland";
const AVATAR_BUCKET = "hearthland-avatars";
const VISIBILITIES = new Set(["public", "members", "connections", "private"]);
const INTENTIONS = new Set([
  "find_community",
  "create_community",
  "already_creating_community",
  "represent_existing_community",
  "have_land",
  "teach_master",
  "volunteer",
  "work",
  "support_invest",
  "learn",
  "represent_organisation",
  "explore",
]);
const EXPERIENCE_LEVELS = new Set(["curious", "beginner", "intermediate", "advanced", "expert"]);

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
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximum);
}

function cleanOptionalString(value: unknown, maximum = 240) {
  const cleaned = cleanString(value, maximum);
  return cleaned || null;
}

function cleanList(value: unknown, maximumItems = 40, maximumLength = 120) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => cleanString(item, maximumLength))
        .filter(Boolean),
    ),
  ).slice(0, maximumItems);
}

function cleanLinks(value: unknown) {
  return cleanList(value, 12, 500).filter((candidate) => {
    try {
      const url = new URL(candidate);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  });
}

function cleanInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function slugify(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
  return slug || "skill";
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const id = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (error || !id) throw new RequestError("Sign in to manage your Hearthland account.", 401);
  return {
    supabase,
    user: {
      id,
      email: typeof data?.claims?.email === "string" ? data.claims.email : "",
    },
  };
}

async function loadSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email: string },
) {
  const hearthland = supabase.schema(SCHEMA);
  const [accountResult, profileResult, intentionsResult, notificationPreferencesResult] = await Promise.all([
    hearthland
      .from("accounts")
      .select("id, email, display_name, onboarding_status, settings")
      .eq("id", user.id)
      .maybeSingle(),
    hearthland
      .from("person_profiles")
      .select(
        "entity_id, display_name, headline, bio, languages, relocation_readiness, geographic_flexibility, family_situation, availability, profile_completeness, discoverable, allow_connection_requests, looking_for, can_contribute, contribution_note",
      )
      .eq("account_id", user.id)
      .maybeSingle(),
    hearthland
      .from("user_intentions")
      .select("intention")
      .eq("account_id", user.id)
      .order("created_at", { ascending: true }),
    hearthland
      .from("notification_preferences")
      .select("email_enabled, message_notifications, project_update_notifications, upcoming_camp_notifications")
      .eq("account_id", user.id)
      .maybeSingle(),
  ]);

  const firstError = accountResult.error ?? profileResult.error ?? intentionsResult.error ?? notificationPreferencesResult.error;
  if (firstError) throw new Error(firstError.message);
  if (!accountResult.data || !profileResult.data) {
    throw new Error("Your Hearthland account is still initializing. Please refresh in a moment.");
  }

  const profileEntityId = profileResult.data.entity_id as string;
  const [entityResult, locationResult, preferencesResult, contactsResult, personSkillsResult, profileValuesResult, avatarResult] = await Promise.all([
    hearthland
      .from("entities")
      .select("slug, visibility, publication_status")
      .eq("id", profileEntityId)
      .maybeSingle(),
    hearthland
      .from("profile_locations")
      .select("country, region, city, visibility")
      .eq("profile_entity_id", profileEntityId)
      .maybeSingle(),
    hearthland
      .from("profile_preferences")
      .select(
        "preferred_countries, preferred_regions, desired_community_types, lifestyle_interests, community_size_min, community_size_max, privacy_preferences",
      )
      .eq("profile_entity_id", profileEntityId)
      .maybeSingle(),
    hearthland
      .from("profile_contacts")
      .select("visibility, links")
      .eq("profile_entity_id", profileEntityId)
      .maybeSingle(),
    hearthland
      .from("person_skills")
      .select("id, skill_id, experience_level, can_teach, willing_to_contribute")
      .eq("profile_entity_id", profileEntityId)
      .order("created_at", { ascending: true }),
    hearthland
      .from("profile_values")
      .select("value_id")
      .eq("profile_entity_id", profileEntityId),
    hearthland
      .from("media_assets")
      .select("object_path")
      .eq("profile_entity_id", profileEntityId)
      .eq("category", "avatar")
      .is("archived_at", null)
      .maybeSingle(),
  ]);

  const dependentError = entityResult.error
    ?? locationResult.error
    ?? preferencesResult.error
    ?? contactsResult.error
    ?? personSkillsResult.error
    ?? profileValuesResult.error
    ?? avatarResult.error;
  if (dependentError) throw new Error(dependentError.message);

  const skillRows = personSkillsResult.data ?? [];
  const skillIds = skillRows.map((item) => item.skill_id as string);
  const valueIds = (profileValuesResult.data ?? []).map((item) => item.value_id as string);
  const [skillsCatalogResult, valuesCatalogResult] = await Promise.all([
    skillIds.length
      ? hearthland.from("skills").select("id, name, category").in("id", skillIds)
      : Promise.resolve({ data: [], error: null }),
    valueIds.length
      ? hearthland.from("values_catalog").select("id, name").in("id", valueIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (skillsCatalogResult.error || valuesCatalogResult.error) {
    throw new Error(skillsCatalogResult.error?.message ?? valuesCatalogResult.error?.message ?? "Profile taxonomy could not be loaded.");
  }

  const skillsById = new Map((skillsCatalogResult.data ?? []).map((item) => [item.id as string, item]));
  const valuesById = new Map((valuesCatalogResult.data ?? []).map((item) => [item.id as string, item.name as string]));
  const avatarPath = typeof avatarResult.data?.object_path === "string" ? avatarResult.data.object_path : "";
  let avatarUrl = "";
  if (avatarPath) {
    const signed = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(avatarPath, 3600);
    if (!signed.error) avatarUrl = signed.data.signedUrl;
  }

  const account = accountResult.data;
  const profile = profileResult.data;
  const preferences = preferencesResult.data;
  const location = locationResult.data;
  const entity = entityResult.data;
  const privacyPreferences = isRecord(preferences?.privacy_preferences)
    ? preferences.privacy_preferences
    : {};
  const notificationPreferences = notificationPreferencesResult.data;
  const accountSettings = isRecord(account.settings) ? account.settings : {};

  return {
    account: {
      id: account.id,
      email: account.email || user.email,
      displayName: account.display_name,
      onboardingStatus: account.onboarding_status,
      settings: {
        ...accountSettings,
        notifications: {
          messages: notificationPreferences?.message_notifications ?? true,
          projectUpdates: notificationPreferences?.project_update_notifications ?? true,
          campReminders: notificationPreferences?.upcoming_camp_notifications ?? true,
          emailEnabled: notificationPreferences?.email_enabled ?? true,
        },
      },
    },
    profile: {
      entityId: profileEntityId,
      slug: entity?.slug ?? "",
      displayName: profile.display_name,
      headline: profile.headline,
      bio: profile.bio,
      country: location?.country ?? "",
      region: location?.region ?? "",
      city: location?.city ?? "",
      languages: profile.languages ?? [],
      links: contactsResult.data?.links ?? [],
      relocationReadiness: profile.relocation_readiness ?? "",
      preferredCountries: preferences?.preferred_countries ?? [],
      preferredRegions: preferences?.preferred_regions ?? [],
      desiredCommunityTypes: preferences?.desired_community_types ?? [],
      communitySizeMin: preferences?.community_size_min ?? "",
      communitySizeMax: preferences?.community_size_max ?? "",
      lifestyleInterests: preferences?.lifestyle_interests ?? [],
      lookingFor: profile.looking_for ?? [],
      canContribute: profile.can_contribute ?? [],
      contributionNote: profile.contribution_note ?? "",
      values: valueIds.map((id) => valuesById.get(id)).filter(Boolean),
      availability: profile.availability ?? "",
      profileVisibility: entity?.visibility ?? "members",
      locationVisibility: location?.visibility ?? "members",
      contactVisibility: contactsResult.data?.visibility ?? "connections",
      privacyPreferences,
      discoverable: profile.discoverable,
      allowConnectionRequests: profile.allow_connection_requests,
      avatarPath,
      avatarUrl,
      profileCompleteness: profile.profile_completeness,
      publicationStatus: entity?.publication_status ?? "draft",
    },
    intentions: (intentionsResult.data ?? []).map((item) => item.intention),
    skills: skillRows.flatMap((item) => {
      const catalog = skillsById.get(item.skill_id as string);
      return catalog
        ? [{
            id: item.id,
            name: catalog.name,
            category: catalog.category,
            experienceLevel: item.experience_level,
            canTeach: item.can_teach,
            willingToContribute: item.willing_to_contribute,
          }]
        : [];
    }),
  };
}

function profileRpcPayload(body: JsonRecord, action: "onboarding" | "profile") {
  const profile = isRecord(body.profile) ? body.profile : {};
  const displayName = cleanString(profile.displayName ?? profile.display_name, 120);
  if (!displayName) throw new RequestError("Display name is required.");

  const profileVisibility = cleanString(
    profile.profileVisibility ?? profile.profile_visibility ?? "members",
    20,
  );
  const locationVisibility = cleanString(
    profile.locationVisibility ?? profile.location_visibility ?? "members",
    20,
  );
  const contactVisibility = cleanString(
    profile.contactVisibility ?? profile.contact_visibility ?? "connections",
    20,
  );
  if (!VISIBILITIES.has(profileVisibility) || !VISIBILITIES.has(locationVisibility) || !VISIBILITIES.has(contactVisibility)) {
    throw new RequestError("One or more privacy settings are invalid.");
  }

  const intentions = action === "onboarding"
    ? cleanList(body.intentions, 12, 80)
    : undefined;
  if (intentions?.some((item) => !INTENTIONS.has(item))) {
    throw new RequestError("One or more onboarding intentions are invalid.");
  }

  const rawSkills = Array.isArray(body.skills) ? body.skills.slice(0, 40) : [];
  const skills = rawSkills.flatMap((value) => {
    if (!isRecord(value)) return [];
    const name = cleanString(value.name, 120);
    if (!name) return [];
    const experienceLevel = cleanString(value.experienceLevel ?? value.experience_level, 20) || "curious";
    if (!EXPERIENCE_LEVELS.has(experienceLevel)) throw new RequestError(`Invalid experience level for ${name}.`);
    return [{
      slug: slugify(name),
      name,
      category: cleanString(value.category, 100) || "Other",
      experience_level: experienceLevel,
      can_teach: value.canTeach === true || value.can_teach === true,
      willing_to_contribute: value.willingToContribute !== false && value.willing_to_contribute !== false,
    }];
  });

  const values = cleanList(profile.values, 30, 120).map((name) => ({ slug: slugify(name), name }));
  const privacyPreferences = isRecord(profile.privacyPreferences)
    ? profile.privacyPreferences
    : isRecord(profile.privacy_preferences)
      ? profile.privacy_preferences
      : {};
  const accountSettings = isRecord(body.accountSettings) ? body.accountSettings : undefined;
  const settingsPrivacy = accountSettings && isRecord(accountSettings.privacy) ? accountSettings.privacy : {};

  const payload: JsonRecord = {
    display_name: displayName,
    headline: cleanString(profile.headline, 220),
    bio: cleanString(profile.bio, 5000),
    country: cleanOptionalString(profile.country, 120),
    region: cleanOptionalString(profile.region, 160),
    city: cleanOptionalString(profile.city, 160),
    languages: cleanList(profile.languages, 20, 80),
    links: cleanLinks(profile.links),
    relocation_readiness: cleanOptionalString(profile.relocationReadiness ?? profile.relocation_readiness, 40),
    availability: cleanOptionalString(profile.availability, 160),
    looking_for: cleanList(profile.lookingFor ?? profile.looking_for, 40, 140),
    can_contribute: cleanList(profile.canContribute ?? profile.can_contribute, 40, 140),
    contribution_note: cleanString(profile.contributionNote ?? profile.contribution_note, 2000),
    visibility: profileVisibility,
    location_visibility: locationVisibility,
    contact_visibility: contactVisibility,
    discoverable: typeof settingsPrivacy.discoverable === "boolean"
      ? settingsPrivacy.discoverable
      : profile.discoverable !== false,
    allow_connection_requests: typeof settingsPrivacy.allowConnectionRequests === "boolean"
      ? settingsPrivacy.allowConnectionRequests
      : profile.allowConnectionRequests !== false,
    preferences: {
      preferred_countries: cleanList(profile.preferredCountries ?? profile.preferred_countries, 30, 120),
      preferred_regions: cleanList(profile.preferredRegions ?? profile.preferred_regions, 30, 160),
      desired_community_types: cleanList(profile.desiredCommunityTypes ?? profile.desired_community_types, 30, 120),
      lifestyle_interests: cleanList(profile.lifestyleInterests ?? profile.lifestyle_interests, 40, 120),
      community_size_min: cleanInteger(profile.communitySizeMin ?? profile.community_size_min),
      community_size_max: cleanInteger(profile.communitySizeMax ?? profile.community_size_max),
      privacy_preferences: privacyPreferences,
    },
  };

  if (action === "onboarding") {
    payload.intentions = intentions;
    payload.onboarding_status = "complete";
  } else {
    payload.skills = skills;
    payload.values = values;
    payload.publication_status = "published";
  }
  if (accountSettings) payload.account_settings = accountSettings;

  const avatarPath = cleanString(profile.avatarPath ?? profile.avatar_path, 500);
  const avatarRemove = profile.avatarRemove === true || profile.avatar_remove === true;
  if (avatarRemove) {
    payload.avatar = { remove: true };
  } else if (
    avatarPath
    && cleanString(profile.avatarMimeType ?? profile.avatar_mime_type, 100)
    && (typeof profile.avatarSizeBytes === "number" || typeof profile.avatar_size_bytes === "number")
  ) {
    payload.avatar = {
      path: avatarPath,
      mime_type: cleanString(profile.avatarMimeType ?? profile.avatar_mime_type, 100),
      size_bytes: typeof profile.avatarSizeBytes === "number" ? profile.avatarSizeBytes : profile.avatar_size_bytes,
      alt_text: `${displayName} profile photo`,
    };
  }
  return payload;
}

export async function GET() {
  try {
    const { supabase, user } = await authenticatedClient();
    return Response.json(await loadSnapshot(supabase, user));
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Your account could not be loaded." },
      { status },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedClient();
    const body = await request.json().catch(() => null);
    if (!isRecord(body) || (body.action !== "onboarding" && body.action !== "profile")) {
      throw new RequestError("Choose a valid account action.");
    }

    const payload = profileRpcPayload(body, body.action);
    const { error } = await supabase.schema(SCHEMA).rpc("save_my_profile", { payload });
    if (error) throw new RequestError(error.message, 422);

    if (isRecord(body.notificationPreferences)) {
      const preferences = body.notificationPreferences;
      const required = ["messages", "projectUpdates", "campReminders", "emailEnabled"] as const;
      if (required.some((key) => typeof preferences[key] !== "boolean")) {
        throw new RequestError("Notification preferences are invalid.");
      }
      const { error: notificationError } = await supabase.schema(SCHEMA)
        .from("notification_preferences")
        .upsert({
          account_id: user.id,
          message_notifications: preferences.messages,
          project_update_notifications: preferences.projectUpdates,
          upcoming_camp_notifications: preferences.campReminders,
          email_enabled: preferences.emailEnabled,
          updated_at: new Date().toISOString(),
        }, { onConflict: "account_id" });
      if (notificationError) throw new RequestError(notificationError.message, 422);
    }

    const snapshot = await loadSnapshot(supabase, user);
    return Response.json({ ok: true, ...snapshot });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Your account could not be saved." },
      { status },
    );
  }
}
