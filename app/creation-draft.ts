export const LAND_STATUS_OPTIONS = [
  "We have land",
  "Discussing land",
  "Searching for land",
  "Location still open",
] as const;

export const LIFESTYLE_OPTIONS = [
  "Ecological",
  "Regenerative",
  "Family",
  "Farming",
  "Education",
  "Crafts",
  "Health",
  "Remote work",
  "Entrepreneurship",
  "Arts",
] as const;

export const ASSET_OPTIONS = [
  "People",
  "Land",
  "Funding",
  "Skills",
  "Equipment",
  "Organisation",
  "Design",
  "Buildings",
  "Network",
] as const;

export const NEED_OPTIONS = [
  "People",
  "Land",
  "Specialists",
  "Materials",
  "Equipment",
  "Funding",
  "Knowledge",
  "Partners",
] as const;

export type CreationDraftPayload = {
  name: string;
  vision: string;
  currentPeople: number | null;
  targetResidents: number | null;
  peopleNeeded: string;
  landStatus: string;
  country: string;
  region: string;
  lifestyle: string[];
  assets: string[];
  needs: string[];
};

export const EMPTY_CREATION_DRAFT: CreationDraftPayload = {
  name: "",
  vision: "",
  currentPeople: 1,
  targetResidents: null,
  peopleNeeded: "",
  landStatus: "",
  country: "",
  region: "",
  lifestyle: [],
  assets: [],
  needs: [],
};

const limits = {
  name: 160,
  vision: 2_000,
  peopleNeeded: 2_000,
  country: 120,
  region: 160,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function integer(value: unknown, fallback: number | null) {
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return value >= 0 && value <= 100_000 ? value : fallback;
}

function selectedValues(value: unknown, allowed: readonly string[]) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && allowed.includes(item))),
  );
}

export function normalizeCreationDraftPayload(value: unknown): CreationDraftPayload {
  if (!isRecord(value)) return { ...EMPTY_CREATION_DRAFT };

  const landStatus = typeof value.landStatus === "string" && LAND_STATUS_OPTIONS.includes(value.landStatus as (typeof LAND_STATUS_OPTIONS)[number])
    ? value.landStatus
    : "";

  return {
    name: text(value.name, limits.name),
    vision: text(value.vision, limits.vision),
    currentPeople: integer(value.currentPeople, 1),
    targetResidents: integer(value.targetResidents, null),
    peopleNeeded: text(value.peopleNeeded, limits.peopleNeeded),
    landStatus,
    country: text(value.country, limits.country),
    region: text(value.region, limits.region),
    lifestyle: selectedValues(value.lifestyle, LIFESTYLE_OPTIONS),
    assets: selectedValues(value.assets, ASSET_OPTIONS),
    needs: selectedValues(value.needs, NEED_OPTIONS),
  };
}

export function validateCreationStep(payload: CreationDraftPayload, step: number) {
  if (step === 1) {
    if (!payload.name.trim()) return "Give your community a name before continuing.";
    if (!payload.vision.trim()) return "Add a short, grounded vision before continuing.";
  }
  if (step === 2) {
    if (!payload.currentPeople || payload.currentPeople < 1) return "Current people must be at least one.";
    if (!payload.targetResidents || payload.targetResidents < 1) return "Add a positive target number of residents.";
    if (payload.targetResidents < payload.currentPeople) return "Target residents cannot be lower than the people already involved.";
  }
  if (step === 3) {
    if (!payload.landStatus) return "Choose where you are in the land journey.";
    if (payload.landStatus !== "Location still open" && !payload.country.trim()) return "Add a country, or choose that the location is still open.";
  }
  if (step === 4 && payload.lifestyle.length === 0) return "Choose at least one theme for community life.";
  if (step === 6 && payload.needs.length === 0) return "Choose at least one current need.";
  return null;
}

export function validateCreationDraft(payload: CreationDraftPayload) {
  for (let step = 1; step <= 6; step += 1) {
    const error = validateCreationStep(payload, step);
    if (error) return { step, error };
  }
  return null;
}

export function toCreationRpcPayload(payload: CreationDraftPayload) {
  const name = payload.name.trim();
  const vision = payload.vision.trim();
  const peopleNeeded = payload.peopleNeeded.trim();
  const communityType = payload.lifestyle.includes("Regenerative")
    ? "Regenerative community"
    : "Intentional community";

  return {
    community_name: name,
    project_name: `${name} Settlement Project`,
    community_short_description: vision,
    project_short_description: vision,
    vision,
    community_type: communityType,
    community_stage: "idea",
    current_members: payload.currentPeople,
    target_size_max: payload.targetResidents,
    land_status: payload.landStatus,
    lifestyle_themes: payload.lifestyle,
    current_assets: payload.assets,
    project_description: peopleNeeded ? `${vision}\n\nFounding team needs: ${peopleNeeded}` : vision,
    project_stage: "vision",
    target_country: payload.country.trim() || null,
    target_region: payload.region.trim() || null,
    target_population: payload.targetResidents,
    next_milestone: payload.needs[0] ? `Secure ${payload.needs[0].toLowerCase()}` : "Build the founding team",
    current_priorities: payload.needs,
  };
}
