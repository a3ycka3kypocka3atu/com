export type IntentionKey =
  | "find_community"
  | "create_community"
  | "already_creating_community"
  | "represent_existing_community"
  | "have_land"
  | "teach_master"
  | "volunteer"
  | "work"
  | "support_invest"
  | "learn"
  | "represent_organisation"
  | "explore";

export type SkillDraft = {
  id?: string;
  name: string;
  category: string;
  experienceLevel: "curious" | "beginner" | "intermediate" | "advanced" | "expert";
  canTeach: boolean;
  willingToContribute: boolean;
};

export type ProfileDraft = {
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  country: string;
  region: string;
  city: string;
  languages: string[];
  links: string[];
  relocationReadiness: string;
  preferredCountries: string[];
  preferredRegions: string[];
  desiredCommunityTypes: string[];
  communitySizeMin: string;
  communitySizeMax: string;
  lifestyleInterests: string[];
  lookingFor: string[];
  canContribute: string[];
  contributionNote: string;
  values: string[];
  availability: string;
  profileVisibility: "public" | "members" | "connections" | "private";
  locationVisibility: "public" | "members" | "connections" | "private";
  contactVisibility: "public" | "members" | "connections" | "private";
  avatarPath: string;
  avatarUrl: string;
  profileCompleteness: number;
};

export type AccountSnapshot = {
  account: {
    id: string;
    email: string;
    displayName: string;
    onboardingStatus: string;
    settings: Record<string, unknown>;
  };
  profile: ProfileDraft;
  intentions: IntentionKey[];
  skills: SkillDraft[];
};

export const EMPTY_PROFILE: ProfileDraft = {
  slug: "",
  displayName: "",
  headline: "",
  bio: "",
  country: "",
  region: "",
  city: "",
  languages: [],
  links: [],
  relocationReadiness: "",
  preferredCountries: [],
  preferredRegions: [],
  desiredCommunityTypes: [],
  communitySizeMin: "",
  communitySizeMax: "",
  lifestyleInterests: [],
  lookingFor: [],
  canContribute: [],
  contributionNote: "",
  values: [],
  availability: "",
  profileVisibility: "public",
  locationVisibility: "members",
  contactVisibility: "connections",
  avatarPath: "",
  avatarUrl: "",
  profileCompleteness: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function numberValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function numericStringValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function experienceValue(value: string): SkillDraft["experienceLevel"] {
  return value === "beginner" || value === "intermediate" || value === "advanced" || value === "expert"
    ? value
    : "curious";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function listFrom(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(source[key])) return stringList(source[key]);
  }
  return [];
}

function privacyValue(value: string, fallback: ProfileDraft["profileVisibility"]) {
  return value === "public" || value === "members" || value === "connections" || value === "private"
    ? value
    : fallback;
}

export function normalizeAccountPayload(payload: unknown, fallbackId = "", fallbackEmail = ""): AccountSnapshot {
  const payloadRecord = isRecord(payload) ? payload : {};
  const root = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord;
  const account = isRecord(root.account) ? root.account : {};
  const profile = isRecord(root.profile) ? root.profile : {};
  const preferences = isRecord(profile.preferences)
    ? profile.preferences
    : isRecord(root.preferences)
      ? root.preferences
      : {};
  const privacy = isRecord(profile.privacyPreferences)
    ? profile.privacyPreferences
    : isRecord(profile.privacy_preferences)
      ? profile.privacy_preferences
      : isRecord(preferences.privacyPreferences)
        ? preferences.privacyPreferences
        : isRecord(preferences.privacy_preferences)
          ? preferences.privacy_preferences
          : {};

  const rawLinks = Array.isArray(profile.links) ? profile.links : [];
  const links = rawLinks
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) return stringValue(item, "url", "href");
      return "";
    })
    .filter(Boolean);

  const rawSkills = Array.isArray(root.skills) ? root.skills : [];
  const skills: SkillDraft[] = rawSkills
    .filter(isRecord)
    .map((skill) => ({
      id: stringValue(skill, "id") || undefined,
      name: stringValue(skill, "name", "skill"),
      category: stringValue(skill, "category") || "Practical",
      experienceLevel: experienceValue(stringValue(skill, "experienceLevel", "experience_level")),
      canTeach: skill.canTeach === true || skill.can_teach === true,
      willingToContribute: skill.willingToContribute !== false && skill.willing_to_contribute !== false,
    }))
    .filter((skill) => skill.name.length > 0);

  return {
    account: {
      id: stringValue(account, "id") || fallbackId,
      email: stringValue(account, "email") || fallbackEmail,
      displayName: stringValue(account, "displayName", "display_name"),
      onboardingStatus: stringValue(account, "onboardingStatus", "onboarding_status") || "not_started",
      settings: isRecord(account.settings) ? account.settings : {},
    },
    profile: {
      ...EMPTY_PROFILE,
      slug: stringValue(profile, "slug"),
      displayName: stringValue(profile, "displayName", "display_name") || stringValue(account, "displayName", "display_name"),
      headline: stringValue(profile, "headline"),
      bio: stringValue(profile, "bio"),
      country: stringValue(profile, "country"),
      region: stringValue(profile, "region"),
      city: stringValue(profile, "city"),
      languages: listFrom(profile, "languages"),
      links,
      relocationReadiness: stringValue(profile, "relocationReadiness", "relocation_readiness"),
      preferredCountries: listFrom(profile, "preferredCountries", "preferred_countries")
        .concat(listFrom(preferences, "preferredCountries", "preferred_countries")),
      preferredRegions: listFrom(profile, "preferredRegions", "preferred_regions")
        .concat(listFrom(preferences, "preferredRegions", "preferred_regions")),
      desiredCommunityTypes: listFrom(profile, "desiredCommunityTypes", "desired_community_types")
        .concat(listFrom(preferences, "desiredCommunityTypes", "desired_community_types")),
      communitySizeMin: numericStringValue(profile, "communitySizeMin", "community_size_min")
        || numericStringValue(preferences, "communitySizeMin", "community_size_min"),
      communitySizeMax: numericStringValue(profile, "communitySizeMax", "community_size_max")
        || numericStringValue(preferences, "communitySizeMax", "community_size_max"),
      lifestyleInterests: listFrom(profile, "lifestyleInterests", "lifestyle_interests")
        .concat(listFrom(preferences, "lifestyleInterests", "lifestyle_interests")),
      lookingFor: listFrom(profile, "lookingFor", "looking_for"),
      canContribute: listFrom(profile, "canContribute", "can_contribute"),
      contributionNote: stringValue(profile, "contributionNote", "contribution_note"),
      values: listFrom(profile, "values"),
      availability: stringValue(profile, "availability"),
      profileVisibility: privacyValue(
        stringValue(profile, "profileVisibility", "profile_visibility", "visibility") || stringValue(privacy, "profile", "profileVisibility"),
        "public",
      ),
      locationVisibility: privacyValue(
        stringValue(profile, "locationVisibility", "location_visibility") || stringValue(privacy, "location", "locationVisibility"),
        "members",
      ),
      contactVisibility: privacyValue(
        stringValue(profile, "contactVisibility", "contact_visibility") || stringValue(privacy, "contact", "contactVisibility"),
        "connections",
      ),
      avatarPath: stringValue(profile, "avatarPath", "avatar_path"),
      avatarUrl: stringValue(profile, "avatarUrl", "avatar_url"),
      profileCompleteness: numberValue(profile, "profileCompleteness", "profile_completeness"),
    },
    intentions: stringList(root.intentions) as IntentionKey[],
    skills,
  };
}

export async function readAccountResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : "We could not save your account. Please try again.";
    throw new Error(message);
  }
  return payload;
}

export function calculateProfileCompleteness(profile: ProfileDraft, skills: SkillDraft[]) {
  const checks = [
    Boolean(profile.displayName.trim()),
    Boolean(profile.headline.trim()),
    profile.bio.trim().length >= 80,
    Boolean(profile.country.trim() || profile.region.trim() || profile.city.trim()),
    profile.languages.length > 0,
    Boolean(profile.relocationReadiness),
    profile.preferredCountries.length + profile.preferredRegions.length > 0,
    profile.desiredCommunityTypes.length > 0,
    profile.lifestyleInterests.length > 0,
    skills.length > 0,
    profile.lookingFor.length > 0,
    profile.canContribute.length > 0,
    profile.values.length > 0,
    Boolean(profile.availability),
    Boolean(profile.avatarPath || profile.avatarUrl),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function profileSuggestions(profile: ProfileDraft, skills: SkillDraft[]) {
  const suggestions: string[] = [];
  if (!profile.avatarPath && !profile.avatarUrl) suggestions.push("Add a profile photo");
  if (profile.bio.trim().length < 80) suggestions.push("Share a little more of your story");
  if (skills.length === 0) suggestions.push("Add at least one skill");
  if (profile.lookingFor.length === 0) suggestions.push("Say what you are looking for");
  if (profile.preferredCountries.length + profile.preferredRegions.length === 0) suggestions.push("Add preferred regions");
  return suggestions.slice(0, 3);
}
