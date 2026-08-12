export type EntityKind = "community" | "emerging" | "land" | "opportunity" | "person" | "project" | "camp";

export type Coordinates = { x: number; y: number };

export type TeachableSkill = {
  name: string;
  category: string;
  experienceLevel: "curious" | "beginner" | "intermediate" | "advanced" | "expert";
  practicalWorkshops: boolean;
  theoreticalSessions: boolean;
};

export type TeachingProfile = {
  isAvailable: boolean;
  bio: string;
  teachingMode: "practical" | "theoretical" | "both";
  formats: string[];
  travelScope: "local" | "selected_countries" | "europe" | "international" | "online";
  selectedCountries: string[];
  travelRegions: string[];
  languages: string[];
  availability: string;
  compensationPreference: string;
  professionalArrangements: string[];
  arrangementNotes: string;
  portfolioLinks: string[];
  skills: TeachableSkill[];
  topics: Array<{
    id: string;
    title: string;
    teachingType: "practical" | "theoretical" | "both";
  }>;
};

export type Community = {
  id: string;
  slug: string;
  name: string;
  kind: "community" | "emerging";
  image: string;
  location: string;
  country: string;
  region: string;
  type: string;
  description: string;
  mission: string;
  residents: number;
  target: string;
  founded?: number;
  accepting: boolean;
  membership: string;
  governance: string;
  ownership: string;
  economy: number;
  communalLife: number;
  familyFriendly: boolean;
  children: number;
  languages: string[];
  values: string[];
  tags: string[];
  ecology: string[];
  housing: string[];
  needs: string[];
  stage?: string;
  team?: number;
  landArea?: string;
  coordinates: Coordinates;
  verified?: boolean;
};

export type Person = {
  id: string;
  slug: string;
  name: string;
  avatar: string;
  headline: string;
  location: string;
  country: string;
  languages: string[];
  skills: string[];
  skillCategories: string[];
  values: string[];
  lookingFor: string[];
  preferredCountries: string[];
  preferredTypes: string[];
  preferredSize: [number, number];
  governance: string[];
  housing: string[];
  ecology: string[];
  economy: number;
  communalLife: number;
  family: string;
  availability: string;
  completeness: number;
  bio: string;
  canContribute?: string[];
  contributionNote?: string;
  isMemberProfile?: boolean;
  teaching?: TeachingProfile;
};

export type Land = {
  id: string;
  slug: string;
  title: string;
  image: string;
  location: string;
  country: string;
  region: string;
  area: number;
  price: number | null;
  water: boolean;
  buildings: boolean;
  agricultural: boolean;
  forest: boolean;
  zoning: string;
  construction: string;
  infrastructure: string[];
  suitable: string[];
  collaboration: string[];
  status: string;
  privacy: "Exact" | "Approximate" | "Private";
  description: string;
  coordinates: Coordinates;
};

export type Opportunity = {
  id: string;
  slug: string;
  title: string;
  parent: string;
  parentId: string;
  parentKind: "community" | "emerging" | "project";
  type: string;
  category: "Join" | "Work" | "Volunteer" | "Expertise" | "Partnership" | "Funding";
  location: string;
  country: string;
  remote: boolean;
  compensation: string;
  accommodation: boolean;
  food: boolean;
  start: string;
  duration: string;
  deadline: string;
  skills: string[];
  description: string;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  parent: string;
  parentId: string;
  stage: string;
  readiness: number;
  team: number;
  interested: number;
  savedLand: number;
  openNeeds: number;
  openOpportunities: number;
  openTasks: number;
  nextMilestone: string;
  countries: string[];
  targetRegion: string;
  targetPopulation: number;
  landRequirement: string;
  requiredSkills: string[];
  availableSkills: string[];
  progress: Record<string, "not started" | "exploring" | "in progress" | "prepared" | "completed">;
  description?: string;
  currentPriorities?: string[];
  milestones?: Array<{
    id: string;
    title: string;
    description: string;
    targetDate: string | null;
    completedDate: string | null;
    status: "future" | "active" | "completed" | "delayed";
  }>;
  updates?: Array<{
    id: string;
    title: string;
    body: string;
    publishedAt: string;
  }>;
  needs?: Array<{
    id: string;
    title: string;
    category: string;
    description: string;
    urgency: string;
  }>;
  pilot?: {
    status: "nominated" | "active" | "paused" | "completed";
    cohort: string;
    publicSummary: string;
    launchedAt: string | null;
  };
};

export type BuildingCamp = {
  id: string;
  slug: string;
  title: string;
  parent: string;
  parentId: string;
  projectId: string;
  image: string;
  location: string;
  country: string;
  startDate: string;
  endDate: string;
  dateLabel: string;
  capacity: number;
  joined: number;
  status: string;
  description: string;
  purpose: string[];
  builds: Array<{ title: string; status: string; lead: string; participants: string; learning: string[] }>;
  learning: string[];
  communityLearning: string[];
  roles: string[];
  accommodation: string;
  food: string;
  contribution: string;
  teachers: Array<{ name: string; role: string; avatar: string; skills: string[] }>;
  schedule: Array<{ day: string; items: Array<{ time: string; title: string; type: string }> }>;
  result?: {
    participants: number;
    masters: number;
    workshops: number;
    durationDays: number;
    whatWeBuilt: string;
    whatWeLearned: string;
    mainResults: string;
    whatHappensNext: string;
    publishedAt: string;
    structures: Array<{
      id: string;
      title: string;
      description: string;
      images: Array<{ url: string; alt: string }>;
    }>;
    images: Array<{ url: string; alt: string }>;
  };
};

export type MatchResult = {
  score: number;
  label: "High compatibility" | "Good compatibility" | "Potential fit";
  strong: string[];
  partial: string[];
  discuss: string[];
};
