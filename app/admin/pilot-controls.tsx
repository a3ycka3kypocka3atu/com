"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

type ProjectOption = {
  id: string;
  title: string;
  status: string;
  cohort: string;
  summary: string;
  nextReviewAt: string;
};

export default function PilotControls({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const current = projects.find((project) => project.id === projectId) ?? projects[0];
  const [pilotStatus, setPilotStatus] = useState(current?.status ?? "nominated");
  const [cohort, setCohort] = useState(current?.cohort ?? "");
  const [publicSummary, setPublicSummary] = useState(current?.summary ?? "");
  const [nextReviewAt, setNextReviewAt] = useState(current?.nextReviewAt ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  function chooseProject(nextId: string) {
    const selected = projects.find((project) => project.id === nextId);
    setProjectId(nextId);
    setPilotStatus(selected?.status ?? "nominated");
    setCohort(selected?.cohort ?? "");
    setPublicSummary(selected?.summary ?? "");
    setNextReviewAt(selected?.nextReviewAt ?? "");
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/pilots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, pilotStatus, cohort, publicSummary, nextReviewAt }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The pilot project could not be updated.");
      setNotice("Pilot designation saved.");
      router.refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "The pilot project could not be updated.");
    } finally {
      setPending(false);
    }
  }

  if (!projects.length) {
    return <div className={styles.empty}><strong>No settlement projects yet</strong><p>Create a real project before designating a Hearthland pilot.</p></div>;
  }

  return (
    <form className={styles.pilotForm} onSubmit={submit}>
      <label>
        <span>Settlement project</span>
        <select value={projectId} onChange={(event) => chooseProject(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
      </label>
      <div className={styles.formPair}>
        <label>
          <span>Pilot status</span>
          <select value={pilotStatus} onChange={(event) => setPilotStatus(event.target.value)}>
            <option value="nominated">Nominated</option>
            <option value="active">Active pilot</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label>
          <span>Cohort</span>
          <input value={cohort} onChange={(event) => setCohort(event.target.value)} placeholder="First places · 2026" maxLength={120} />
        </label>
      </div>
      <label>
        <span>Public pilot summary</span>
        <textarea value={publicSummary} onChange={(event) => setPublicSummary(event.target.value)} placeholder="Why this project is part of the first real Hearthland pilot…" maxLength={2000} rows={4} />
      </label>
      <label className={styles.reviewField}>
        <span>Next review</span>
        <input type="date" value={nextReviewAt} onChange={(event) => setNextReviewAt(event.target.value)} />
      </label>
      <div className={styles.pilotActions}>
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save pilot status"}</button>
        {notice && <p role="status">{notice}</p>}
      </div>
    </form>
  );
}
