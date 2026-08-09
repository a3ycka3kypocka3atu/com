import type { BuildingCamp, Community, Land, Opportunity, Person, Project } from "./types";

export type View = "home" | "explore" | "communities" | "people" | "land" | "opportunities" | "camps" | "dashboard" | "community" | "project" | "land-detail" | "opportunity" | "camp" | "profile" | "how" | "learn";

export type DashboardTask = {
  id: string;
  title: string;
  stage: string;
  assignee: string;
  due: string;
  status: string;
  priority: string;
};

export type PlatformNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
};

export type LearningTopic = {
  category: string;
  title: string;
  description: string;
};

export type PlatformViewer = {
  status: "anonymous" | "authenticated";
  userId: string | null;
  email: string | null;
  role: "anonymous" | "member" | "manager" | "administrator";
};

/**
 * The serializable data boundary between server-side repositories and the
 * interactive Hearthland application shell.
 */
export type PlatformData = {
  currentPerson: Person;
  people: Person[];
  communities: Community[];
  emergingCommunities: Community[];
  lands: Land[];
  projects: Project[];
  opportunities: Opportunity[];
  buildingCamps: BuildingCamp[];
  learningTopics: LearningTopic[];
  dashboardTasks: DashboardTask[];
  notificationsSeed: PlatformNotification[];
  lifecycle: string[];
  viewer: PlatformViewer;
};

export function getAllCommunities(data: PlatformData) {
  return [...data.communities, ...data.emergingCommunities];
}

function detailPath(base: string, id: string | undefined, items: Array<{ id: string; slug: string }>) {
  if (!id) return base;
  const item = items.find((candidate) => candidate.id === id);
  return item ? `${base}/${item.slug}` : base;
}

export function pathFor(data: PlatformData, view: View, id?: string) {
  if (view === "home") return "/";
  if (view === "community") {
    const item = getAllCommunities(data).find((community) => community.id === id);
    if (!item) return "/communities";
    return item.kind === "emerging" ? `/emerging-communities/${item.slug}` : `/communities/${item.slug}`;
  }
  if (view === "project") return detailPath("/projects", id, data.projects);
  if (view === "land-detail") return detailPath("/land", id, data.lands);
  if (view === "opportunity") return detailPath("/opportunities", id, data.opportunities);
  if (view === "camp") return detailPath("/building-camps", id, data.buildingCamps);
  if (view === "profile") return detailPath("/people", id, data.people);
  return ({ camps: "/building-camps", how: "/how-it-works" } as Partial<Record<View, string>>)[view] ?? `/${view}`;
}

function detailView<T extends { id: string; slug: string }>(
  items: T[],
  slug: string | undefined,
  detail: View,
  collection: View,
): { view: View; id?: string } {
  if (!slug) return { view: collection };
  const item = items.find((candidate) => candidate.slug === slug);
  return item ? { view: detail, id: item.id } : { view: detail };
}

export function parsePath(data: PlatformData, path: string): { view: View; id?: string } {
  const clean = path.split("?")[0].replace(/^\//, "").replace(/\/$/, "");
  if (!clean) return { view: "home" };
  const [section, slug] = clean.split("/");
  if (section === "how-it-works") return { view: "how" };
  if (section === "building-camps") return detailView(data.buildingCamps, slug, "camp", "camps");
  if (section === "emerging-communities") return detailView(data.emergingCommunities, slug, "community", "communities");
  if (section === "communities") return detailView(data.communities, slug, "community", "communities");
  if (section === "projects") return detailView(data.projects, slug, "project", "explore");
  if (section === "land") return detailView(data.lands, slug, "land-detail", "land");
  if (section === "opportunities") return detailView(data.opportunities, slug, "opportunity", "opportunities");
  if (section === "people") return detailView(data.people, slug, "profile", "people");
  if (["explore", "dashboard", "learn"].includes(section)) return { view: section as View };
  return { view: "home" };
}
