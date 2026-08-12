"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { createClient } from "../../../../lib/supabase/browser";
import styles from "./camp-operations.module.css";

export type PersonSummary = {
  accountId: string;
  displayName: string;
  headline: string;
  location: string;
};

type CampSummary = {
  id: string; title: string; slug: string; shortDescription: string; publicationStatus: string;
  location: string; country: string; region: string | null; startDate: string; endDate: string;
  purpose: string; maxParticipants: number; applicationDeadline: string | null; languages: string[];
  accommodationType: string | null; foodModel: string | null; contributionDetails: string | null; campStatus: string;
};

type Application = {
  id: string; applicantAccountId: string; selectedRoles: string[]; message: string; skillsOffered: string;
  learningInterests: string; arrivalDate: string | null; departureDate: string | null; accommodationRequirement: string | null;
  resourcesOffered: string; futureCommunityInterest: string | null; status: string; createdAt: string;
};

type Participant = {
  id: string; accountId: string; applicationId: string | null; roles: string[]; participantStatus: string;
  joinedVia: string; acceptedAt: string; checkedInAt: string | null; completedAt: string | null;
};

type TeamMember = { id: string; accountId: string; role: string; isMaster: boolean; publicVisibility: boolean };
type BuildItem = { id: string; name: string; description: string; category: string | null; leadAccountId: string | null; status: string; targetParticipantsMin: number | null; targetParticipantsMax: number | null; materialsNote: string; toolsNote: string; sortOrder: number; progressPercent: number; progressNote: string; progressUpdatedAt: string | null; resultImages: Array<{ id: string; altText: string; url: string }> };
type Announcement = { id: string; title: string; body: string; audience: string; notifyParticipants: boolean; publishedAt: string; createdByAccountId: string };
type Preparation = { id: string; sectionType: string; title: string; body: string; audience: string; sortOrder: number };
type ScheduleItem = { id: string; scheduledDate: string; startTime: string | null; endTime: string | null; title: string; itemType: string; leaderAccountId: string | null; learningTopicEntityId: string | null; buildItemId: string | null; capacity: number | null; sessionMode: string | null; audience: string; location: string | null; description: string };
type CampResult = { campEntityId: string; publicationStatus: string; whatWeBuilt: string; whatWeLearned: string; mainResults: string; whatHappensNext: string; participantsCount: number; mastersCount: number; workshopsCount: number; durationDays: number; publishedAt: string | null };

export type CampOperationsData = {
  camp: CampSummary;
  people: Record<string, PersonSummary>;
  applications: Application[];
  participants: Participant[];
  team: TeamMember[];
  buildItems: BuildItem[];
  announcements: Announcement[];
  preparation: Preparation[];
  schedule: ScheduleItem[];
  result: CampResult | null;
  topics: Array<{ id: string; title: string }>;
};

const APPLICATION_ACTIONS = [
  ["accepted", "Accept"], ["waiting_list", "Waitlist"], ["declined", "Decline"], ["reviewing", "Review"],
] as const;
const PARTICIPANT_STATUSES = ["accepted", "checked_in", "completed", "cancelled", "no_show"];
const BUILD_STATUSES = ["planned", "preparing", "in_progress", "completed", "postponed"];
const PREPARATION_TYPES = ["what_to_bring", "arrival", "transport", "accommodation", "food", "tools", "safety", "contact", "other"];
const PROGRAMME_TYPES = ["practical_workshop", "lesson", "build", "community", "food", "wellbeing", "culture", "free_time", "other"];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
    : value;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "H";
}

export default function CampOperations({ initialData }: { initialData: CampOperationsData }) {
  const router = useRouter();
  const { camp, people } = initialData;
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [prepType, setPrepType] = useState("what_to_bring");
  const acceptedCount = initialData.participants.filter((person) => ["accepted", "checked_in", "completed"].includes(person.participantStatus)).length;
  const pendingCount = initialData.applications.filter((application) => ["new", "reviewing", "contacted"].includes(application.status)).length;
  const completedBuilds = initialData.buildItems.filter((item) => item.status === "completed").length;
  const capacityPercent = camp.maxParticipants ? Math.min(100, Math.round((acceptedCount / camp.maxParticipants) * 100)) : 0;

  const selectedPreparation = useMemo(
    () => initialData.preparation.find((section) => section.sectionType === prepType),
    [initialData.preparation, prepType],
  );

  async function mutate(key: string, payload: Record<string, unknown>) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/manage/camps/${camp.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Camp update was not saved.");
      setNotice({ tone: "success", message: "Saved to the live Camp workspace." });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The Camp update was not saved." });
      return false;
    } finally {
      setBusy("");
    }
  }

  function formPayload(form: HTMLFormElement): Record<string, unknown> {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function submitForm(event: FormEvent<HTMLFormElement>, key: string, action: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formPayload(form);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) payload[submitter.name] = submitter.value;
    if (action === "announcement") payload.notifyParticipants = new FormData(form).has("notifyParticipants");
    const saved = await mutate(key, { action, ...payload });
    if (saved && ["announcement", "workshop"].includes(action)) form.reset();
  }

  async function uploadResultImage(buildItem: BuildItem, file: File | undefined) {
    if (!file || busy) return;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setNotice({ tone: "error", message: "Use a JPEG, PNG or WebP result image." });
      return;
    }
    if (file.size < 1 || file.size > 15 * 1024 * 1024) {
      setNotice({ tone: "error", message: "Result images must be smaller than 15 MB." });
      return;
    }

    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const objectPath = `entities/${camp.id}/results/${buildItem.id}/${crypto.randomUUID()}.${extension}`;
    setBusy(`media-${buildItem.id}`);
    setNotice(null);
    const supabase = createClient();
    try {
      const upload = await supabase.storage.from("hearthland-entity-media").upload(objectPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) throw upload.error;
      const response = await fetch(`/api/manage/camps/${camp.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "build_media",
          buildItemId: buildItem.id,
          objectPath,
          mimeType: file.type,
          sizeBytes: file.size,
          altText: `${buildItem.name} completed at ${camp.title}`,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        await supabase.storage.from("hearthland-entity-media").remove([objectPath]);
        throw new Error(result.error || "The result image could not be saved.");
      }
      setNotice({ tone: "success", message: "The completed structure image is now part of the Camp result." });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The result image could not be saved." });
    } finally {
      setBusy("");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <nav aria-label="Camp workspace navigation">
          <a href="#applications">Applications</a>
          <a href="#build">Build</a>
          <a href="#programme">Programme</a>
          <Link href="/manage" prefetch={false}>All managed places</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span>BUILDING CAMP · OPERATIONS</span>
          <h1>{camp.title}</h1>
          <p>{camp.shortDescription || camp.purpose || "Coordinate the people, preparation and practical work behind this Camp."}</p>
          <div className={styles.heroMeta}>
            <span>{dateLabel(camp.startDate)} — {dateLabel(camp.endDate)}</span>
            <span>{camp.location}</span>
            <span className={styles.status} data-status={camp.campStatus}>{label(camp.campStatus)}</span>
          </div>
        </div>
        <aside>
          <div><strong>{acceptedCount}</strong><span>accepted</span></div>
          <div><strong>{camp.maxParticipants}</strong><span>capacity</span></div>
          <div className={styles.capacity}><i style={{ width: `${capacityPercent}%` }} /></div>
          <small>{capacityPercent}% of participant places filled</small>
        </aside>
      </section>

      <section className={styles.metrics} aria-label="Camp operational summary">
        <article><strong>{initialData.applications.length}</strong><span>applications</span><small>{pendingCount} need review</small></article>
        <article><strong>{initialData.participants.length}</strong><span>participants</span><small>{acceptedCount} active</small></article>
        <article><strong>{initialData.team.length}</strong><span>team members</span><small>{initialData.team.filter((member) => member.isMaster).length} Masters</small></article>
        <article><strong>{completedBuilds}/{initialData.buildItems.length}</strong><span>build items</span><small>completed</small></article>
        <article><strong>{initialData.schedule.length}</strong><span>programme items</span><small>{initialData.schedule.filter((item) => item.itemType.includes("workshop") || item.itemType === "lesson").length} learning sessions</small></article>
      </section>

      {notice ? <div className={styles.notice} data-tone={notice.tone} role="status">{notice.message}</div> : null}

      <section className={styles.section} id="applications">
        <header className={styles.sectionHeader}><div><span>PEOPLE</span><h2>Application pipeline</h2><p>Review the real people asking to join, then accept, waitlist or decline with one clear decision.</p></div><strong>{pendingCount}</strong></header>
        {initialData.applications.length ? (
          <div className={styles.applicationGrid}>
            {initialData.applications.map((application) => {
              const person = people[application.applicantAccountId] ?? { accountId: application.applicantAccountId, displayName: "Hearthland member", headline: "", location: "" };
              return (
                <article className={styles.applicationCard} key={application.id}>
                  <header>
                    <span className={styles.avatar}>{initials(person.displayName)}</span>
                    <div><h3>{person.displayName}</h3><p>{[person.headline, person.location].filter(Boolean).join(" · ") || "Profile details are private or incomplete"}</p></div>
                    <em data-status={application.status}>{label(application.status)}</em>
                  </header>
                  <dl>
                    <div><dt>Roles</dt><dd>{application.selectedRoles.length ? application.selectedRoles.join(", ") : "Open to contribute"}</dd></div>
                    <div><dt>Dates</dt><dd>{application.arrivalDate ? `${dateLabel(application.arrivalDate)} — ${dateLabel(application.departureDate)}` : "Camp dates"}</dd></div>
                    <div><dt>Applied</dt><dd>{dateLabel(application.createdAt)}</dd></div>
                  </dl>
                  {application.message ? <blockquote>{application.message}</blockquote> : null}
                  <div className={styles.detailColumns}>
                    {application.skillsOffered ? <p><strong>Can offer</strong>{application.skillsOffered}</p> : null}
                    {application.learningInterests ? <p><strong>Wants to learn</strong>{application.learningInterests}</p> : null}
                    {application.resourcesOffered ? <p><strong>Resources</strong>{application.resourcesOffered}</p> : null}
                    {application.accommodationRequirement ? <p><strong>Accommodation</strong>{application.accommodationRequirement}</p> : null}
                  </div>
                  <footer>
                    <Link className={styles.messageButton} href={`/messages/new?context=camp_application&id=${application.id}`} prefetch={false}>Message applicant <span aria-hidden="true">→</span></Link>
                    {application.status === "accepted" ? (
                      <span>Manage attendance in the participant list below.</span>
                    ) : APPLICATION_ACTIONS.map(([status, actionLabel]) => (
                      <button className={styles.decisionButton} data-action={status} disabled={Boolean(busy)} key={status} onClick={() => void mutate(`application-${application.id}`, { action: "application_status", applicationId: application.id, status })} type="button">
                        {busy === `application-${application.id}` ? "Saving…" : actionLabel}
                      </button>
                    ))}
                  </footer>
                </article>
              );
            })}
          </div>
        ) : <Empty icon="◎" title="No applications yet" body="When people apply to this Building Camp, their profile, contribution, dates and decision status will appear here." />}
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.section}>
          <header className={styles.compactHeader}><div><span>PARTICIPANTS</span><h2>Arrival and completion</h2></div><strong>{initialData.participants.length}</strong></header>
          {initialData.participants.length ? <div className={styles.peopleList}>
            {initialData.participants.map((participant) => {
              const person = people[participant.accountId] ?? { displayName: "Hearthland member", headline: "", location: "", accountId: participant.accountId };
              return <article key={participant.id}><span className={styles.avatar}>{initials(person.displayName)}</span><div><strong>{person.displayName}</strong><small>{participant.roles.map(label).join(" · ") || "Participant"} · via {participant.joinedVia}</small></div><select aria-label={`Status for ${person.displayName}`} disabled={Boolean(busy)} onChange={(event) => void mutate(`participant-${participant.id}`, { action: "participant_status", participantId: participant.id, status: event.target.value })} value={participant.participantStatus}>{PARTICIPANT_STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></article>;
            })}
          </div> : <Empty icon="○" title="No accepted participants" body="Accept an application and the participant will be added here automatically." />}
        </section>

        <section className={styles.section}>
          <header className={styles.compactHeader}><div><span>TEAM</span><h2>Organisers and Masters</h2></div><strong>{initialData.team.length}</strong></header>
          {initialData.team.length ? <div className={styles.peopleList}>
            {initialData.team.map((member) => {
              const person = people[member.accountId] ?? { displayName: "Hearthland member", headline: "", location: "", accountId: member.accountId };
              return <article key={member.id}><span className={styles.avatar}>{initials(person.displayName)}</span><div><strong>{person.displayName}</strong><small>{member.role}{member.isMaster ? " · Master / Teacher" : ""}</small></div><em>{member.publicVisibility ? "Public" : "Private"}</em></article>;
            })}
          </div> : <Empty icon="◇" title="No Camp team yet" body="Invite organisers and Masters from the main Manage workspace to build the delivery team." />}
        </section>
      </div>

      <section className={styles.section} id="build">
        <header className={styles.sectionHeader}><div><span>PRACTICAL WORK</span><h2>Build progress</h2><p>Keep the Camp’s physical outcomes visible to organisers without turning the work into bureaucracy.</p></div><strong>{completedBuilds}/{initialData.buildItems.length}</strong></header>
        {initialData.buildItems.length ? <div className={styles.buildGrid}>{initialData.buildItems.map((item) => (
          <form className={styles.buildCard} key={item.id} onSubmit={(event) => void submitForm(event, `build-${item.id}`, "build_progress")}>
            <input name="buildItemId" type="hidden" value={item.id} />
            <header><div><span>{item.category || "Build item"}</span><h3>{item.name}</h3></div><strong>{item.progressPercent}%</strong></header>
            <p>{item.description || "No build description has been added yet."}</p>
            <div className={styles.progress}><i style={{ width: `${item.progressPercent}%` }} /></div>
            <div className={styles.formRow}>
              <label>Status<select defaultValue={item.status} name="status">{BUILD_STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
              <label>Progress<input defaultValue={item.progressPercent} max="100" min="0" name="progressPercent" type="number" /></label>
            </div>
            <label>Progress note<textarea defaultValue={item.progressNote} name="progressNote" placeholder="What moved, what is blocked, what happens next…" rows={3} /></label>
            {(item.materialsNote || item.toolsNote) ? <details><summary>Materials and tools</summary>{item.materialsNote ? <p><strong>Materials:</strong> {item.materialsNote}</p> : null}{item.toolsNote ? <p><strong>Tools:</strong> {item.toolsNote}</p> : null}</details> : null}
            {item.resultImages.length ? <div className={styles.resultImages}>{item.resultImages.map((image) => <Image alt={image.altText || `${item.name} result`} height={180} key={image.id} src={image.url} unoptimized width={280} />)}</div> : null}
            <label className={styles.imageUpload}>Completed structure image<input accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy) || item.status !== "completed"} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void uploadResultImage(item, file); }} type="file" /><small>{item.status === "completed" ? (busy === `media-${item.id}` ? "Uploading…" : "JPEG, PNG or WebP · up to 15 MB") : "Mark this structure completed before publishing images."}</small></label>
            <button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">{busy === `build-${item.id}` ? "Saving…" : "Save progress"}</button>
          </form>
        ))}</div> : <Empty icon="▱" title="No build items defined" body="Build items are created with the Camp plan. Once added, organisers can track status, percentage and field notes here." />}
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.section}>
          <header className={styles.compactHeader}><div><span>COMMUNICATION</span><h2>Announcements</h2></div><strong>{initialData.announcements.length}</strong></header>
          <form className={styles.form} onSubmit={(event) => void submitForm(event, "announcement", "announcement")}>
            <label>Title<input maxLength={180} name="title" placeholder="Tomorrow’s arrival point" required /></label>
            <label>Message<textarea maxLength={5000} name="body" placeholder="Give participants a clear, useful update…" required rows={4} /></label>
            <div className={styles.formRow}><label>Audience<select defaultValue="participants" name="audience"><option value="participants">Participants</option><option value="public">Public</option></select></label><label className={styles.check}><input defaultChecked name="notifyParticipants" type="checkbox" value="true" />Notify participants</label></div>
            <button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">{busy === "announcement" ? "Publishing…" : "Publish announcement"}</button>
          </form>
          {initialData.announcements.length ? <div className={styles.feed}>{initialData.announcements.map((announcement) => <article key={announcement.id}><header><strong>{announcement.title}</strong><em>{label(announcement.audience)}</em></header><p>{announcement.body}</p><small>{dateLabel(announcement.publishedAt)} · {people[announcement.createdByAccountId]?.displayName || "Camp team"}</small></article>)}</div> : <Empty icon="✦" title="No announcements" body="Share the first arrival, preparation or programme update with accepted participants." />}
        </section>

        <section className={styles.section}>
          <header className={styles.compactHeader}><div><span>BEFORE ARRIVAL</span><h2>Preparation guide</h2></div><strong>{initialData.preparation.length}/{PREPARATION_TYPES.length}</strong></header>
          <form className={styles.form} key={prepType} onSubmit={(event) => void submitForm(event, "preparation", "preparation")}>
            <label>Section<select name="sectionType" onChange={(event) => setPrepType(event.target.value)} value={prepType}>{PREPARATION_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label>
            <label>Heading<input defaultValue={selectedPreparation?.title || label(prepType)} maxLength={180} name="title" required /></label>
            <label>Guidance<textarea defaultValue={selectedPreparation?.body || ""} maxLength={6000} name="body" placeholder="Practical, reassuring information for participants…" rows={6} /></label>
            <div className={styles.formRow}><label>Audience<select defaultValue={selectedPreparation?.audience || "participants"} name="audience"><option value="participants">Participants</option><option value="public">Public</option></select></label><label>Order<input defaultValue={selectedPreparation?.sortOrder || 0} min="0" name="sortOrder" type="number" /></label></div>
            <button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">{busy === "preparation" ? "Saving…" : selectedPreparation ? "Update section" : "Add section"}</button>
          </form>
        </section>
      </div>

      <section className={styles.section} id="programme">
        <header className={styles.sectionHeader}><div><span>LEARNING IN PRACTICE</span><h2>Workshops and programme</h2><p>Add real sessions led by the Camp team and connect them to build work or Hearthland learning topics.</p></div><strong>{initialData.schedule.length}</strong></header>
        <div className={styles.programmeLayout}>
          <form className={styles.form} onSubmit={(event) => void submitForm(event, "workshop", "workshop")}>
            <div className={styles.formRow}><label>Date<input defaultValue={camp.startDate} max={camp.endDate} min={camp.startDate} name="scheduledDate" required type="date" /></label><label>Type<select defaultValue="practical_workshop" name="itemType">{PROGRAMME_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label></div>
            <label>Title<input maxLength={220} name="title" placeholder="Timber framing foundations" required /></label>
            <div className={styles.formRow}><label>Starts<input name="startTime" type="time" /></label><label>Ends<input name="endTime" type="time" /></label></div>
            <div className={styles.formRow}><label>Mode<select defaultValue="practical" name="sessionMode"><option value="practical">Practical</option><option value="theoretical">Theoretical</option><option value="both">Both</option></select></label><label>Capacity<input min="1" name="capacity" placeholder="Open" type="number" /></label></div>
            <label>Leader<select defaultValue="" name="leaderAccountId"><option value="">Team to assign</option>{initialData.team.map((member) => <option key={member.id} value={member.accountId}>{people[member.accountId]?.displayName || "Hearthland member"} · {member.role}</option>)}</select></label>
            <label>Learning topic<select defaultValue="" name="learningTopicEntityId"><option value="">No linked topic</option>{initialData.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
            <label>Build item<select defaultValue="" name="buildItemId"><option value="">No linked build item</option>{initialData.buildItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <div className={styles.formRow}><label>Audience<select defaultValue="public" name="audience"><option value="public">Public</option><option value="participants">Participants</option></select></label><label>Location<input name="location" placeholder="Workshop shelter" /></label></div>
            <label>Description<textarea maxLength={3000} name="description" placeholder="What will happen and what should people bring?" rows={3} /></label>
            <button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">{busy === "workshop" ? "Adding…" : "Add to programme"}</button>
          </form>
          {initialData.schedule.length ? <div className={styles.schedule}>{initialData.schedule.map((item) => <article key={item.id}><time dateTime={item.scheduledDate}>{dateLabel(item.scheduledDate)}</time><div><span>{[item.startTime?.slice(0, 5), label(item.itemType)].filter(Boolean).join(" · ")}</span><h3>{item.title}</h3><p>{item.description || [item.location, item.sessionMode ? label(item.sessionMode) : ""].filter(Boolean).join(" · ") || "Programme details to follow."}</p></div><em>{item.audience}</em></article>)}</div> : <Empty icon="◷" title="No programme items" body="Add the first practical workshop, build block or community session to make the Camp rhythm visible." />}
        </div>
      </section>

      <section className={`${styles.section} ${styles.resultSection}`}>
        <header className={styles.sectionHeader}><div><span>AFTER THE CAMP</span><h2>Result story</h2><p>Draft as the work unfolds. Publish only when this is a faithful record of what the Camp achieved and learned.</p></div><strong>{initialData.result?.publicationStatus === "published" ? "Live" : "Draft"}</strong></header>
        {initialData.result?.publicationStatus === "published" ? <div className={styles.resultMetrics}><span><strong>{initialData.result.participantsCount}</strong> participants</span><span><strong>{initialData.result.mastersCount}</strong> Masters</span><span><strong>{initialData.result.workshopsCount}</strong> workshops</span><span><strong>{initialData.result.durationDays}</strong> days</span></div> : null}
        <form className={styles.resultForm} onSubmit={(event) => void submitForm(event, "result", "camp_result")}>
          <label>What we built<textarea defaultValue={initialData.result?.whatWeBuilt || ""} maxLength={6000} name="whatWeBuilt" placeholder="Physical work completed, improved or prepared…" rows={5} /></label>
          <label>What we learned<textarea defaultValue={initialData.result?.whatWeLearned || ""} maxLength={6000} name="whatWeLearned" placeholder="Skills, practices and shared insights…" rows={5} /></label>
          <label>Main results<textarea defaultValue={initialData.result?.mainResults || ""} maxLength={6000} name="mainResults" placeholder="The most meaningful outcomes for the project and people…" rows={5} /></label>
          <label>What happens next<textarea defaultValue={initialData.result?.whatHappensNext || ""} maxLength={6000} name="whatHappensNext" placeholder="Follow-up work, future gatherings or ways to stay involved…" rows={5} /></label>
          <div className={styles.resultActions}><button className={styles.secondaryButton} disabled={Boolean(busy)} name="publicationStatus" type="submit" value="draft">Save draft</button><button className={styles.primaryButton} disabled={Boolean(busy)} name="publicationStatus" type="submit" value="published">{busy === "result" ? "Saving…" : "Publish Camp result"}</button></div>
        </form>
      </section>
    </main>
  );
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return <div className={styles.empty}><span aria-hidden="true">{icon}</span><strong>{title}</strong><p>{body}</p></div>;
}
