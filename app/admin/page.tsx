import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../lib/supabase/server";
import PilotControls from "./pilot-controls";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Platform administration",
  description: "Hearthland adoption, moderation and operational overview.",
};

export const dynamic = "force-dynamic";

type CountResult = { count: number | null; error: { message: string } | null };

function countValue(result: CountResult) {
  return result.error ? null : result.count ?? 0;
}

function metricValue(metrics: unknown, key: string, fallback: number | null) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return fallback;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function shortDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=%2Fadmin");

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const roleResult = await hearthland
    .from("platform_roles")
    .select("role")
    .eq("account_id", user.id)
    .eq("role", "admin")
    .is("revoked_at", null)
    .maybeSingle();

  if (roleResult.error || !roleResult.data) {
    return (
      <main className={styles.denied}>
        <span>ADMINISTRATION</span>
        <h1>Platform administrator access is required.</h1>
        <p>Your Hearthland account is active, but it does not have a platform administrator role.</p>
        <Link href="/dashboard" prefetch={false}>Return to dashboard →</Link>
      </main>
    );
  }

  const currentDate = new Date();
  const today = currentDate.toISOString().slice(0, 10);
  const monthBoundary = new Date(currentDate);
  monthBoundary.setUTCDate(monthBoundary.getUTCDate() - 30);
  const thirtyDaysAgo = monthBoundary.toISOString();

  const [
    platformMetricsResult,
    users,
    newUsers,
    communities,
    emerging,
    projects,
    publishedLand,
    openOpportunities,
    upcomingCamps,
    opportunityApplications,
    communityInterests,
    campApplications,
    projectParticipationRequests,
    acceptedCampParticipants,
    masters,
    invitations,
    acceptedInvitations,
    openReports,
    openFeedback,
    suspendedAccounts,
    recentAccounts,
    recentReports,
    recentFeedback,
    recentActivity,
    projectDirectory,
    pilotDirectory,
  ] = await Promise.all([
    hearthland.rpc("get_platform_metrics", { period_start: thirtyDaysAgo }),
    hearthland.from("accounts").select("id", { count: "exact", head: true }),
    hearthland.from("accounts").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    hearthland.from("entities").select("id", { count: "exact", head: true }).eq("entity_type", "community").is("archived_at", null),
    hearthland.from("entities").select("id", { count: "exact", head: true }).eq("entity_type", "emerging_community").is("archived_at", null),
    hearthland.from("entities").select("id", { count: "exact", head: true }).eq("entity_type", "settlement_project").is("archived_at", null),
    hearthland.from("entities").select("id", { count: "exact", head: true }).eq("entity_type", "land_listing").eq("publication_status", "published").is("archived_at", null),
    hearthland.from("opportunities").select("entity_id", { count: "exact", head: true }).eq("application_status", "open"),
    hearthland.from("building_camps").select("entity_id", { count: "exact", head: true }).gte("end_date", today).in("camp_status", ["published", "applications_open", "applications_closed", "active"]),
    hearthland.from("opportunity_applications").select("id", { count: "exact", head: true }).is("archived_at", null),
    hearthland.from("community_interests").select("id", { count: "exact", head: true }).is("archived_at", null),
    hearthland.from("camp_applications").select("id", { count: "exact", head: true }).is("archived_at", null),
    hearthland.from("project_participation_requests").select("id", { count: "exact", head: true }).is("archived_at", null),
    hearthland.from("camp_participants").select("id", { count: "exact", head: true }).in("participant_status", ["accepted", "checked_in", "completed"]),
    hearthland.from("teaching_profiles").select("profile_entity_id", { count: "exact", head: true }).eq("is_available", true),
    hearthland.from("invitations").select("id", { count: "exact", head: true }),
    hearthland.from("invitations").select("id", { count: "exact", head: true }).eq("status", "accepted"),
    hearthland.from("reports").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing"]),
    hearthland.from("feedback_submissions").select("id", { count: "exact", head: true }).in("status", ["new", "reviewing", "planned"]),
    hearthland.from("accounts").select("id", { count: "exact", head: true }).eq("account_status", "suspended"),
    hearthland.from("accounts").select("id, display_name, account_status, created_at").order("created_at", { ascending: false }).limit(8),
    hearthland.from("reports").select("id, reason, status, created_at").order("created_at", { ascending: false }).limit(8),
    hearthland.from("feedback_submissions").select("id, category, message, status, priority, created_at").order("created_at", { ascending: false }).limit(8),
    hearthland.from("activity_events").select("id, event_type, summary, visibility, created_at").order("created_at", { ascending: false }).limit(10),
    hearthland.from("entities").select("id, title").eq("entity_type", "settlement_project").is("archived_at", null).order("title"),
    hearthland.from("pilot_projects").select("project_entity_id, pilot_status, cohort, public_summary, next_review_at"),
  ]);

  const applicationTotal = [
    countValue(opportunityApplications),
    countValue(communityInterests),
    countValue(campApplications),
    countValue(projectParticipationRequests),
  ].reduce<number | null>((total, value) => value === null || total === null ? null : total + value, 0);
  const liveMetrics = platformMetricsResult.error ? null : platformMetricsResult.data;

  const metrics = [
    ["Total users", metricValue(liveMetrics, "total_users", countValue(users))],
    ["New users · 30 days", metricValue(liveMetrics, "new_users", countValue(newUsers))],
    ["Communities", metricValue(liveMetrics, "communities", countValue(communities))],
    ["Emerging communities", metricValue(liveMetrics, "emerging_communities", countValue(emerging))],
    ["Settlement projects", metricValue(liveMetrics, "settlement_projects", countValue(projects))],
    ["Published land", metricValue(liveMetrics, "published_land", countValue(publishedLand))],
    ["Open opportunities", metricValue(liveMetrics, "open_opportunities", countValue(openOpportunities))],
    ["Upcoming Camps", metricValue(liveMetrics, "upcoming_camps", countValue(upcomingCamps))],
    ["Applications & interests", metricValue(liveMetrics, "applications", applicationTotal)],
    ["Accepted Camp participants", metricValue(liveMetrics, "accepted_camp_participants", countValue(acceptedCampParticipants))],
    ["Available Masters", metricValue(liveMetrics, "masters", countValue(masters))],
    ["Invitations sent", metricValue(liveMetrics, "invitations_sent", countValue(invitations))],
    ["Invitations accepted", metricValue(liveMetrics, "invitations_accepted", countValue(acceptedInvitations))],
    ["Open reports", countValue(openReports)],
    ["Open feedback", metricValue(liveMetrics, "open_feedback", countValue(openFeedback))],
    ["Suspended accounts", metricValue(liveMetrics, "suspended_users", countValue(suspendedAccounts))],
  ] as const;

  const pilotsByProject = new Map((pilotDirectory.data ?? []).map((pilot) => [pilot.project_entity_id as string, pilot]));
  const pilotOptions = (projectDirectory.data ?? []).map((project) => {
    const pilot = pilotsByProject.get(project.id as string);
    return {
      id: project.id as string,
      title: project.title as string,
      status: (pilot?.pilot_status as string | undefined) ?? "nominated",
      cohort: (pilot?.cohort as string | null | undefined) ?? "",
      summary: (pilot?.public_summary as string | null | undefined) ?? "",
      nextReviewAt: typeof pilot?.next_review_at === "string" ? pilot.next_review_at.slice(0, 10) : "",
    };
  });

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <nav>
          <Link href="/dashboard" prefetch={false}>Dashboard</Link>
          <Link href="/manage" prefetch={false}>Manage</Link>
          <form action="/auth/sign-out" method="post"><button type="submit">Sign out</button></form>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span>PLATFORM ADMIN</span>
          <h1>Early adoption, safety and activity in one view.</h1>
          <p>Live database-derived signals for the controlled Hearthland pilot. Counts respect the current production schema and exclude archived content where applicable.</p>
        </div>
        <aside><strong>{countValue(openReports) ?? "—"}</strong><span>reports need attention</span></aside>
      </section>

      <section className={styles.metrics} aria-label="Platform metrics">
        {metrics.map(([label, value]) => (
          <article key={label}><strong>{value ?? "—"}</strong><span>{label}</span></article>
        ))}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <header><div><span>USERS</span><h2>Newest accounts</h2></div><small>{countValue(newUsers) ?? "—"} this month</small></header>
          {recentAccounts.error ? <p className={styles.error}>Accounts could not be loaded.</p> : recentAccounts.data?.length ? (
            <div className={styles.rows}>
              {recentAccounts.data.map((account) => (
                <div className={styles.row} key={account.id}>
                  <span className={styles.avatar}>{String(account.display_name || "H").slice(0, 1).toUpperCase()}</span>
                  <span><strong>{account.display_name || "New Hearthland member"}</strong><small>Joined {shortDate(account.created_at)}</small></span>
                  <em data-tone={account.account_status}>{account.account_status}</em>
                </div>
              ))}
            </div>
          ) : <div className={styles.empty}><strong>No real users yet</strong><p>The first controlled accounts will appear here after authentication testing starts.</p></div>}
        </section>

        <section className={styles.panel}>
          <header><div><span>MODERATION</span><h2>Recent reports</h2></div><small>{countValue(openReports) ?? "—"} open</small></header>
          {recentReports.error ? <p className={styles.error}>Reports could not be loaded.</p> : recentReports.data?.length ? (
            <div className={styles.rows}>
              {recentReports.data.map((report) => (
                <div className={styles.report} key={report.id}>
                  <span><strong>{String(report.reason).replaceAll("_", " ")}</strong><small>{shortDate(report.created_at)}</small></span>
                  <em data-tone={report.status}>{report.status}</em>
                </div>
              ))}
            </div>
          ) : <div className={styles.empty}><strong>No reports</strong><p>Member reports and moderation follow-up will appear here.</p></div>}
        </section>
      </div>

      <section className={styles.panel}>
        <header><div><span>EARLY-USER FEEDBACK</span><h2>What pilot users are telling us</h2></div><small>{countValue(openFeedback) ?? "—"} open</small></header>
        {recentFeedback.error ? <p className={styles.error}>Feedback could not be loaded.</p> : recentFeedback.data?.length ? (
          <div className={styles.rows}>
            {recentFeedback.data.map((feedback) => (
              <div className={styles.report} key={feedback.id}>
                <span><strong>{String(feedback.category).replaceAll("_", " ")}</strong><small>{feedback.message} · {shortDate(feedback.created_at)}</small></span>
                <em data-tone={feedback.status}>{feedback.priority} · {feedback.status}</em>
              </div>
            ))}
          </div>
        ) : <div className={styles.empty}><strong>No feedback yet</strong><p>Feedback submitted through the private pilot will appear here.</p></div>}
      </section>

      <section className={styles.panel}>
        <header><div><span>PILOT PROJECTS</span><h2>Designate the first real places</h2></div><small>{countValue(projects) ?? "—"} projects</small></header>
        {projectDirectory.error || pilotDirectory.error
          ? <p className={styles.error}>Pilot-project controls could not be loaded.</p>
          : <PilotControls projects={pilotOptions} />}
      </section>

      <section className={styles.panel}>
        <header><div><span>RECENT ACTIVITY</span><h2>What is moving across Hearthland</h2></div></header>
        {recentActivity.error ? <p className={styles.error}>Activity could not be loaded.</p> : recentActivity.data?.length ? (
          <div className={styles.timeline}>
            {recentActivity.data.map((event) => (
              <article key={event.id}><i /><div><strong>{event.summary}</strong><span>{String(event.event_type).replaceAll("_", " ")} · {event.visibility} · {shortDate(event.created_at)}</span></div></article>
            ))}
          </div>
        ) : <div className={styles.empty}><strong>No activity recorded yet</strong><p>Publishing, invitations, accepted applications and project progress will build this timeline.</p></div>}
      </section>
    </main>
  );
}
