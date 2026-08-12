"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./feedback.module.css";

const categories = [
  ["confusing", "Something is confusing"],
  ["bug", "I found a bug"],
  ["feature_request", "Feature request"],
  ["community_project_suggestion", "Community or project suggestion"],
  ["other", "Other"],
] as const;

export default function FeedbackLauncher() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof categories)[number][0]>("confusing");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closeDialog = useCallback(() => {
    if (busy) return;
    clearCloseTimer();
    setOpen(false);
    setSent(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, [busy, clearCloseTimer]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]):not([tabindex='-1']), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]):not([tabindex='-1']), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDialog, open]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          message,
          website,
          pageUrl: window.location.href,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: unknown } | null;
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Feedback could not be sent.");
      }
      setSent(true);
      setMessage("");
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setOpen(false);
        setSent(false);
        launcherRef.current?.focus();
      }, 1100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Feedback could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={launcherRef} className={styles.launcher} type="button" onClick={() => {
        clearCloseTimer();
        setError(null);
        setSent(false);
        setOpen(true);
      }}>
        <span aria-hidden="true">✦</span> Send feedback
      </button>
      {open && (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="feedback-title">
            <header>
              <div><span>EARLY HEARTHLAND</span><h2 id="feedback-title">Help us improve the real experience.</h2></div>
              <button type="button" aria-label="Close feedback" disabled={busy} onClick={closeDialog}>×</button>
            </header>
            {sent ? (
              <div className={styles.success} role="status"><strong>Thank you.</strong><p>Your feedback is now part of the pilot review.</p></div>
            ) : (
              <form onSubmit={submit}>
                <fieldset>
                  <legend>What kind of feedback is this?</legend>
                  <div className={styles.categories}>
                    {categories.map(([value, label]) => (
                      <label key={value}>
                        <input type="radio" name="feedback-category" value={value} checked={category === value} onChange={() => setCategory(value)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className={styles.message}>
                  <span>What happened—or what would make this better?</span>
                  <textarea minLength={12} maxLength={4000} required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="A concrete example helps us understand what to improve…" />
                </label>
                <label className={styles.honeypot} aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
                {error && <p className={styles.error} role="alert">{error}</p>}
                <footer><small>We attach only the current page—not a secure invitation token.</small><button type="submit" disabled={busy}>{busy ? "Sending…" : "Send feedback"} <span aria-hidden="true">→</span></button></footer>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}
