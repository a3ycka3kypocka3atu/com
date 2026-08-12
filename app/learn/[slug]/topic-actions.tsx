"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./topic.module.css";

type Props = {
  topicId: string;
  slug: string;
  initialInterested: boolean;
  isAuthenticated: boolean;
};

export default function TopicActions({ topicId, slug, initialInterested, isAuthenticated }: Props) {
  const [interested, setInterested] = useState(initialInterested);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const topicPath = `/learn/${slug}`;
  const teachingPath = `/settings/profile?focus=teaching&next=${encodeURIComponent(topicPath)}`;
  const teachingHref = isAuthenticated
    ? teachingPath
    : `/auth/sign-in?next=${encodeURIComponent(teachingPath)}`;

  async function toggleLearningInterest() {
    if (!isAuthenticated) {
      window.location.assign(`/auth/sign-in?next=${encodeURIComponent(topicPath)}`);
      return;
    }

    const enabled = !interested;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/learning-preferences", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "learn", topicId, enabled }),
      });
      const payload = await response.json() as { error?: unknown };
      if (response.status === 401) {
        window.location.assign(`/auth/sign-in?next=${encodeURIComponent(topicPath)}`);
        return;
      }
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "This learning preference could not be saved.");
      }
      setInterested(enabled);
      setMessage(enabled ? "Added to your learning interests." : "Removed from your learning interests.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "This learning preference could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.actions}>
      <button
        className={interested ? styles.activeAction : styles.primaryAction}
        type="button"
        aria-pressed={interested}
        disabled={saving}
        onClick={() => void toggleLearningInterest()}
      >
        {saving ? "Saving…" : interested ? "✓ I Want to Learn This" : "I Want to Learn This"}
      </button>
      <Link className={styles.secondaryAction} href={teachingHref} prefetch={false}>
        I Can Teach This
      </Link>
      <p className={styles.actionHint}>Teaching is added only after you review and save your Master / Teacher profile.</p>
      <p className={styles.actionMessage} aria-live="polite">{message}</p>
    </div>
  );
}
