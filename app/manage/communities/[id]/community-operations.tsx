"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./community-operations.module.css";

type Group = { id: string; title: string; description: string; coordinator_account_id: string | null; group_status: string; created_at: string };
type GroupMember = { working_group_id: string; account_id: string; member_role: string; status: string };
type Task = { id: string; title: string; description: string; assignee_account_id: string | null; due_date: string | null; status: string; priority: string; working_group_id: string | null };
type Meeting = { id: string; working_group_id: string | null; title: string; starts_at: string; ends_at: string | null; agenda: string; notes: string; meeting_status: string; visibility: string };
type Decision = { id: string; meeting_id: string | null; title: string; description: string; decision_status: string; decided_at: string | null; visibility: string; created_at: string };
type PulseCycle = { id: string; title: string; opens_at: string; closes_at: string | null; cycle_status: string; created_at: string };
type PulseMetric = "communication" | "cooperation" | "belonging" | "workload" | "clarity" | "atmosphere";
type PulseSummary = { cycleId: string; responseCount: number; minimumResponses: number; insufficientData: boolean; averages: Record<PulseMetric, number> | null };
type Member = { accountId: string; name: string };
type Panel = "groups" | "tasks" | "meetings" | "decisions" | "pulse";

function shortDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No date";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export default function CommunityOperations({
  communityId,
  groups,
  groupMembers,
  tasks,
  meetings,
  decisions,
  pulseCycles,
  pulseSummaries,
  members,
}: {
  communityId: string;
  groups: Group[];
  groupMembers: GroupMember[];
  tasks: Task[];
  meetings: Meeting[];
  decisions: Decision[];
  pulseCycles: PulseCycle[];
  pulseSummaries: PulseSummary[];
  members: Member[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("groups");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const memberName = new Map(members.map((member) => [member.accountId, member.name]));
  const groupName = new Map(groups.map((group) => [group.id, group.title]));

  async function send(payload: Record<string, unknown>, success: string, form?: HTMLFormElement) {
    setPending(true);
    setNotice("");
    try {
      const response = await fetch(`/api/manage/communities/${communityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The Community update could not be saved.");
      form?.reset();
      setNotice(success);
      router.refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "The Community update could not be saved.");
    } finally {
      setPending(false);
    }
  }

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send({ action: "working_group", title: formText(form, "title"), description: formText(form, "description"), coordinatorAccountId: formText(form, "coordinator") || null }, "Working group created.", event.currentTarget);
  }

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send({ action: "task", title: formText(form, "title"), description: formText(form, "description"), workingGroupId: formText(form, "group") || null, assigneeAccountId: formText(form, "assignee") || null, dueDate: formText(form, "dueDate"), priority: formText(form, "priority") }, "Task created.", event.currentTarget);
  }

  function createMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send({ action: "meeting", title: formText(form, "title"), agenda: formText(form, "agenda"), workingGroupId: formText(form, "group") || null, startsAt: formText(form, "startsAt"), endsAt: formText(form, "endsAt") || null, visibility: formText(form, "visibility") }, "Meeting added.", event.currentTarget);
  }

  function createDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send({ action: "decision", title: formText(form, "title"), description: formText(form, "description"), meetingId: formText(form, "meeting") || null, decisionStatus: formText(form, "status"), visibility: formText(form, "visibility") }, "Decision recorded.", event.currentTarget);
  }

  function createPulse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send({ action: "pulse_cycle", title: formText(form, "title"), opensAt: formText(form, "opensAt") || null, closesAt: formText(form, "closesAt") || null, cycleStatus: formText(form, "status") }, "Community Pulse opened.", event.currentTarget);
  }

  const openTasks = tasks.filter((task) => task.status !== "completed").length;
  const upcomingMeetings = meetings.filter((meeting) => meeting.meeting_status === "scheduled").length;
  const reportablePulseCycles = pulseCycles.filter((cycle) => cycle.cycle_status !== "draft");
  const latestPulse = reportablePulseCycles[0] ?? null;
  const previousPulse = reportablePulseCycles[1] ?? null;
  const latestSummary = latestPulse ? pulseSummaries.find((summary) => summary.cycleId === latestPulse.id) ?? null : null;
  const previousSummary = previousPulse ? pulseSummaries.find((summary) => summary.cycleId === previousPulse.id) ?? null : null;

  return (
    <>
      <section className={styles.metrics}>
        <article><strong>{groups.filter((group) => group.group_status === "active").length}</strong><span>Working groups</span></article>
        <article><strong>{openTasks}</strong><span>Open tasks</span></article>
        <article><strong>{upcomingMeetings}</strong><span>Upcoming meetings</span></article>
        <article><strong>{decisions.length}</strong><span>Decisions preserved</span></article>
        <article><strong>{pulseCycles.filter((cycle) => cycle.cycle_status === "open").length}</strong><span>Open Pulse cycles</span></article>
      </section>

      <nav className={styles.tabs} aria-label="Community operation areas">
        {(["groups", "tasks", "meetings", "decisions", "pulse"] as Panel[]).map((item) => (
          <button key={item} className={panel === item ? styles.active : ""} onClick={() => { setPanel(item); setNotice(""); }}>{item.replaceAll("_", " ")}</button>
        ))}
      </nav>

      {notice && <div className={styles.notice} role="status">{notice}</div>}

      {panel === "groups" && <section className={styles.workspace}>
        <div className={styles.listPanel}>
          <header><span>WORKING GROUPS</span><h2>Small teams with clear ownership</h2></header>
          {groups.length ? <div className={styles.cards}>{groups.map((group) => {
            const count = groupMembers.filter((member) => member.working_group_id === group.id && member.status === "active").length;
            return <article key={group.id}><span data-status={group.group_status}>{group.group_status}</span><h3>{group.title}</h3><p>{group.description || "No group description yet."}</p><footer><strong>{count} member{count === 1 ? "" : "s"}</strong><small>{group.coordinator_account_id ? memberName.get(group.coordinator_account_id) || "Coordinator assigned" : "Coordinator needed"}</small></footer></article>;
          })}</div> : <Empty title="No working groups" text="Create the first group around work that already needs care." />}
        </div>
        <OperationForm title="Create working group" intro="Keep the scope concrete: Food, Garden, Building, Finance or Community Care." onSubmit={createGroup} pending={pending}>
          <label><span>Title</span><input name="title" required maxLength={160} placeholder="Garden" /></label>
          <label><span>Description</span><textarea name="description" rows={4} maxLength={3000} placeholder="What this group is responsible for…" /></label>
          <label><span>Coordinator</span><select name="coordinator" defaultValue=""><option value="">Assign later</option>{members.map((member) => <option key={member.accountId} value={member.accountId}>{member.name}</option>)}</select></label>
        </OperationForm>
      </section>}

      {panel === "tasks" && <section className={styles.workspace}>
        <div className={styles.listPanel}><header><span>COMMUNITY TASKS</span><h2>Visible work, lightly organised</h2></header>{tasks.length ? <div className={styles.rows}>{tasks.map((task) => <article key={task.id}><i data-priority={task.priority} /><div><strong>{task.title}</strong><small>{task.working_group_id ? groupName.get(task.working_group_id) || "Working group" : "Whole community"} · {task.assignee_account_id ? memberName.get(task.assignee_account_id) || "Assigned" : "Unassigned"}</small></div><span>{task.status.replaceAll("_", " ")}</span><time>{task.due_date ? shortDate(task.due_date) : "No due date"}</time></article>)}</div> : <Empty title="No tasks yet" text="Add one useful next action and assign it when the right person is clear." />}</div>
        <OperationForm title="Add task" intro="Create only the coordination needed for real community work." onSubmit={createTask} pending={pending}>
          <label><span>Task</span><input name="title" required maxLength={220} /></label>
          <label><span>Details</span><textarea name="description" rows={3} maxLength={3000} /></label>
          <label><span>Working group</span><select name="group" defaultValue=""><option value="">Whole community</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
          <div className={styles.pair}><label><span>Assignee</span><select name="assignee" defaultValue=""><option value="">Unassigned</option>{members.map((member) => <option key={member.accountId} value={member.accountId}>{member.name}</option>)}</select></label><label><span>Priority</span><select name="priority" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
          <label><span>Due date</span><input name="dueDate" type="date" /></label>
        </OperationForm>
      </section>}

      {panel === "meetings" && <section className={styles.workspace}>
        <div className={styles.listPanel}><header><span>MEETINGS</span><h2>A shared record of gathering</h2></header>{meetings.length ? <div className={styles.cards}>{meetings.map((meeting) => <article key={meeting.id}><span data-status={meeting.meeting_status}>{meeting.meeting_status}</span><h3>{meeting.title}</h3><p>{meeting.agenda || "Agenda not added."}</p><footer><strong>{shortDate(meeting.starts_at)}</strong><small>{meeting.working_group_id ? groupName.get(meeting.working_group_id) : "Whole community"}</small></footer></article>)}</div> : <Empty title="No meetings recorded" text="Add the next gathering and a short agenda." />}</div>
        <OperationForm title="Add meeting" intro="Use this as an agenda and durable record, not a parliamentary system." onSubmit={createMeeting} pending={pending}>
          <label><span>Title</span><input name="title" required maxLength={200} /></label>
          <label><span>Agenda</span><textarea name="agenda" rows={4} maxLength={6000} /></label>
          <label><span>Working group</span><select name="group" defaultValue=""><option value="">Whole community</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
          <div className={styles.pair}><label><span>Starts</span><input name="startsAt" type="datetime-local" required /></label><label><span>Ends</span><input name="endsAt" type="datetime-local" /></label></div>
          <label><span>Visibility</span><select name="visibility" defaultValue="members"><option value="members">All members</option><option value="managers">Managers only</option></select></label>
        </OperationForm>
      </section>}

      {panel === "decisions" && <section className={styles.workspace}>
        <div className={styles.listPanel}><header><span>DECISIONS ARCHIVE</span><h2>Remember what the community chose</h2></header>{decisions.length ? <div className={styles.rows}>{decisions.map((decision) => <article key={decision.id}><i data-priority={decision.decision_status === "approved" ? "low" : "medium"} /><div><strong>{decision.title}</strong><small>{decision.description || "No description"}</small></div><span>{decision.decision_status}</span><time>{shortDate(decision.decided_at || decision.created_at)}</time></article>)}</div> : <Empty title="No decisions yet" text="Important choices can be preserved here after discussion." />}</div>
        <OperationForm title="Record decision" intro="Keep the title legible and connect it to a meeting when possible." onSubmit={createDecision} pending={pending}>
          <label><span>Decision</span><input name="title" required maxLength={200} /></label>
          <label><span>Description</span><textarea name="description" rows={4} maxLength={6000} /></label>
          <label><span>Related meeting</span><select name="meeting" defaultValue=""><option value="">No linked meeting</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}</select></label>
          <div className={styles.pair}><label><span>Status</span><select name="status" defaultValue="proposed"><option value="proposed">Proposed</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="superseded">Superseded</option></select></label><label><span>Visibility</span><select name="visibility" defaultValue="members"><option value="members">All members</option><option value="managers">Managers only</option></select></label></div>
        </OperationForm>
      </section>}

      {panel === "pulse" && <section className={styles.workspace}>
        <div className={styles.listPanel}>
          <header><span>COMMUNITY PULSE</span><h2>Notice strain before it becomes a crisis</h2></header>
          {latestPulse && latestSummary ? <PulseAggregate cycle={latestPulse} summary={latestSummary} previousCycle={previousPulse} previous={previousSummary} /> : latestPulse ? <section className={styles.pulseUnavailable}><strong>Aggregate not available yet</strong><p>The cycle is saved, but its private aggregate could not be loaded. No individual response data has been requested.</p></section> : null}
          {pulseCycles.length ? <div className={styles.cards}>{pulseCycles.map((cycle) => <article key={cycle.id}><span data-status={cycle.cycle_status}>{cycle.cycle_status}</span><h3>{cycle.title}</h3><p>Six private 1–5 signals: communication, cooperation, belonging, workload, clarity and atmosphere.</p><footer><strong>Opened {shortDate(cycle.opens_at)}</strong><small>{cycle.closes_at ? `Closes ${shortDate(cycle.closes_at)}` : "No closing date"}</small></footer></article>)}</div> : <Empty title="No Pulse cycle" text="Open a short private check-in when the community is ready to respond." />}
        </div>
        <OperationForm title="Open Community Pulse" intro="Management sees thresholded aggregates. Individual comments remain private." onSubmit={createPulse} pending={pending}>
          <label><span>Title</span><input name="title" required maxLength={160} placeholder="August community check-in" /></label>
          <div className={styles.pair}><label><span>Opens</span><input name="opensAt" type="datetime-local" /></label><label><span>Closes</span><input name="closesAt" type="datetime-local" /></label></div>
          <label><span>Status</span><select name="status" defaultValue="open"><option value="open">Open now</option><option value="draft">Save as draft</option></select></label>
        </OperationForm>
      </section>}
    </>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className={styles.empty}><strong>{title}</strong><p>{text}</p></div>;
}

const pulseMetrics: Array<{ key: PulseMetric; label: string }> = [
  { key: "communication", label: "Communication" },
  { key: "cooperation", label: "Cooperation" },
  { key: "belonging", label: "Belonging" },
  { key: "workload", label: "Workload" },
  { key: "clarity", label: "Clarity" },
  { key: "atmosphere", label: "Atmosphere" },
];

function PulseAggregate({ cycle, summary, previousCycle, previous }: { cycle: PulseCycle; summary: PulseSummary; previousCycle: PulseCycle | null; previous: PulseSummary | null }) {
  const comparable = summary.averages && previous?.averages;
  return <section className={styles.pulseAggregate} aria-labelledby="current-pulse-summary">
    <header><div><span>CURRENT AGGREGATE</span><h3 id="current-pulse-summary">{cycle.title}</h3></div><div><strong>{summary.responseCount}</strong><span>private response{summary.responseCount === 1 ? "" : "s"}</span></div></header>
    {summary.insufficientData || !summary.averages ? <div className={styles.pulseThreshold}><strong>Waiting for a privacy-safe aggregate</strong><p>At least {summary.minimumResponses} responses are required before averages appear. Individual scores and comments remain unavailable.</p></div> : <div className={styles.pulseSignals}>{pulseMetrics.map(({ key, label }) => {
      const score = summary.averages?.[key] ?? 0;
      const change = comparable ? score - (previous.averages?.[key] ?? score) : null;
      return <article key={key}><span>{label}</span><strong>{score.toFixed(2)}<small> / 5</small></strong><i><span style={{ width: `${Math.max(0, Math.min(100, score * 20))}%` }} /></i><em data-direction={change === null ? "none" : change > 0.004 ? "up" : change < -0.004 ? "down" : "flat"}>{change === null ? "No prior trend" : `${change > 0 ? "+" : ""}${change.toFixed(2)} vs previous`}</em></article>;
    })}</div>}
    <footer>{previousCycle ? `Compared with ${previousCycle.title} when both cycles meet the privacy threshold.` : "A trend will appear after a second eligible cycle."} No individual responses or comments are shown.</footer>
  </section>;
}

function OperationForm({ title, intro, onSubmit, pending, children }: { title: string; intro: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; children: React.ReactNode }) {
  return <aside className={styles.formCard}><span>ADD SOMETHING USEFUL</span><h2>{title}</h2><p>{intro}</p><form onSubmit={onSubmit}>{children}<button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button></form></aside>;
}
