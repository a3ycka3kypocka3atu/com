"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./invitation.module.css";

export default function InvitationActions({
  token,
  signedIn,
  onboardingComplete,
}: {
  token: string;
  signedIn: boolean;
  onboardingComplete: boolean;
}) {
  const [busy, setBusy] = useState<"accepted" | "declined" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState<"accepted" | "declined" | null>(null);
  const next = `/invite/${token}`;

  async function respond(status: "accepted" | "declined") {
    if (busy) return;
    setBusy(status);
    setError(null);
    try {
      const response = await fetch("/api/invitations/respond", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, status }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: unknown;
        next?: unknown;
        onboardingRequired?: unknown;
      } | null;
      if (response.status === 401) {
        window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if (payload?.onboardingRequired === true) {
        window.location.assign(`/onboarding?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "The invitation could not be updated.");
      }
      setComplete(status);
      if (status === "accepted" && typeof payload?.next === "string") {
        window.setTimeout(() => window.location.assign(payload.next as string), 900);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  if (!signedIn) {
    return (
      <div className={styles.authActions}>
        <Link className={styles.primary} href={`/auth/sign-in?next=${encodeURIComponent(next)}`} prefetch={false}>Sign in to respond <span>→</span></Link>
        <Link className={styles.secondary} href={`/auth/sign-up?next=${encodeURIComponent(next)}`} prefetch={false}>Create Hearthland account</Link>
        <small>Google, Telegram and email options appear on the next screen when configured.</small>
      </div>
    );
  }

  if (!onboardingComplete) {
    return (
      <div className={styles.authActions}>
        <Link className={styles.primary} href={`/onboarding?next=${encodeURIComponent(next)}`} prefetch={false}>Complete basic profile <span>→</span></Link>
        <button className={styles.textButton} type="button" disabled={busy !== null} onClick={() => void respond("declined")}>Decline invitation</button>
        <small>A name and participation intentions are required before accepting a role.</small>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    );
  }

  if (complete) {
    return <div className={styles.complete} role="status"><strong>{complete === "accepted" ? "Invitation accepted." : "Invitation declined."}</strong><p>{complete === "accepted" ? "Opening the Hearthland place now…" : "Your response has been saved."}</p></div>;
  }

  return (
    <div className={styles.responseActions}>
      <button className={styles.primary} type="button" disabled={busy !== null} onClick={() => void respond("accepted")}>{busy === "accepted" ? "Accepting…" : "Accept invitation"} <span>→</span></button>
      <button className={styles.secondary} type="button" disabled={busy !== null} onClick={() => void respond("declined")}>{busy === "declined" ? "Saving…" : "Decline"}</button>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
