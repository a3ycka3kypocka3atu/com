import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../lib/supabase/server";
import ParticipationRequests, { type ParticipantRequest } from "./participation-requests";
import styles from "./participation.module.css";

export const metadata: Metadata = {
  title: "My Participation Requests",
  description: "Follow your requests to join Hearthland Settlement Projects.",
};

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function submittedDate(value: unknown) {
  if (typeof value !== "string") return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function MyParticipationPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent("/participation")}`);

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const requestsResult = await hearthland
    .from("project_participation_requests")
    .select("id, project_entity_id, participation_type, message, status, created_at, updated_at")
    .eq("applicant_account_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (requestsResult.error) {
    return (
      <main className={styles.statePage}>
        <span>MY PARTICIPATION</span>
        <h1>Your participation requests could not be loaded.</h1>
        <p>Please refresh and try again. Your existing requests remain stored safely.</p>
        <Link href="/dashboard" prefetch={false}>Return to dashboard →</Link>
      </main>
    );
  }

  const rows = requestsResult.data ?? [];
  const projectIds = Array.from(new Set(rows.map((row) => text(row.project_entity_id)).filter(Boolean)));
  const projectsResult = projectIds.length
    ? await hearthland
      .from("entities")
      .select("id, title, slug, short_description")
      .in("id", projectIds)
      .eq("entity_type", "settlement_project")
      .is("archived_at", null)
    : { data: [], error: null };
  const projects = new Map((projectsResult.data ?? []).map((project) => [text(project.id), project]));

  const requests: ParticipantRequest[] = rows.map((row) => {
    const project = projects.get(text(row.project_entity_id));
    const slug = text(project?.slug);
    return {
      id: text(row.id),
      projectId: text(row.project_entity_id),
      projectTitle: text(project?.title) || "Settlement Project",
      projectDescription: text(project?.short_description),
      projectHref: slug ? `/projects/${slug}` : null,
      participationType: text(row.participation_type),
      message: text(row.message),
      status: text(row.status),
      submittedDate: submittedDate(row.created_at),
    };
  });

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <nav aria-label="Participation navigation">
          <Link href="/dashboard" prefetch={false}>Dashboard</Link>
          <Link href="/explore" prefetch={false}>Explore Projects</Link>
          <Link href="/settings/profile" prefetch={false}>Profile</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <span>MY PARTICIPATION</span>
        <h1>My Participation Requests</h1>
        <p>Follow every Project request from first contact to a decision. Project organisers can review your role, message and attached skills.</p>
      </section>

      {projectsResult.error && (
        <div className={styles.notice} role="status">
          One or more Project pages are currently private or unavailable. Your request history is still shown.
        </div>
      )}
      <ParticipationRequests initialRequests={requests} />
    </main>
  );
}
