"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/browser";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";

const copy: Record<Mode, { eyebrow: string; title: string; body: string; submit: string }> = {
  "sign-in": {
    eyebrow: "WELCOME BACK",
    title: "Continue your Hearthland journey.",
    body: "Sign in to save places, connect with people and manage your projects.",
    submit: "Sign in",
  },
  "sign-up": {
    eyebrow: "JOIN HEARTHLAND",
    title: "Create places worth belonging to.",
    body: "Start with a profile, then discover, contribute or create a community.",
    submit: "Create account",
  },
  forgot: {
    eyebrow: "ACCOUNT RECOVERY",
    title: "Reset your password.",
    body: "We’ll send a secure recovery link to your email address.",
    submit: "Send recovery link",
  },
  reset: {
    eyebrow: "CHOOSE A PASSWORD",
    title: "Secure your Hearthland account.",
    body: "Use at least eight characters. A longer passphrase is even better.",
    submit: "Update password",
  },
};

function safeNext(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export default function AuthCard({ mode, next = "/dashboard" }: { mode: Mode; next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const content = copy[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const destination = safeNext(next);

    try {
      if (mode === "sign-in") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        window.location.assign(destination);
        return;
      }

      if (mode === "sign-up") {
        const callback = new URL("/auth/callback", window.location.origin);
        callback.searchParams.set("next", destination === "/dashboard" ? "/onboarding" : destination);
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: callback.toString(),
            data: { display_name: displayName.trim() },
          },
        });
        if (authError) throw authError;
        if (data.session) window.location.assign(destination === "/dashboard" ? "/onboarding" : destination);
        else setNotice("Check your email to confirm your account, then continue your journey.");
        return;
      }

      if (mode === "forgot") {
        const callback = new URL("/auth/callback", window.location.origin);
        callback.searchParams.set("next", "/auth/reset-password");
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: callback.toString() });
        if (authError) throw authError;
        setNotice("If that email belongs to an account, a recovery link is on its way.");
        return;
      }

      if (password.length < 8) throw new Error("Use at least eight characters.");
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      setNotice("Password updated. Returning to your dashboard…");
      window.setTimeout(() => window.location.assign(destination), 700);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <Link className="auth-brand" href="/" prefetch={false} aria-label="Hearthland home"><span className="brand-mark"><span /></span>Hearthland</Link>
      <section className="auth-panel">
        <div className="auth-story">
          <span className="eyebrow light">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.body}</p>
          <div className="auth-loop"><span>Discover</span><i>→</i><span>Connect</span><i>→</i><span>Build</span><i>→</i><span>Belong</span></div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div>
            <span className="section-label">HEARTHLAND ACCOUNT</span>
            <h2>{mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create your account" : mode === "forgot" ? "Forgot password" : "Set a new password"}</h2>
          </div>
          {mode === "sign-up" && <label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required placeholder="How people will know you" /></label>}
          {mode !== "reset" && <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" /></label>}
          {mode !== "forgot" && <label>{mode === "reset" ? "New password" : "Password"}<input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="At least 8 characters" /></label>}
          {error && <p className="form-message error" role="alert">{error}</p>}
          {notice && <p className="form-message success" role="status">{notice}</p>}
          <button className="button button-primary button-large full" disabled={busy} type="submit">{busy ? "Working…" : content.submit} <span aria-hidden="true">→</span></button>
          {mode === "sign-in" && <><Link className="auth-link" href="/auth/forgot-password" prefetch={false}>Forgot your password?</Link><p className="auth-switch">New to Hearthland? <Link href={`/auth/sign-up?next=${encodeURIComponent(safeNext(next))}`} prefetch={false}>Create an account</Link></p></>}
          {mode === "sign-up" && <p className="auth-switch">Already have an account? <Link href={`/auth/sign-in?next=${encodeURIComponent(safeNext(next))}`} prefetch={false}>Sign in</Link></p>}
          {(mode === "forgot" || mode === "reset") && <Link className="auth-link" href="/auth/sign-in" prefetch={false}>Return to sign in</Link>}
        </form>
      </section>
    </main>
  );
}
