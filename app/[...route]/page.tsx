import { notFound, redirect } from "next/navigation";
import Platform from "../platform";
import type { PlatformData } from "../platform-data";
import { loadPlatformData } from "../../lib/hearthland/platform-repository";

export default async function RoutedPage({ params }: { params: Promise<{ route: string[] }> }) {
  const { route } = await params;
  const data = await loadPlatformData();
  const path = `/${route.join("/")}`;

  if (!isAvailablePlatformRoute(route, data)) notFound();
  if (path === "/dashboard" && data.viewer.status !== "authenticated") {
    redirect(`/auth/sign-in?next=${encodeURIComponent(path)}`);
  }

  return <Platform data={data} initialPath={path} />;
}

function isAvailablePlatformRoute(route: string[], data: PlatformData) {
  if (route.length === 0 || route.length > 2) return false;
  const [section, slug] = route;
  const collections = new Set([
    "explore",
    "dashboard",
    "learn",
    "how-it-works",
    "building-camps",
    "emerging-communities",
    "communities",
    "projects",
    "land",
    "opportunities",
    "people",
  ]);

  if (!collections.has(section)) return false;
  if (!slug) return true;

  const details: Record<string, Array<{ slug: string }>> = {
    "building-camps": data.buildingCamps,
    "emerging-communities": data.emergingCommunities,
    communities: data.communities,
    projects: data.projects,
    land: data.lands,
    opportunities: data.opportunities,
    people: data.people,
  };
  const items = details[section];
  return Boolean(items?.some((item) => item.slug === slug));
}
