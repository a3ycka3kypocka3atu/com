import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../../lib/supabase/server";
import MemberTaskStatus from "./member-task-status";
import styles from "./community-member.module.css";

export const metadata: Metadata = {
  title: "Community member space",
  description: "Member work, gatherings and private Community Pulse participation.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const taskStatuses = new Set(["todo", "in_progress", "blocked", "completed"]);

function shortDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "Date to be confirmed";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date to be confirmed";
  return new Intl.DateTimeFormat("en", includeTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function CommunityMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/community/${id}`)}`);

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const [entity, account, memberships, role] = await Promise.all([
    hearthland.from("entities").select("id, title, slug, short_description, owner_account_id").eq("id", id).eq("entity_type", "community").is("archived_at", null).maybeSingle(),
    hearthland.from("accounts").select("account_status").eq("id", user.id).is("archived_at", null).maybeSingle(),
    hearthland.from("entity_memberships").select("id").eq("entity_id", id).eq("account_id", user.id).eq("status", "active").limit(1),
    hearthland.from("entity_roles").select("role").eq("entity_id", id).eq("account_id", user.id).eq("status", "active").maybeSingle(),
  ]);
  if (entity.error || !entity.data) notFound();

  const accountIsActive = account.data?.account_status === "active";
  const isOwner = entity.data.owner_account_id === user.id;
  const hasMembership = Boolean(memberships.data?.length) || Boolean(role.data);
  const canManage = isOwner || role.data?.role === "owner" || role.data?.role === "administrator";
  if (!accountIsActive || (!isOwner && !hasMembership)) {
    return <main className={styles.denied}>
      <span>COMMUNITY MEMBER SPACE</span>
      <h1>Active Community membership is required.</h1>
      <p>This workspace contains member-only tasks, gatherings and check-ins. Public Community information remains available on the directory page.</p>
      <Link href={`/communities/${entity.data.slug}`} prefetch={false}>Return to {entity.data.title} →</Link>
    </main>;
  }

  const today = new Date().toISOString().slice(0, 10);
  const [groups, myGroupMemberships, tasks, meetings, decisions, pulseCycles, myPulseResponses, needs, camps] = await Promise.all([
    hearthland.from("community_working_groups").select("id, title, description, coordinator_account_id, group_status").eq("community_entity_id", id).in("group_status", ["active", "paused"]).order("title"),
    hearthland.from("working_group_members").select("working_group_id, member_role, status").eq("account_id", user.id).eq("status", "active"),
    hearthland.from("tasks").select("id, working_group_id, title, description, assignee_account_id, due_date, status, priority").eq("entity_id", id).is("archived_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(100),
    hearthland.from("community_meetings").select("id, working_group_id, title, starts_at, ends_at, agenda, meeting_status").eq("community_entity_id", id).eq("visibility", "members").order("starts_at", { ascending: false }).limit(60),
    hearthland.from("community_decisions").select("id, meeting_id, title, description, decision_status, decided_at, created_at").eq("community_entity_id", id).eq("visibility", "members").neq("decision_status", "archived").order("created_at", { ascending: false }).limit(60),
    hearthland.from("community_pulse_cycles").select("id, title, opens_at, closes_at, cycle_status").eq("community_entity_id", id).in("cycle_status", ["open", "closed"]).order("opens_at", { ascending: false }).limit(12),
    hearthland.from("community_pulse_responses").select("cycle_id, submitted_at, updated_at").eq("account_id", user.id).order("submitted_at", { ascending: false }).limit(20),
    hearthland.from("needs").select("id, title, category, description, urgency, quantity, status").eq("entity_id", id).is("archived_at", null).in("status", ["open", "discussion"]).order("created_at", { ascending: false }).limit(40),
    hearthland.from("building_camps").select("entity_id, location, country, start_date, end_date, purpose, camp_status").eq("host_entity_id", id).gte("end_date", today).in("camp_status", ["published", "applications_open", "applications_closed", "active"]).order("start_date").limit(12),
  ]);

  const campIds = (camps.data ?? []).flatMap((camp) => typeof camp.entity_id === "string" ? [camp.entity_id] : []);
  const campEntities = campIds.length
    ? await hearthland.from("entities").select("id, title, slug").in("id", campIds).eq("publication_status", "published").is("archived_at", null)
    : { data: [], error: null };
  const campNames = new Map((campEntities.data ?? []).map((camp) => [camp.id as string, { title: camp.title as string, slug: camp.slug as string }]));
  const visibleCamps = (camps.data ?? []).filter((camp) => campNames.has(camp.entity_id as string));
  const myGroupRole = new Map((myGroupMemberships.data ?? []).map((membership) => [membership.working_group_id as string, membership.member_role as string]));
  const groupNames = new Map((groups.data ?? []).map((group) => [group.id as string, group.title as string]));
  const submittedCycles = new Set((myPulseResponses.data ?? []).map((response) => response.cycle_id as string));
  const now = new Date().getTime();
  const currentPulse = (pulseCycles.data ?? []).find((cycle) => {
    if (cycle.cycle_status !== "open") return false;
    const opens = new Date(cycle.opens_at as string).getTime();
    const closes = cycle.closes_at ? new Date(cycle.closes_at as string).getTime() : Number.POSITIVE_INFINITY;
    return opens <= now && closes > now;
  }) ?? null;
  const upcomingMeetings = (meetings.data ?? []).filter((meeting) => meeting.meeting_status === "scheduled" && new Date(meeting.starts_at as string).getTime() >= now).reverse();
  const openTasks = (tasks.data ?? []).filter((task) => task.status !== "completed");
  const myOpenTasks = openTasks.filter((task) => task.assignee_account_id === user.id);
  const queryFailed = [groups, myGroupMemberships, tasks, meetings, decisions, pulseCycles, myPulseResponses, needs, camps, campEntities]
    .some((result) => Boolean(result.error));

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
      <nav aria-label="Member-space navigation">
        {canManage && <Link href={`/manage/communities/${id}`} prefetch={false}>Manage Community</Link>}
        <Link href={`/communities/${entity.data.slug}`} prefetch={false}>Public page</Link>
        <Link href="/dashboard" prefetch={false}>Dashboard</Link>
      </nav>
    </header>

    <section className={styles.hero}>
      <div><span>COMMUNITY MEMBER SPACE</span><h1>{entity.data.title}</h1><p>{entity.data.short_description || "Shared work, gatherings and gentle signals for the people already caring for this place."}</p></div>
      <aside><strong>{myOpenTasks.length}</strong><span>task{myOpenTasks.length === 1 ? "" : "s"} assigned to you</span></aside>
    </section>

    {queryFailed && <section className={styles.failure} role="status"><strong>Some member information could not be loaded.</strong><p>The sections below only show rows the current account is permitted to read. Refresh to try again.</p></section>}

    <section className={styles.metrics} aria-label="Community member summary">
      <article><strong>{myGroupRole.size}</strong><span>Your working groups</span></article>
      <article><strong>{openTasks.length}</strong><span>Open Community tasks</span></article>
      <article><strong>{upcomingMeetings.length}</strong><span>Upcoming meetings</span></article>
      <article><strong>{needs.data?.length ?? 0}</strong><span>Current needs</span></article>
    </section>

    <div className={styles.layout}>
      <div className={styles.mainColumn}>
        <section className={styles.section} aria-labelledby="member-groups">
          <header><div><span>WORKING GROUPS</span><h2 id="member-groups">Your groups and the wider Community</h2></div><p>Group membership is shown only for your own account.</p></header>
          {(groups.data ?? []).length ? <div className={styles.groupGrid}>{(groups.data ?? []).map((group) => {
            const membershipRole = myGroupRole.get(group.id as string);
            const isCoordinator = group.coordinator_account_id === user.id || membershipRole === "coordinator";
            return <article key={group.id} data-mine={Boolean(membershipRole || isCoordinator)}><div><span>{membershipRole || (isCoordinator ? "coordinator" : group.group_status)}</span>{(membershipRole || isCoordinator) && <em>Your group</em>}</div><h3>{group.title}</h3><p>{group.description || "This group has not added a description yet."}</p></article>;
          })}</div> : <Empty title="No active working groups" text="When organisers create a working group, members will see it here." />}
        </section>

        <section className={styles.section} aria-labelledby="member-tasks">
          <header><div><span>SHARED TASKS</span><h2 id="member-tasks">Visible work and next actions</h2></div><p>You can update the status of tasks assigned to you.</p></header>
          {(tasks.data ?? []).length ? <div className={styles.taskList}>{(tasks.data ?? []).map((task) => {
            const assignedToMe = task.assignee_account_id === user.id;
            const currentStatus = typeof task.status === "string" && taskStatuses.has(task.status) ? task.status as "todo" | "in_progress" | "blocked" | "completed" : "todo";
            return <article key={task.id} data-complete={task.status === "completed"}>
              <i data-priority={task.priority} />
              <div><strong>{task.title}</strong><p>{task.description || "No additional details."}</p><small>{task.working_group_id ? groupNames.get(task.working_group_id as string) || "Working group" : "Whole Community"} · {task.due_date ? `Due ${shortDate(task.due_date as string)}` : "No due date"}</small></div>
              {assignedToMe ? <MemberTaskStatus communityId={id} taskId={task.id as string} initialStatus={currentStatus} taskTitle={task.title as string} /> : <span>{titleCase(task.status as string)}</span>}
            </article>;
          })}</div> : <Empty title="No Community tasks" text="Shared actions will appear here when the Community is ready to coordinate them." />}
        </section>

        <section className={styles.section} aria-labelledby="member-gatherings">
          <header><div><span>GATHERINGS</span><h2 id="member-gatherings">Meetings and upcoming Building Camps</h2></div><p>Only member-visible meetings and published Camps are included.</p></header>
          <div className={styles.splitLists}>
            <div><h3>Community meetings</h3>{upcomingMeetings.length ? upcomingMeetings.map((meeting) => <article key={meeting.id}><time>{shortDate(meeting.starts_at as string, true)}</time><strong>{meeting.title}</strong><p>{meeting.agenda || "Agenda to be added."}</p><small>{meeting.working_group_id ? groupNames.get(meeting.working_group_id as string) || "Working group" : "Whole Community"}</small></article>) : <p className={styles.inlineEmpty}>No upcoming member meetings.</p>}</div>
            <div><h3>Building Camps</h3>{visibleCamps.length ? visibleCamps.map((camp) => {
              const campEntity = campNames.get(camp.entity_id as string);
              return <article key={camp.entity_id}><time>{shortDate(camp.start_date as string)} – {shortDate(camp.end_date as string)}</time><strong>{campEntity?.title}</strong><p>{camp.purpose || `${camp.location}, ${camp.country}`}</p>{campEntity && <Link href={`/building-camps/${campEntity.slug}`} prefetch={false}>View Camp →</Link>}</article>;
            }) : <p className={styles.inlineEmpty}>No upcoming Camps hosted by this Community.</p>}</div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="member-decisions">
          <header><div><span>SHARED RECORD</span><h2 id="member-decisions">Community decisions</h2></div><p>Manager-only decisions are excluded by both the query and database policy.</p></header>
          {(decisions.data ?? []).length ? <div className={styles.decisionList}>{(decisions.data ?? []).map((decision) => <article key={decision.id}><span data-status={decision.decision_status}>{titleCase(decision.decision_status as string)}</span><div><strong>{decision.title}</strong><p>{decision.description || "No public member note was added."}</p></div><time>{shortDate((decision.decided_at || decision.created_at) as string)}</time></article>)}</div> : <Empty title="No member-visible decisions" text="Approved and proposed decisions shared with members will appear here." />}
        </section>
      </div>

      <aside className={styles.rail}>
        <section className={styles.pulseCard}>
          <span>YOUR COMMUNITY PULSE</span>
          {currentPulse ? <><h2>{currentPulse.title}</h2><p>Your response is private. Organisers can only access aggregate averages after the minimum response threshold is met.</p><div data-complete={submittedCycles.has(currentPulse.id as string)}>{submittedCycles.has(currentPulse.id as string) ? "Response submitted" : "Your check-in is waiting"}</div><Link href={`/community-pulse/${currentPulse.id}`} prefetch={false}>{submittedCycles.has(currentPulse.id as string) ? "Review my response" : "Complete private check-in"} →</Link></> : <><h2>No open check-in</h2><p>When organisers open the next Pulse cycle, your private participation link will appear here.</p>{submittedCycles.size > 0 && <small>You have participated in {submittedCycles.size} previous cycle{submittedCycles.size === 1 ? "" : "s"}.</small>}</>}
        </section>

        <section className={styles.needsCard}>
          <span>COMMUNITY NEEDS</span><h2>Where support is useful now</h2>
          {(needs.data ?? []).length ? <div>{(needs.data ?? []).map((need) => <article key={need.id}><i data-urgency={need.urgency} /><div><strong>{need.title}</strong><small>{titleCase(need.category as string)} · {titleCase(need.status as string)}</small>{need.description && <p>{need.description}</p>}</div></article>)}</div> : <p>No open needs are listed for this Community.</p>}
        </section>

        <section className={styles.privacyCard}><strong>Member-safe by design</strong><p>This page uses your authenticated Community membership. It does not request manager-only meetings, decisions, Pulse responses, private comments or member contact information.</p></section>
      </aside>
    </div>
  </main>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className={styles.empty}><strong>{title}</strong><p>{text}</p></div>;
}
