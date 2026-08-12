"use client";

import { FormEvent, useState } from "react";
import styles from "./pulse.module.css";

type Initial = {
  communication: number;
  cooperation: number;
  belonging: number;
  workload: number;
  clarity: number;
  atmosphere: number;
  private_comment: string;
  submitted_at: string;
};

const signals = [
  ["communication", "Communication", "Can we speak and listen clearly?"],
  ["cooperation", "Cooperation", "Are we able to work well together?"],
  ["belonging", "Belonging", "Do you feel part of this community?"],
  ["workload", "Workload", "Does the current load feel sustainable?"],
  ["clarity", "Clarity", "Are roles and next actions understandable?"],
  ["atmosphere", "Overall atmosphere", "How does the community feel right now?"],
] as const;

export default function PulseForm({ communityId, cycleId, initial }: { communityId: string; cycleId: string; initial: Initial | null }) {
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { action: "pulse_response", cycleId, privateComment: form.get("privateComment") };
    for (const [key] of signals) payload[key] = Number(form.get(key));
    try {
      const response = await fetch(`/api/manage/communities/${communityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Your Pulse response could not be saved.");
      setComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your Pulse response could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (complete) return <div className={styles.thanks}><span>RESPONSE SAVED</span><h2>Thank you for checking in.</h2><p>Your private response is now included in the Community Pulse aggregate.</p></div>;

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formHead}><span>{initial ? "UPDATE YOUR RESPONSE" : "HOW IS THE COMMUNITY DOING?"}</span><h2>Choose one honest signal for each area.</h2><p>1 means this needs urgent care. 5 means it feels strong.</p></div>
      {signals.map(([key, label, prompt]) => <fieldset key={key}>
        <legend><strong>{label}</strong><small>{prompt}</small></legend>
        <div>{[1, 2, 3, 4, 5].map((score) => <label key={score}><input type="radio" name={key} value={score} defaultChecked={initial?.[key] === score} required /><span>{score}</span></label>)}</div>
      </fieldset>)}
      <label className={styles.comment}><span>Private reflection · optional</span><textarea name="privateComment" defaultValue={initial?.private_comment ?? ""} rows={5} maxLength={3000} placeholder="What would help the community feel healthier?" /><small>This comment stays visible only to you.</small></label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? "Saving privately…" : initial ? "Update my response" : "Submit private response"}</button>
    </form>
  );
}
