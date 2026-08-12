"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./participation.module.css";

export type ParticipantRequest = {
  id: string;
  projectId: string;
  projectTitle: string;
  projectDescription: string;
  projectHref: string | null;
  participationType: string;
  message: string;
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

const WITHDRAWABLE = new Set(["new", "reviewing", "contacted"]);

export default function ParticipationRequests({ initialRequests }: { initialRequests: ParticipantRequest[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [withdrawingId, setWithdrawingId] = useState("");
  const [error, setError] = useState("");

  async function withdraw(request: ParticipantRequest) {
    if (!window.confirm(`Withdraw your ${ROLE_LABELS[request.participationType] || "participation"} request for ${request.projectTitle}?`)) {
      return;
    }
    setWithdrawingId(request.id);
    setError("");
    try {
      const response = await fetch("/api/project-participation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, status: "withdrawn" }),
      });
      const payload = await response.json() as { error?: string; request?: { status?: string } };
      if (!response.ok) throw new Error(payload.error || "Your request could not be withdrawn.");
      setRequests((current) => current.map((item) => (
        item.id === request.id
          ? { ...item, status: payload.request?.status || "withdrawn" }
          : item
      )));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your request could not be withdrawn.");
    } finally {
      setWithdrawingId("");
    }
  }

  const activeCount = requests.filter((request) => WITHDRAWABLE.has(request.status)).length;
  const acceptedCount = requests.filter((request) => request.status === "accepted").length;

  return (
    <section className={styles.workspace} aria-label="My participation request history">
      <div className={styles.summaryGrid}>
        <article><strong>{requests.length}</strong><span>Total requests</span></article>
        <article><strong>{activeCount}</strong><span>In progress</span></article>
        <article><strong>{acceptedCount}</strong><span>Accepted</span></article>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {requests.length === 0 ? (
        <div className={styles.emptyState}>
          <span aria-hidden="true">○</span>
          <h2>You have not requested a Project role yet.</h2>
          <p>Explore Settlement Projects and choose the way you would like to participate.</p>
          <Link href="/explore" prefetch={false}>Explore Projects →</Link>
        </div>
      ) : (
        <div className={styles.requestList}>
          {requests.map((request) => (
            <article className={styles.requestCard} key={request.id}>
              <header>
                <div>
                  <span>SETTLEMENT PROJECT</span>
                  <h2>{request.projectTitle}</h2>
                </div>
                <span className={styles.status} data-status={request.status}>{STATUS_LABELS[request.status] || request.status}</span>
              </header>

              {request.projectDescription && <p className={styles.description}>{request.projectDescription}</p>}
              <dl>
                <div><dt>Requested role</dt><dd>{ROLE_LABELS[request.participationType] || request.participationType}</dd></div>
                <div><dt>Submitted</dt><dd>{request.submittedDate}</dd></div>
              </dl>
              {request.message && (
                <div className={styles.message}>
                  <span>YOUR MESSAGE</span>
                  <p>{request.message}</p>
                </div>
              )}

              <footer>
                {request.projectHref ? <Link href={request.projectHref} prefetch={false}>Open Project</Link> : <span>Project page unavailable</span>}
                <Link
                  href={`/messages/new?context=project_participation&id=${encodeURIComponent(request.id)}`}
                  prefetch={false}
                >
                  Message founder
                </Link>
                {WITHDRAWABLE.has(request.status) && (
                  <button
                    disabled={withdrawingId === request.id}
                    onClick={() => withdraw(request)}
                    type="button"
                  >
                    {withdrawingId === request.id ? "Withdrawing…" : "Withdraw request"}
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
