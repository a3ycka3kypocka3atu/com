"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./community-member.module.css";

const statuses = ["todo", "in_progress", "blocked", "completed"] as const;
type TaskStatus = (typeof statuses)[number];

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function MemberTaskStatus({ communityId, taskId, initialStatus, taskTitle }: { communityId: string; taskId: string; initialStatus: TaskStatus; taskTitle: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function update(nextStatus: TaskStatus) {
    const previous = status;
    setStatus(nextStatus);
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/manage/communities/${communityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "member_task_status", taskId, status: nextStatus }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Task status could not be saved.");
      router.refresh();
    } catch (caught) {
      setStatus(previous);
      setError(caught instanceof Error ? caught.message : "Task status could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return <div className={styles.taskControl}>
    <label>
      <span className={styles.srOnly}>Status for {taskTitle}</span>
      <select aria-label={`Status for ${taskTitle}`} disabled={pending} value={status} onChange={(event) => void update(event.target.value as TaskStatus)}>
        {statuses.map((value) => <option key={value} value={value}>{label(value)}</option>)}
      </select>
    </label>
    {error && <small role="alert">{error}</small>}
  </div>;
}
