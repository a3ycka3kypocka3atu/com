import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../lib/supabase/server";
import styles from "./my-camps.module.css";

export const metadata: Metadata = {
  title: "My Camps",
  description: "Preparation, programme and updates for your accepted Hearthland Building Camps.",
};

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function humanise(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value || "Date to be confirmed";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dateRange(start: string, end: string) {
  if (!start && !end) return "Dates to be confirmed";
  if (!end || start === end) return dayLabel(start || end);
  return `${dayLabel(start)} – ${dayLabel(end)}`;
}

function timeLabel(value: unknown) {
  const time = text(value);
  return time ? time.slice(0, 5) : "Flexible";
}

function personInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "H";
}

function StatePage({ title, body }: { title: string; body: string }) {
  return (
    <main className={styles.statePage}>
      <span>MY CAMPS</span>
      <h1>{title}</h1>
      <p>{body}</p>
      <div>
        <Link href="/dashboard" prefetch={false}>Return to dashboard</Link>
        <Link href="/building-camps" prefetch={false}>Explore Building Camps</Link>
      </div>
    </main>
  );
}

export default async function MyCampsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent("/my-camps")}`);

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const participantsResult = await hearthland
    .from("camp_participants")
    .select("id, camp_entity_id, application_id, roles, participant_status, joined_via, accepted_at, checked_in_at, completed_at")
    .eq("account_id", user.id)
    .in("participant_status", ["accepted", "checked_in", "completed"])
    .order("accepted_at", { ascending: false });

  if (participantsResult.error) {
    return <StatePage title="Your Camp workspace could not be loaded." body="Please refresh and try again. Your accepted participant record remains stored safely." />;
  }

  const participantRows = participantsResult.data ?? [];
  if (participantRows.length === 0) {
    return <StatePage title="You do not have an accepted Camp yet." body="When a Camp organiser accepts your application or invitation, its schedule, preparation and participant updates will appear here." />;
  }

  const campIds = Array.from(new Set(participantRows.map((row) => text(row.camp_entity_id)).filter(Boolean)));
  const [
    entitiesResult,
    campsResult,
    applicationsResult,
    scheduleResult,
    preparationResult,
    announcementsResult,
    teamResult,
    buildItemsResult,
  ] = await Promise.all([
    hearthland
      .from("entities")
      .select("id, title, slug, short_description")
      .in("id", campIds)
      .eq("entity_type", "building_camp")
      .is("archived_at", null),
    hearthland
      .from("building_camps")
      .select("entity_id, location, country, region, start_date, end_date, purpose, languages, accommodation_type, food_model, contribution_type, contribution_details, camp_status")
      .in("entity_id", campIds),
    hearthland
      .from("camp_applications")
      .select("id, camp_entity_id, selected_roles, arrival_date, departure_date, accommodation_requirement, resources_offered, status")
      .eq("applicant_account_id", user.id)
      .in("camp_entity_id", campIds)
      .is("archived_at", null),
    hearthland
      .from("camp_schedule_items")
      .select("id, camp_entity_id, scheduled_date, start_time, end_time, title, item_type, location, description, session_mode, audience")
      .in("camp_entity_id", campIds)
      .order("scheduled_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: false }),
    hearthland
      .from("camp_preparation_sections")
      .select("id, camp_entity_id, section_type, title, body, sort_order")
      .in("camp_entity_id", campIds)
      .order("sort_order", { ascending: true }),
    hearthland
      .from("camp_announcements")
      .select("id, camp_entity_id, title, body, published_at, created_by_account_id")
      .in("camp_entity_id", campIds)
      .is("archived_at", null)
      .order("published_at", { ascending: false })
      .limit(100),
    hearthland
      .from("camp_team")
      .select("id, camp_entity_id, account_id, role, is_master")
      .in("camp_entity_id", campIds)
      .order("is_master", { ascending: false }),
    hearthland
      .from("camp_build_items")
      .select("id, camp_entity_id, name, description, status, progress_percent, progress_note, materials_note, tools_note, sort_order")
      .in("camp_entity_id", campIds)
      .order("sort_order", { ascending: true }),
  ]);

  const operationalResults = [
    entitiesResult,
    campsResult,
    applicationsResult,
    scheduleResult,
    preparationResult,
    announcementsResult,
    teamResult,
    buildItemsResult,
  ];
  if (operationalResults.some((result) => result.error)) {
    return <StatePage title="Some participant-only Camp data is unavailable." body="Your participant access was found, but the Camp programme could not be assembled completely. Please try again after the organiser workspace is available." />;
  }

  const accountIds = Array.from(new Set(
    (teamResult.data ?? []).map((row) => text(row.account_id)).filter(Boolean),
  ));
  const profilesResult = accountIds.length
    ? await hearthland
      .from("person_profiles")
      .select("account_id, display_name, headline")
      .in("account_id", accountIds)
      .is("archived_at", null)
    : { data: [], error: null };

  const entities = new Map((entitiesResult.data ?? []).map((row) => [text(row.id), row]));
  const camps = new Map((campsResult.data ?? []).map((row) => [text(row.entity_id), row]));
  const applications = new Map((applicationsResult.data ?? []).map((row) => [text(row.camp_entity_id), row]));
  const profiles = new Map((profilesResult.data ?? []).map((row) => [text(row.account_id), row]));

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <nav aria-label="My Camps navigation">
          <Link href="/dashboard" prefetch={false}>Dashboard</Link>
          <Link href="/participation" prefetch={false}>Participation requests</Link>
          <Link href="/messages" prefetch={false}>Messages</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span>ACCEPTED PARTICIPANT WORKSPACE</span>
          <h1>My Camps</h1>
          <p>Everything the Camp team has shared for your arrival, programme and practical participation—kept in one live workspace.</p>
        </div>
        <strong>{participantRows.length}<small>active or completed Camp{participantRows.length === 1 ? "" : "s"}</small></strong>
      </section>

      <div className={styles.campList}>
        {participantRows.map((participant) => {
          const campId = text(participant.camp_entity_id);
          const entity = entities.get(campId);
          const camp = camps.get(campId);
          const application = applications.get(campId);
          const schedule = (scheduleResult.data ?? []).filter((row) => text(row.camp_entity_id) === campId);
          const preparation = (preparationResult.data ?? []).filter((row) => text(row.camp_entity_id) === campId);
          const announcements = (announcementsResult.data ?? []).filter((row) => text(row.camp_entity_id) === campId);
          const team = (teamResult.data ?? []).filter((row) => text(row.camp_entity_id) === campId);
          const buildItems = (buildItemsResult.data ?? []).filter((row) => text(row.camp_entity_id) === campId);
          const slug = text(entity?.slug);
          const roles = stringArray(participant.roles);
          const arrival = nullableText(application?.arrival_date) ?? text(camp?.start_date);
          const departure = nullableText(application?.departure_date) ?? text(camp?.end_date);

          return (
            <article className={styles.campCard} key={text(participant.id)}>
              <header className={styles.campHeader}>
                <div>
                  <span>{humanise(text(participant.participant_status))} participant</span>
                  <h2>{text(entity?.title) || "Building Camp"}</h2>
                  <p>{[text(camp?.location), text(camp?.region), text(camp?.country)].filter(Boolean).join(", ")}</p>
                </div>
                <div className={styles.headerActions}>
                  {slug ? <Link href={`/building-camps/${slug}`} prefetch={false}>Public Camp page</Link> : null}
                  {application?.id ? <Link href={`/messages/new?context=camp_application&id=${encodeURIComponent(text(application.id))}`} prefetch={false}>Message Camp team</Link> : null}
                </div>
              </header>

              <div className={styles.participantSummary}>
                <dl><dt>Your Camp dates</dt><dd>{dateRange(arrival, departure)}</dd></dl>
                <dl><dt>Your roles</dt><dd>{roles.length ? roles.map(humanise).join(" · ") : "Participant"}</dd></dl>
                <dl><dt>Camp status</dt><dd>{humanise(text(camp?.camp_status) || "accepted")}</dd></dl>
                <dl><dt>Joined through</dt><dd>{humanise(text(participant.joined_via) || "application")}</dd></dl>
              </div>

              {announcements.length > 0 ? (
                <section className={styles.announcements}>
                  <div className={styles.sectionHeading}><span>LATEST UPDATES</span><h3>Announcements</h3></div>
                  <div>{announcements.map((announcement) => <article key={text(announcement.id)}><header><strong>{text(announcement.title)}</strong><time>{dayLabel(text(announcement.published_at).slice(0, 10))}</time></header><p>{text(announcement.body)}</p></article>)}</div>
                </section>
              ) : null}

              <div className={styles.contentGrid}>
                <section className={styles.programme}>
                  <div className={styles.sectionHeading}><span>PARTICIPANT PROGRAMME</span><h3>Schedule</h3></div>
                  {schedule.length ? <div>{schedule.map((item) => <article key={text(item.id)}><time>{dayLabel(text(item.scheduled_date))}<small>{timeLabel(item.start_time)}{item.end_time ? `–${timeLabel(item.end_time)}` : ""}</small></time><div><strong>{text(item.title)}</strong><span>{humanise(text(item.item_type))}{item.session_mode ? ` · ${humanise(text(item.session_mode))}` : ""}</span>{item.location ? <small>{text(item.location)}</small> : null}{item.description ? <p>{text(item.description)}</p> : null}</div></article>)}</div> : <p className={styles.empty}>The organiser has not published the participant programme yet.</p>}
                </section>

                <section className={styles.practical}>
                  <div className={styles.sectionHeading}><span>BEFORE YOU ARRIVE</span><h3>Practical details</h3></div>
                  <div className={styles.practicalFacts}>
                    <dl><dt>Accommodation</dt><dd>{nullableText(camp?.accommodation_type) || "To be confirmed"}</dd></dl>
                    <dl><dt>Food</dt><dd>{nullableText(camp?.food_model) || "To be confirmed"}</dd></dl>
                    <dl><dt>Contribution</dt><dd>{nullableText(camp?.contribution_details) || humanise(text(camp?.contribution_type) || "To be confirmed")}</dd></dl>
                    <dl><dt>Languages</dt><dd>{stringArray(camp?.languages).join(" · ") || "To be confirmed"}</dd></dl>
                    {application?.accommodation_requirement ? <dl><dt>Your accommodation note</dt><dd>{text(application.accommodation_requirement)}</dd></dl> : null}
                    {application?.resources_offered ? <dl><dt>What you offered</dt><dd>{text(application.resources_offered)}</dd></dl> : null}
                  </div>
                  {preparation.length ? <div className={styles.preparation}>{preparation.map((section) => <article key={text(section.id)}><span>{humanise(text(section.section_type))}</span><strong>{text(section.title)}</strong><p>{text(section.body) || "Details will be added by the Camp team."}</p></article>)}</div> : <p className={styles.empty}>Preparation notes will appear here when the Camp team publishes them.</p>}
                </section>
              </div>

              <div className={styles.contentGrid}>
                <section className={styles.team}>
                  <div className={styles.sectionHeading}><span>PEOPLE TO KNOW</span><h3>Organisers & Masters</h3></div>
                  {team.length ? <div>{team.map((member) => {
                    const profile = profiles.get(text(member.account_id));
                    const name = text(profile?.display_name) || (member.is_master ? "Camp Master" : "Camp organiser");
                    return <article key={text(member.id)}><span aria-hidden="true">{personInitials(name)}</span><div><strong>{name}</strong><small>{humanise(text(member.role))}{member.is_master ? " · Master / Teacher" : ""}</small>{profile?.headline ? <p>{text(profile.headline)}</p> : null}</div></article>;
                  })}</div> : <p className={styles.empty}>The public Camp team has not been listed yet.</p>}
                </section>

                <section className={styles.builds}>
                  <div className={styles.sectionHeading}><span>PRACTICAL WORK</span><h3>Build progress</h3></div>
                  {buildItems.length ? <div>{buildItems.map((item) => {
                    const progress = typeof item.progress_percent === "number" ? item.progress_percent : 0;
                    return <article key={text(item.id)}><header><strong>{text(item.name)}</strong><span>{humanise(text(item.status))} · {progress}%</span></header><div><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>{item.description ? <p>{text(item.description)}</p> : null}{item.progress_note ? <small>{text(item.progress_note)}</small> : null}{item.materials_note || item.tools_note ? <details><summary>Materials and tools</summary>{item.materials_note ? <p><b>Materials:</b> {text(item.materials_note)}</p> : null}{item.tools_note ? <p><b>Tools:</b> {text(item.tools_note)}</p> : null}</details> : null}</article>;
                  })}</div> : <p className={styles.empty}>The Camp team has not added practical build items yet.</p>}
                </section>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
