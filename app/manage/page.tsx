import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/supabase/server";
import InvitationManager from "./invitation-manager";

export const metadata: Metadata = {
  title: "Manage invitations",
  description: "Invite people into the communities, projects and Building Camps you organise.",
};

export const dynamic = "force-dynamic";

const invitationCategories = new Set([
  "core_team",
  "future_resident",
  "master_teacher",
  "specialist",
  "builder",
  "volunteer",
  "organiser",
  "partner",
]);

export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; category?: string; direction?: string }>;
}) {
  const query = await searchParams;
  const initialSearch = typeof query.person === "string" ? query.person.trim().slice(0, 120) : "";
  const initialCategory = typeof query.category === "string" && invitationCategories.has(query.category)
    ? query.category
    : "core_team";
  const initialDirection = query.direction === "received" ? "received" : "sent";
  const destinationQuery = new URLSearchParams();
  if (initialSearch) destinationQuery.set("person", initialSearch);
  if (initialCategory !== "core_team") destinationQuery.set("category", initialCategory);
  if (initialDirection === "received") destinationQuery.set("direction", "received");
  const destination = `/manage${destinationQuery.size ? `?${destinationQuery}` : ""}`;

  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(destination)}`);

  return <InvitationManager email={user.email ?? ""} initialSearch={initialSearch} initialCategory={initialCategory} initialDirection={initialDirection} />;
}
