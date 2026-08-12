"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/browser";
import {
  authProviderConfig,
  type SocialAuthProvider,
} from "../../lib/supabase/config";
import {
  onboardingDestination,
  safeAuthDestination,
} from "../../lib/supabase/auth-redirect";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";
type PendingMethod = "email" | SocialAuthProvider;

const copy: Record<Mode, { eyebrow: string; title: string; body: string; submit: string }> = {
  "sign-in": {
    eyebrow: "WELCOME BACK",
    title: "Continue your Hearthland journey.",
    body: "Sign in to save places, connect with people and manage your projects.",
    submit: "Continue with Email",
  },
  "sign-up": {
    eyebrow: "JOIN HEARTHLAND",
    title: "Create places worth belonging to.",
    body: "Start with a profile, then discover, contribute or create a community.",
    submit: "Continue with Email",
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

const callbackErrors: Record<string, string> = {
  "callback-failed": "We could not complete that sign-in. Please try again.",
  "missing-code": "That sign-in link is incomplete or has expired. Please try again.",
  "provider-cancelled": "Social sign-in was cancelled. You can try again or continue with email.",
  "provider-failed": "The authentication provider could not complete sign-in. Please try again.",
};

async function destinationAfterSignIn(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  destination: string,
) {
  const { data } = await supabase
    .schema("hearthland")
    .from("accounts")
    .select("onboarding_status")
    .eq("id", accountId)
    .maybeSingle();

  return data?.onboarding_status === "complete" || data?.onboarding_status === "skipped"
    ? destination
    : onboardingDestination(destination);
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
      <path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H2.9v2.7A10 10 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.3 13.9a6 6 0 0 1 0-3.8V7.4H2.9a10 10 0 0 0 0 9.2l3.4-2.7Z" />
      <path fill="#ea4335" d="M12 5.9c1.5 0 2.9.5 3.9 1.5l2.9-2.8A9.8 9.8 0 0 0 2.9 7.4l3.4 2.7C7.1 7.7 9.4 5.9 12 5.9Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path fill="#229ed9" d="M21.7 3.6 18.5 20c-.2 1.2-.9 1.5-1.9.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.1c.4-.4-.1-.6-.6-.2L6 13.8l-4.8-1.5c-1-.3-1-1 .2-1.5L20 3.6c.9-.3 1.7.2 1.4 1.5Z" />
    </svg>
  );
}

export default function AuthCard({
  mode,
  next = "/dashboard",
  initialError,
}: {
  mode: Mode;
  next?: string;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? callbackErrors[initialError] ?? callbackErrors["callback-failed"] : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingMethod, setPendingMethod] = useState<PendingMethod | null>(null);
  const content = copy[mode];
  const destination = safeAuthDestination(next);
  const busy = pendingMethod !== null;
  const showsSocialAuth = mode === "sign-in" || mode === "sign-up";

  async function continueWithProvider(providerName: SocialAuthProvider) {
    const providerConfig = authProviderConfig[providerName];
    if (busy || !providerConfig.enabled) return;

    setPendingMethod(providerName);
    setError(null);
    setNotice(null);

    try {
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", destination);
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: providerConfig.provider,
        options: {
          redirectTo: callback.toString(),
          skipBrowserRedirect: true,
        },
      });
      if (authError) throw authError;
      if (!data.url) throw new Error("The authentication provider did not return a sign-in URL.");
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not start social sign-in. Please try again.");
      setPendingMethod(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setPendingMethod("email");
    setError(null);
    setNotice(null);
    const supabase = createClient();

    try {
      if (mode === "sign-in") {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        window.location.assign(await destinationAfterSignIn(supabase, data.user.id, destination));
        return;
      }

      if (mode === "sign-up") {
        const callback = new URL("/auth/callback", window.location.origin);
        callback.searchParams.set("next", destination);
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: callback.toString(),
            data: { display_name: displayName.trim() },
          },
        });
        if (authError) throw authError;
        if (data.session && data.user) {
          window.location.assign(await destinationAfterSignIn(supabase, data.user.id, destination));
        } else {
          setNotice("Check your email to confirm your account, then continue your journey.");
        }
        return;
      }

      if (mode === "forgot") {
        const resetDestination = `/auth/reset-password?next=${encodeURIComponent(destination)}`;
        const callback = new URL("/auth/callback", window.location.origin);
        callback.searchParams.set("next", resetDestination);
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: callback.toString() });
        if (authError) throw authError;
        setNotice("If that email belongs to an account, a recovery link is on its way.");
        return;
      }

      if (password.length < 8) throw new Error("Use at least eight characters.");
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      setNotice("Password updated. Returning to your journey…");
      window.setTimeout(() => window.location.assign(destination), 700);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setPendingMethod(null);
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
            <h2>{mode === "sign-in" ? "Welcome back" : mode === "sign-up" ? "Join Hearthland" : mode === "forgot" ? "Forgot password" : "Set a new password"}</h2>
          </div>
          {showsSocialAuth && (
            <>
              <div className="auth-social" aria-label="Social sign-in options" role="group">
                <button aria-busy={pendingMethod === "google"} className="auth-provider-button" disabled={busy || !authProviderConfig.google.enabled} onClick={() => void continueWithProvider("google")} type="button">
                  <GoogleIcon />
                  <span>{pendingMethod === "google" ? "Connecting to Google…" : "Continue with Google"}</span>
                  {!authProviderConfig.google.enabled && <small>Unavailable</small>}
                </button>
                <button aria-busy={pendingMethod === "telegram"} className="auth-provider-button" disabled={busy || !authProviderConfig.telegram.enabled} onClick={() => void continueWithProvider("telegram")} type="button">
                  <TelegramIcon />
                  <span>{pendingMethod === "telegram" ? "Connecting to Telegram…" : "Continue with Telegram"}</span>
                  {!authProviderConfig.telegram.enabled && <small>Unavailable</small>}
                </button>
              </div>
              {(!authProviderConfig.google.enabled || !authProviderConfig.telegram.enabled) && (
                <p className="auth-provider-note">Unavailable options activate after their secure provider configuration is complete.</p>
              )}
              <div className="auth-divider" aria-hidden="true"><span>OR</span></div>
            </>
          )}
          {mode === "sign-up" && <label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required placeholder="How people will know you" /></label>}
          {mode !== "reset" && <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" /></label>}
          {mode !== "forgot" && <label>{mode === "reset" ? "New password" : "Password"}<input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="At least 8 characters" /></label>}
          {error && <p className="form-message error" role="alert">{error}</p>}
          {notice && <p className="form-message success" role="status">{notice}</p>}
          <button className="button button-primary button-large full" disabled={busy} type="submit">{pendingMethod === "email" ? "Working…" : content.submit} <span aria-hidden="true">→</span></button>
          {mode === "sign-in" && <><Link className="auth-link" href={`/auth/forgot-password?next=${encodeURIComponent(destination)}`} prefetch={false}>Forgot your password?</Link><p className="auth-switch">New to Hearthland? <Link href={`/auth/sign-up?next=${encodeURIComponent(destination)}`} prefetch={false}>Create an account</Link></p></>}
          {mode === "sign-up" && <p className="auth-switch">Already have an account? <Link href={`/auth/sign-in?next=${encodeURIComponent(destination)}`} prefetch={false}>Sign in</Link></p>}
          {(mode === "forgot" || mode === "reset") && <Link className="auth-link" href={`/auth/sign-in?next=${encodeURIComponent(destination)}`} prefetch={false}>Return to sign in</Link>}
        </form>
      </section>
    </main>
  );
}
