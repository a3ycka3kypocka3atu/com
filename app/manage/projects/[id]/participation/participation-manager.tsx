"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./participation.module.css";

export type ManagedParticipationRequest = {
  id: string;
  applicant: {
    name: string;
    headline: string;
    reference: string;
    profileHref: string | null;
  };
  participationType: string;
  message: string;
  availability: string;
  skills: Array<{ id: string; name: string; category: string }>;
  sharedSkillCount: number;
  status: string;
  submittedDate: string;
};

const ROLE_LABELS: Record<string, string> = {
  future_resident: "Future Resident",
  core_team: "Core Team",
  camp_participant: "Camp Participant",
  volunteer: "Volunteer",
  master_teacher: "Master / Teacher",
  specialist: "Specialist",
  supporter: "Supporter",
  partner: "Partner",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewing: "In review",
  contacted: "Contacted",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

const FILTERS = ["all", "new", "reviewing", "contacted", "accepted", "declined", "withdrawn"] as const;

const MANAGER_ACTIONS = [
  { status: "reviewing", label: "Review" },
  { status: "contacted", label: "Contact" },
  { status: "accepted", label: "Accept" },
  { status: "declined", label: "Decline" },
] as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "H";
}

export default function ParticipationManager({
  initialRequests,
  enrichmentWarning,
}: {
  initialRequests: ManagedParticipationRequest[];
  enrichmentWarning: boolean;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");

  const filteredRequests = useMemo(
    () => filter === "all" ? requests : requests.filter((request) => request.status === filter),
    [filter, requests],
  );
  const openCount = requests.filter((request) => ["new", "reviewing", "contacted"].includes(request.status)).length;
  const acceptedCount = requests.filter((request) => request.status === "accepted").length;

  async function updateStatus(requestId: string, status: string) {
    setUpdatingId(requestId);
    setError("");
    try {
      const response = await fetch("/api/project-participation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, status }),
      });
      const payload = await response.json() as { error?: string; request?: { status?: string } };
      if (!response.ok) throw new Error(payload.error || "The request status could not be changed.");
      setRequests((current) => current.map((request) => (
        request.id === requestId
          ? { ...request, status: payload.request?.status || status }
          : request
      )));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request status could not be changed.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <section className={styles.workspace} aria-labelledby="participation-requests-title">
      <div className={styles.summaryGrid}>
        <article><strong>{requests.length}</strong><span>All requests</span></article>
        <article><strong>{openCount}</strong><span>Open</span></article>
        <article><strong>{acceptedCount}</strong><span>Accepted</span></article>
      </div>

      {enrichmentWarning && (
        <div className={styles.notice} role="status">
          Some private profile details could not be shown. Request status controls remain available.
        </div>
      )}
      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.listPanel}>
        <header className={styles.listHeader}>
          <div>
            <span>REQUEST PIPELINE</span>
            <h2 id="participation-requests-title">Participation requests</h2>
          </div>
          <label className={styles.filter}>
            <span>Show</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as (typeof FILTERS)[number])}>
              {FILTERS.map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : STATUS_LABELS[value]}</option>)}
            </select>
          </label>
        </header>

        {filteredRequests.length === 0 ? (
          <div className={styles.emptyState}>
            <span aria-hidden="true">○</span>
            <h3>{requests.length ? "No requests match this filter." : "No participation requests yet."}</h3>
            <p>New requests submitted from the public Project page will appear here.</p>
          </div>
        ) : (
          <div className={styles.requestList}>
            {filteredRequests.map((request) => {
              const terminal = ["accepted", "declined", "withdrawn"].includes(request.status);
              const visibleSkills = request.skills.map((skill) => skill.name);
              const hiddenSkillCount = Math.max(0, request.sharedSkillCount - visibleSkills.length);
              return (
                <article className={styles.requestCard} key={request.id}>
                  <div className={styles.applicantRow}>
                    <span className={styles.avatar} aria-hidden="true">{initials(request.applicant.name)}</span>
                    <div>
                      {request.applicant.profileHref ? (
                        <Link href={request.applicant.profileHref} prefetch={false}>{request.applicant.name}</Link>
                      ) : <strong>{request.applicant.name}</strong>}
                      <small>{request.applicant.headline || `Applicant ${request.applicant.reference}`}</small>
                    </div>
                    <span className={styles.status} data-status={request.status}>{STATUS_LABELS[request.status] || request.status}</span>
                  </div>

                  <div className={styles.requestMeta}>
                    <div><span>Requested role</span><strong>{ROLE_LABELS[request.participationType] || request.participationType}</strong></div>
                    <div><span>Submitted</span><strong>{request.submittedDate}</strong></div>
                  </div>

                  <div className={styles.requestBody}>
                    <section>
                      <span>MESSAGE</span>
                      <p>{request.message || "The applicant did not add a message."}</p>
                    </section>
                    {request.availability && (
                      <section>
                        <span>AVAILABILITY</span>
                        <p>{request.availability}</p>
                      </section>
                    )}
                    <section>
                      <span>RELEVANT SKILLS</span>
                      {request.sharedSkillCount ? (
                        <div className={styles.skills}>
                          {visibleSkills.map((skill) => <span key={skill}>{skill}</span>)}
                          {hiddenSkillCount > 0 && <span>{hiddenSkillCount} private {hiddenSkillCount === 1 ? "skill" : "skills"} shared</span>}
                        </div>
                      ) : <p>No skills were attached to this request.</p>}
                    </section>
                  </div>

                  <footer className={styles.actions}>
                    <Link
                      className={styles.messageLink}
                      href={`/messages/new?context=project_participation&id=${encodeURIComponent(request.id)}`}
                      prefetch={false}
                    >
                      Message applicant
                    </Link>
                    {!terminal && MANAGER_ACTIONS.map((action) => (
                      <button
                        className={action.status === "accepted" ? styles.accept : action.status === "declined" ? styles.decline : undefined}
                        disabled={updatingId === request.id || request.status === action.status}
                        key={action.status}
                        onClick={() => updateStatus(request.id, action.status)}
                        type="button"
                      >
                        {updatingId === request.id ? "Saving…" : action.label}
                      </button>
                    ))}
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
